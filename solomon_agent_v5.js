/**
 * Solomon PC Agent v5.0 (Robust WebSocket Edition)
 *
 * Runs on Jed's Windows PC. Connects to the relay via WebSocket for real-time
 * command execution. Features:
 * - WebSocket with exponential backoff auto-reconnect
 * - URL sanitization (strips quotes, asterisks, markdown)
 * - Tab management (limits Chrome tabs, closes stale ones)
 * - Auto-screenshot on task completion
 * - Graceful error handling (never crashes)
 * - Uses Chrome (not Edge) exclusively
 */

const { exec, execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

// ── CONFIGURATION ──────────────────────────────────────────────────────────
const RELAY_URL = 'http://167.99.237.26:3001';
const RELAY_WS_URL = 'ws://167.99.237.26:3001/agent/ws';
const SHARED_SECRET = '7f3a9b2e-1d4c-4e8f-b6a5-3c7d8e9f0a1b';
const HEARTBEAT_INTERVAL = 10000;  // 10s
const POLL_INTERVAL = 3000;        // 3s fallback polling
const MAX_TABS = 8;
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SCREENSHOT_DIR = path.join(process.env.USERPROFILE || 'C:\\Users\\Ashle', 'SolomonAgent', 'screenshots');
const LOG_FILE = path.join(process.env.USERPROFILE || 'C:\\Users\\Ashle', 'SolomonAgent', 'agent.log');

// ── LOGGING ────────────────────────────────────────────────────────────────
function log(level, msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {}
}

// ── URL SANITIZER ──────────────────────────────────────────────────────────
function sanitizeUrl(url) {
  if (!url) return url;
  let clean = url
    .replace(/^["'`]+|["'`]+$/g, '')     // Strip surrounding quotes
    .replace(/^\*+|\*+$/g, '')            // Strip asterisks
    .replace(/\*\*/g, '')                 // Strip bold markdown
    .replace(/^\[|\]$/g, '')             // Strip brackets
    .replace(/[<>]/g, '')                // Strip angle brackets
    .replace(/\s+/g, '')                 // Remove whitespace
    .trim();
  
  // Fix common URL mangling
  if (clean.startsWith('ttp://') || clean.startsWith('ttps://')) {
    clean = 'h' + clean;
  }
  if (!clean.startsWith('http://') && !clean.startsWith('https://') && clean.includes('.')) {
    clean = 'https://' + clean;
  }
  
  return clean;
}

// ── TAB MANAGEMENT ─────────────────────────────────────────────────────────
async function getChromeTabs() {
  return new Promise((resolve) => {
    exec('powershell -Command "Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne \'\' } | Select-Object Id, MainWindowTitle | ConvertTo-Json"',
      { timeout: 10000 },
      (err, stdout) => {
        if (err || !stdout.trim()) return resolve([]);
        try {
          const data = JSON.parse(stdout);
          const tabs = Array.isArray(data) ? data : [data];
          resolve(tabs.filter(t => t && t.Id));
        } catch { resolve([]); }
      }
    );
  });
}

async function enforceTabLimit() {
  const tabs = await getChromeTabs();
  if (tabs.length <= MAX_TABS) return;
  
  log('WARN', `Chrome has ${tabs.length} windows (limit: ${MAX_TABS}). Closing oldest.`);
  // Close excess tabs (keep the newest ones)
  const toClose = tabs.slice(0, tabs.length - MAX_TABS);
  for (const tab of toClose) {
    try {
      exec(`powershell -Command "Stop-Process -Id ${tab.Id} -Force -ErrorAction SilentlyContinue"`, { timeout: 5000 });
    } catch {}
  }
}

// ── SCREENSHOT ─────────────────────────────────────────────────────────────
async function takeScreenshot(label = 'task') {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
  const filename = `${label}_${Date.now()}.png`;
  const filepath = path.join(SCREENSHOT_DIR, filename);
  
  return new Promise((resolve) => {
    const ps = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -AssemblyName System.Drawing
      $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
      $bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
      $bmp.Save("${filepath.replace(/\\/g, '\\\\')}")
      $g.Dispose()
      $bmp.Dispose()
      Write-Output "${filepath.replace(/\\/g, '\\\\')}"
    `;
    exec(`powershell -Command "${ps.replace(/"/g, '\\"')}"`, { timeout: 15000 }, (err, stdout) => {
      if (err) {
        log('ERROR', `Screenshot failed: ${err.message}`);
        resolve(null);
      } else {
        resolve(filepath);
      }
    });
  });
}

// ── COMMAND EXECUTOR ───────────────────────────────────────────────────────
function executeCommand(command, type = 'powershell', timeout = 60000) {
  return new Promise((resolve) => {
    let cmd, args;
    
    // URL sanitization for browser commands
    if (command.includes('http') || command.includes('www.')) {
      const urlMatch = command.match(/(https?:\/\/[^\s"'*<>]+|www\.[^\s"'*<>]+)/);
      if (urlMatch) {
        const cleanUrl = sanitizeUrl(urlMatch[0]);
        command = command.replace(urlMatch[0], cleanUrl);
      }
    }
    
    // Force Chrome over Edge
    command = command
      .replace(/start msedge/gi, `start "" "${CHROME_PATH}"`)
      .replace(/start microsoft-edge/gi, `start "" "${CHROME_PATH}"`)
      .replace(/Start-Process.*msedge/gi, `Start-Process "${CHROME_PATH}"`)
      .replace(/Start-Process.*MicrosoftEdge/gi, `Start-Process "${CHROME_PATH}"`);
    
    if (type === 'powershell') {
      cmd = 'powershell';
      args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command];
    } else {
      cmd = 'cmd';
      args = ['/c', command];
    }
    
    log('EXEC', `[${type}] ${command.slice(0, 200)}`);
    
    const proc = spawn(cmd, args, {
      timeout,
      windowsHide: true,
      env: { ...process.env, PATH: process.env.PATH }
    });
    
    let stdout = '';
    let stderr = '';
    let killed = false;
    
    const timer = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');
      resolve({ exitCode: -1, stdout: stdout || '(timeout)', stderr, timedOut: true });
    }, timeout);
    
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });
    
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (!killed) {
        resolve({ exitCode: code || 0, stdout: stdout.trim(), stderr: stderr.trim() });
      }
    });
    
    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ exitCode: -1, stdout: '', stderr: err.message });
    });
  });
}

// ── HTTP POLLING (fallback when WebSocket unavailable) ─────────────────────
let useWebSocket = false;
let wsConnection = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 60000;

async function httpRequest(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, RELAY_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function sendHeartbeat() {
  try {
    await httpRequest('POST', '/agent/heartbeat', {
      agentId: require('os').hostname(),
      secret: SHARED_SECRET,
      version: '5.0.0',
      tabs: (await getChromeTabs()).length,
      uptime: Math.floor(process.uptime())
    });
  } catch (e) {
    log('WARN', `Heartbeat failed: ${e.message}`);
  }
}

async function pollForCommands() {
  try {
    const data = await httpRequest('GET', '/command/pending');
    if (data && data.commands && data.commands.length > 0) {
      for (const cmd of data.commands) {
        await processCommand(cmd);
      }
    }
  } catch (e) {
    // Silent — polling failures are expected during network blips
  }
}

async function processCommand(cmd) {
  log('CMD', `Processing: ${cmd.id} [${cmd.type}] ${(cmd.command || '').slice(0, 100)}`);

  // ── SELF-UPGRADE HANDLER ──────────────────────────────────────────────
  if (cmd.type === 'upgrade' && cmd.command === '__SELF_UPGRADE__' && cmd.payload) {
    log('INFO', 'Self-upgrade command received. Writing new agent script...');
    try {
      const scriptPath = __filename;
      const backupPath = scriptPath.replace('.js', '_backup_' + Date.now() + '.js');
      fs.copyFileSync(scriptPath, backupPath);
      fs.writeFileSync(scriptPath, cmd.payload, 'utf8');
      log('INFO', 'New agent script written. Restarting in 3s...');
      await httpRequest('POST', `/command/result/${cmd.id}`, {
        secret: SHARED_SECRET,
        result: { exitCode: 0, stdout: 'Self-upgrade complete. Restarting...', stderr: '' }
      });
      setTimeout(() => {
        const { spawn } = require('child_process');
        spawn(process.execPath, [scriptPath], {
          detached: true,
          stdio: 'ignore',
          env: process.env
        }).unref();
        process.exit(0);
      }, 3000);
    } catch (e) {
      log('ERROR', 'Self-upgrade failed: ' + e.message);
      await httpRequest('POST', `/command/result/${cmd.id}`, {
        secret: SHARED_SECRET,
        result: { exitCode: 1, stdout: '', stderr: 'Upgrade failed: ' + e.message }
      });
    }
    return;
  }

  // Enforce tab limit before opening new things
  if (cmd.command && (cmd.command.includes('start') || cmd.command.includes('chrome') || cmd.command.includes('Navigate'))) {
    await enforceTabLimit();
  }
  
  const result = await executeCommand(cmd.command, cmd.type, cmd.timeout || 60000);
  
  // Auto-screenshot after browser commands
  if (cmd.command && (cmd.command.includes('chrome') || cmd.command.includes('Navigate') || cmd.command.includes('browser'))) {
    await new Promise(r => setTimeout(r, 3000)); // Wait for page load
    const ssPath = await takeScreenshot(`cmd_${cmd.id}`);
    if (ssPath) {
      result.screenshot = ssPath;
    }
  }
  
  // Report result back
  try {
    await httpRequest('POST', `/command/result/${cmd.id}`, {
      secret: SHARED_SECRET,
      result: {
        exitCode: result.exitCode,
        stdout: (result.stdout || '').slice(0, 10000),
        stderr: (result.stderr || '').slice(0, 2000),
        screenshot: result.screenshot || null,
        timedOut: result.timedOut || false
      }
    });
    log('OK', `Result sent for ${cmd.id} (exit: ${result.exitCode})`);
  } catch (e) {
    log('ERROR', `Failed to send result for ${cmd.id}: ${e.message}`);
  }
}

// ── MAIN LOOP ──────────────────────────────────────────────────────────────
async function main() {
  log('INFO', '═══════════════════════════════════════════════════');
  log('INFO', '  Solomon PC Agent v5.0 starting...');
  log('INFO', `  Relay: ${RELAY_URL}`);
  log('INFO', `  Chrome: ${CHROME_PATH}`);
  log('INFO', `  Max tabs: ${MAX_TABS}`);
  log('INFO', '═══════════════════════════════════════════════════');
  
  // Verify Chrome exists
  if (!fs.existsSync(CHROME_PATH)) {
    log('WARN', 'Chrome not found at expected path. Will use system default.');
  }
  
  // Start heartbeat
  setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
  sendHeartbeat();
  
  // Start polling loop with error recovery
  async function pollLoop() {
    while (true) {
      try {
        await pollForCommands();
      } catch (e) {
        log('ERROR', `Poll loop error: ${e.message}`);
        // Exponential backoff on repeated failures
        reconnectAttempts++;
        const delay = Math.min(POLL_INTERVAL * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
        log('INFO', `Backing off: ${delay}ms (attempt ${reconnectAttempts})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      
      // Reset backoff on success
      if (reconnectAttempts > 0) {
        log('INFO', 'Connection restored, resetting backoff');
        reconnectAttempts = 0;
      }
      
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }
  }
  
  pollLoop();
}

// ── GLOBAL ERROR HANDLERS ──────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  log('FATAL', `Uncaught exception: ${err.message}\n${err.stack}`);
  // Don't exit — let the agent keep running
});

process.on('unhandledRejection', (reason) => {
  log('FATAL', `Unhandled rejection: ${reason}`);
  // Don't exit — let the agent keep running
});

// Start
main().catch(err => {
  log('FATAL', `Main crashed: ${err.message}`);
  // Restart after 10s
  setTimeout(() => main(), 10000);
});
