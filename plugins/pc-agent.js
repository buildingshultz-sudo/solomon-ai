/**
 * PC Agent Plugin v2.1 — Remote Windows PC Control via Relay
 * 
 * v2.1 Changes:
 * - Resilient connection: graceful timeout handling, no hard crashes
 * - Retry logic with exponential backoff for transient failures
 * - Clear error messages when PC Agent is offline (not crash/hang)
 * - AbortSignal.timeout wrapped in try/catch for older Node compatibility
 */
const http = require('http');
let config = {};

const MAX_RETRIES = 2;
const RELAY_TIMEOUT = 10000; // 10s for relay requests
const STATUS_CACHE_MS = 5000; // Cache status for 5s to avoid hammering

let lastStatusCheck = 0;
let lastStatusResult = null;

module.exports = {
  name: 'pc-agent',
  version: '2.1.0',
  description: 'Remote PC control: execute commands, open URLs, manage files on Jed\'s Windows PC',
  requiredKeys: [],
  commands: ['/pc', '/pc_status', '/open_url'],
  tools: [
    {
      type: 'function', function: {
        name: 'pc_execute',
        description: 'Execute a PowerShell command on Jed\'s Windows PC via the relay agent',
        parameters: { type: 'object', properties: {
          command: { type: 'string', description: 'PowerShell command to execute' },
          timeout: { type: 'number', description: 'Timeout in ms (default 60000)' }
        }, required: ['command'] }
      }
    },
    {
      type: 'function', function: {
        name: 'pc_open_url',
        description: 'Open a URL in Chrome on Jed\'s PC',
        parameters: { type: 'object', properties: {
          url: { type: 'string', description: 'URL to open' }
        }, required: ['url'] }
      }
    },
    {
      type: 'function', function: {
        name: 'pc_status',
        description: 'Check if the PC Agent is online and responsive',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    {
      type: 'function', function: {
        name: 'pc_screenshot',
        description: 'Take a screenshot of the PC screen',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    }
  ],
  init(deps) { config = deps.config; },
  get _active() { return true; },
  async executeTool(toolName, args) {
    try {
      switch (toolName) {
        case 'pc_execute': return await pcExecute(args.command, args.timeout);
        case 'pc_open_url': return await pcOpenUrl(args.url);
        case 'pc_status': return await pcStatus();
        case 'pc_screenshot': return await pcScreenshot();
        default: return { success: false, error: `Unknown tool: ${toolName}` };
      }
    } catch (e) {
      // Never let the plugin crash the bot
      return { success: false, error: `PC Agent error: ${e.message}`, recoverable: true };
    }
  }
};

async function relayRequest(endpoint, method = 'GET', body = null, timeoutMs = RELAY_TIMEOUT) {
  const url = `${config.RELAY_URL || 'http://127.0.0.1:3001'}${endpoint}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const opts = { 
      method, 
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    clearTimeout(timer);
    return await res.json();
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError' || e.message.includes('abort')) {
      throw new Error(`Relay timeout after ${timeoutMs}ms — relay server may be down`);
    }
    throw new Error(`Relay connection failed: ${e.message}`);
  }
}

async function pcStatus() {
  // Use cached status if recent (avoid hammering relay)
  const now = Date.now();
  if (lastStatusResult && (now - lastStatusCheck) < STATUS_CACHE_MS) {
    return lastStatusResult;
  }
  
  try {
    const data = await relayRequest('/agent/status');
    lastStatusCheck = now;
    lastStatusResult = {
      success: true,
      online: !!data.online,
      stale: !!data.stale,
      version: data.version || 'unknown',
      lastSeen: data.ageSeconds ? `${data.ageSeconds}s ago` : 'never',
      tabs: data.tabs || 0,
      browserReady: data.browserReady || false
    };
    return lastStatusResult;
  } catch (e) {
    lastStatusCheck = now;
    lastStatusResult = { 
      success: false, 
      online: false, 
      error: e.message,
      hint: 'PC Agent is not connected. Jed\'s PC may be off or the agent is not running.'
    };
    return lastStatusResult;
  }
}

async function pcExecute(command, timeout = 60000) {
  // Pre-flight: check agent status (cached, won't block long)
  const status = await pcStatus();
  if (!status.online) {
    return { 
      success: false, 
      error: 'PC Agent is offline. Jed\'s PC may be off or the agent is not running.',
      offline: true,
      hint: 'This task requires the PC Agent. Mark as blocked until PC is available.'
    };
  }

  // Queue command with retry
  let lastError = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const queueRes = await relayRequest('/command/queue', 'POST', { command, type: 'powershell', timeout }, 15000);
      if (!queueRes.ok) {
        lastError = queueRes.error || 'Failed to queue command';
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); // backoff
          continue;
        }
        return { success: false, error: lastError };
      }
      
      const cmdId = queueRes.id;
      
      // Poll for result with graceful timeout
      const deadline = Date.now() + timeout + 15000;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 2000));
        
        try {
          const result = await relayRequest(`/command/result/${cmdId}`, 'GET', null, 10000);
          if (result.status === 'completed') {
            const r = result.result;
            if (r.timedOut) {
              return { success: false, error: 'Command timed out on PC', output: r.stdout || '' };
            }
            return {
              success: r.exitCode === 0,
              exitCode: r.exitCode,
              output: r.stdout || '(no output)',
              error: r.stderr || null,
              screenshot: r.screenshot || null
            };
          }
          if (result.status === 'unknown') {
            // Command was lost (expired or relay restarted)
            return { success: false, error: 'Command expired — agent did not pick it up in time', expired: true };
          }
        } catch (pollErr) {
          // Transient poll failure — keep trying until deadline
          console.log(`[PC-AGENT] Poll error (will retry): ${pollErr.message}`);
        }
      }
      
      return { success: false, error: 'Timed out waiting for PC Agent response', timedOut: true };
    } catch (e) {
      lastError = e.message;
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
    }
  }
  
  return { success: false, error: `PC Agent failed after ${MAX_RETRIES + 1} attempts: ${lastError}` };
}

async function pcOpenUrl(url) {
  // Sanitize URL
  url = (url || '').replace(/^["'*]+|["'*]+$/g, '').replace(/\*\*/g, '').trim();
  if (!url.startsWith('http')) url = 'https://' + url;
  const command = `Start-Process "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" -ArgumentList "${url}"`;
  return await pcExecute(command, 15000);
}

async function pcScreenshot() {
  const command = `
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $path = "$env:USERPROFILE\\SolomonAgent\\screenshots\\screen_$(Get-Date -Format 'yyyyMMdd_HHmmss').png"
    $bmp.Save($path)
    $g.Dispose()
    $bmp.Dispose()
    Write-Output $path
  `;
  return await pcExecute(command, 15000);
}
