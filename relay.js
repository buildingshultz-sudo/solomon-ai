/**
 * Solomon Relay Server v4.0 (Browser Automation Edition)
 *
 * Bridges the VPS bot with the PC Agent. Features:
 * - HTTP endpoints for command queuing and result retrieval
 * - v4 Agent compatibility: /agent/poll, /agent/result, relaxed heartbeat
 * - Browser automation command type with extended timeouts (120s)
 * - Rate limiting (max 20 commands/minute)
 * - Bounded result storage with TTL cleanup
 * - Proper error handling and logging
 * - Serves the PC Agent script for easy updates
 * - Auto-upgrade push mechanism for PC Agent
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const PORT = 3001;
const SHARED_SECRET = '7f3a9b2e-1d4c-4e8f-b6a5-3c7d8e9f0a1b';
const MAX_PENDING_COMMANDS = 20;
const MAX_STORED_RESULTS = 100;
const RESULT_TTL_MS = 300000;  // 5 minutes
const RATE_LIMIT_WINDOW = 60000;  // 1 minute
const RATE_LIMIT_MAX = 20;  // 20 commands per minute
const BROWSER_COMMAND_TIMEOUT = 120000; // 2 minutes for browser ops
const DEFAULT_COMMAND_TIMEOUT = 60000;  // 1 minute for regular ops
// ── STATE ──────────────────────────────────────────────────────────────────
let agentState = {
  online: false,
  lastHeartbeat: null,
  version: null,
  agentId: null,
  tabs: 0,
  uptime: 0,
  browserReady: false
};
const pendingCommands = [];  // { id, command, type, timeout, queuedAt }
const completedResults = new Map();  // id -> { result, completedAt }
const rateLimitWindow = [];  // timestamps of recent command queues
// ── HELPERS ────────────────────────────────────────────────────────────────
function generateId() {
  return `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
function isAgentOnline() {
  if (!agentState.lastHeartbeat) return false;
  const age = Date.now() - agentState.lastHeartbeat;
  return age < 30000;  // 30s threshold
}
function isAgentStale() {
  if (!agentState.lastHeartbeat) return false;
  const age = Date.now() - agentState.lastHeartbeat;
  return age >= 30000 && age < 120000;  // 30s-2min = stale
}
function checkRateLimit() {
  const now = Date.now();
  while (rateLimitWindow.length > 0 && rateLimitWindow[0] < now - RATE_LIMIT_WINDOW) {
    rateLimitWindow.shift();
  }
  return rateLimitWindow.length < RATE_LIMIT_MAX;
}
function cleanupResults() {
  const now = Date.now();
  for (const [id, entry] of completedResults) {
    if (now - entry.completedAt > RESULT_TTL_MS) {
      completedResults.delete(id);
    }
  }
  if (completedResults.size > MAX_STORED_RESULTS) {
    const entries = [...completedResults.entries()].sort((a, b) => a[1].completedAt - b[1].completedAt);
    const toRemove = entries.slice(0, entries.length - MAX_STORED_RESULTS);
    for (const [id] of toRemove) completedResults.delete(id);
  }
}
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10485760) { // 10MB limit (screenshots can be large)
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}
function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}
function log(level, msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [RELAY] [${level}] ${msg}`);
}
// ── HTTP SERVER ────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method;
  const pathname = url.pathname;
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  try {
    // ── HEALTH ──────────────────────────────────────────────────────
    if (pathname === '/health' && method === 'GET') {
      return sendJSON(res, 200, {
        status: 'ok',
        service: 'solomon-relay',
        version: '4.0.0',
        pending: pendingCommands.length,
        completed: completedResults.size,
        agent: {
          online: isAgentOnline(),
          stale: isAgentStale(),
          lastSeen: agentState.lastHeartbeat,
          version: agentState.version,
          tabs: agentState.tabs,
          browserReady: agentState.browserReady
        }
      });
    }
    // ── AGENT STATUS ────────────────────────────────────────────────
    if (pathname === '/agent/status' && method === 'GET') {
      const online = isAgentOnline();
      const stale = isAgentStale();
      const ageSeconds = agentState.lastHeartbeat
        ? Math.floor((Date.now() - agentState.lastHeartbeat) / 1000)
        : null;
      return sendJSON(res, 200, {
        ok: true,
        online,
        stale,
        lastHeartbeat: agentState.lastHeartbeat,
        ageSeconds,
        version: agentState.version,
        agentId: agentState.agentId,
        tabs: agentState.tabs,
        uptime: agentState.uptime,
        browserReady: agentState.browserReady
      });
    }
    // ── AGENT HEARTBEAT (accepts both v4 and v5 format) ─────────────
    if (pathname === '/agent/heartbeat' && method === 'POST') {
      const body = await parseBody(req);
      log('INFO', 'Heartbeat from ' + req.socket.remoteAddress + ' agentId=' + body.agentId);
      // v5 sends secret, v4 does not — accept both
      if (body.secret && body.secret !== SHARED_SECRET) {
        return sendJSON(res, 401, { ok: false, error: 'Invalid secret' });
      }
      agentState = {
        online: true,
        lastHeartbeat: Date.now(),
        version: body.version || agentState.version,
        agentId: body.agentId || agentState.agentId,
        tabs: body.tabs || body.activeProcesses || 0,
        uptime: body.uptime || 0,
        browserReady: body.browserReady || false
      };
      // Persist agent state to disk for crash recovery
      try {
        fs.writeFileSync(path.join(__dirname, '.agent_state.json'), JSON.stringify(agentState));
      } catch {}
      return sendJSON(res, 200, { ok: true });
    }
    // ── AGENT POLL (v4 compatibility — agent polls for commands) ─────
    if (pathname === '/agent/poll' && method === 'GET') {
      log('INFO', `Agent poll hit from ${req.socket.remoteAddress} - ${pendingCommands.length} cmds pending`);
      const commands = pendingCommands.splice(0, 5);
      if (commands.length === 0) {
        res.writeHead(204);
        res.end();
        return;
      }
      return sendJSON(res, 200, { commands });
    }
    // ── AGENT RESULT (v4 compatibility — agent posts results) ────────
    if (pathname === '/agent/result' && method === 'POST') {
      const rawBody = await new Promise((resolve) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => resolve(data));
      });
      log('INFO', 'RAW Result POST from ' + req.socket.remoteAddress + ': ' + rawBody.slice(0, 500));
      let body = {};
      try { body = JSON.parse(rawBody); } catch(e) { log('ERROR', 'Result parse error: ' + e.message); }
      log('INFO', 'Result POST received: ' + JSON.stringify(body).slice(0, 200));
      if (body.id) {
        completedResults.set(body.id, {
          status: 'completed',
          result: {
            exitCode: body.exitCode != null ? body.exitCode : 0,
            stdout: body.output || '',
            stderr: body.error || '',
            screenshot: body.screenshot || null
          },
          completedAt: Date.now()
        });
        log('INFO', `Result (v4): ${body.id} (exit: ${body.exitCode})`);
      }
      return sendJSON(res, 200, { ok: true });
    }
    // ── QUEUE COMMAND (supports powershell, cmd, and browser types) ──
    if (pathname === '/command/queue' && method === 'POST') {
      const body = await parseBody(req);
      if (!body.command) {
        return sendJSON(res, 400, { ok: false, error: 'Missing command' });
      }
      if (!checkRateLimit()) {
        return sendJSON(res, 429, { ok: false, error: 'Rate limit exceeded (20/min)' });
      }
      if (pendingCommands.length >= MAX_PENDING_COMMANDS) {
        return sendJSON(res, 503, { ok: false, error: `Queue full (${MAX_PENDING_COMMANDS} pending)` });
      }
      const cmdType = body.type || 'powershell';
      const id = generateId();
      // Browser commands get extended timeout
      const timeout = cmdType === 'browser'
        ? (body.timeout || BROWSER_COMMAND_TIMEOUT)
        : (body.timeout || DEFAULT_COMMAND_TIMEOUT);
      pendingCommands.push({
        id,
        command: body.command,
        type: cmdType,
        timeout,
        queuedAt: Date.now()
      });
      rateLimitWindow.push(Date.now());
      log('INFO', `Queued: ${id} [${cmdType}] timeout=${timeout}ms ${body.command.slice(0, 80)}`);
      return sendJSON(res, 200, { ok: true, id, position: pendingCommands.length, type: cmdType });
    }
    // ── BROWSER COMMAND (convenience endpoint) ──────────────────────
    if (pathname === '/browser/command' && method === 'POST') {
      const body = await parseBody(req);
      if (!body.action) {
        return sendJSON(res, 400, { ok: false, error: 'Missing action (navigate, click, fill, screenshot, eval, close)' });
      }
      if (!checkRateLimit()) {
        return sendJSON(res, 429, { ok: false, error: 'Rate limit exceeded (20/min)' });
      }
      if (pendingCommands.length >= MAX_PENDING_COMMANDS) {
        return sendJSON(res, 503, { ok: false, error: `Queue full (${MAX_PENDING_COMMANDS} pending)` });
      }
      const id = generateId();
      // Package as a browser command with the action payload
      pendingCommands.push({
        id,
        command: JSON.stringify({
          action: body.action,
          url: body.url || null,
          selector: body.selector || null,
          value: body.value || null,
          script: body.script || null,
          options: body.options || {}
        }),
        type: 'browser',
        timeout: body.timeout || BROWSER_COMMAND_TIMEOUT,
        queuedAt: Date.now()
      });
      rateLimitWindow.push(Date.now());
      log('INFO', `Browser cmd queued: ${id} [${body.action}] ${body.url || body.selector || ''}`);
      return sendJSON(res, 200, { ok: true, id, type: 'browser', action: body.action });
    }
    // ── GET PENDING COMMANDS (v5 agent or bot polls this) ────────────
    if (pathname === '/command/pending' && method === 'GET') {
      log('INFO', `/command/pending hit from ${req.socket.remoteAddress} - ${pendingCommands.length} cmds`);
      const commands = pendingCommands.splice(0, 5);
      return sendJSON(res, 200, { commands });
    }
    // ── SUBMIT RESULT (v5 agent posts results here) ─────────────────
    if (pathname.startsWith('/command/result/') && method === 'POST') {
      const cmdId = pathname.split('/').pop();
      const body = await parseBody(req);
      completedResults.set(cmdId, {
        status: 'completed',
        result: body.result || body,
        completedAt: Date.now()
      });
      log('INFO', `Result received: ${cmdId} (exit: ${body.result?.exitCode ?? body.exitCode})`);
      return sendJSON(res, 200, { ok: true });
    }
    // ── GET RESULT (bot polls this) ─────────────────────────────────
    if (pathname.startsWith('/command/result/') && method === 'GET') {
      const cmdId = pathname.split('/').pop();
      const entry = completedResults.get(cmdId);
      if (entry) {
        return sendJSON(res, 200, entry);
      }
      const pending = pendingCommands.find(c => c.id === cmdId);
      if (pending) {
        return sendJSON(res, 200, { status: 'pending', position: pendingCommands.indexOf(pending) + 1 });
      }
      return sendJSON(res, 200, { status: 'unknown' });
    }
    // ── SERVE FIXED V4 AGENT SCRIPT ─────────────────────────────────
    if (pathname === '/agent/script-v4-fixed' && method === 'GET') {
      const fixedPath = path.join(__dirname, 'solomon-agent-v4-fixed.js');
      if (fs.existsSync(fixedPath)) {
        const content2 = fs.readFileSync(fixedPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(content2);
        return;
      }
      return sendJSON(res, 404, { error: 'Fixed agent not found' });
    }
    // ── SERVE PC AGENT SCRIPT ───────────────────────────────────────
    if (pathname === '/agent/script' && method === 'GET') {
      const agentPath = path.join(__dirname, 'solomon-agent.js');
      if (fs.existsSync(agentPath)) {
        const content = fs.readFileSync(agentPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(content);
        return;
      }
      return sendJSON(res, 404, { error: 'Agent script not found' });
    }
    // ── PUSH UPGRADE TO AGENT ───────────────────────────────────────
    if (pathname === '/agent/upgrade' && method === 'POST') {
      // Queue a special upgrade command that the agent will recognize
      const upgradeScript = fs.readFileSync(path.join(__dirname, 'solomon-agent.js'), 'utf8');
      const id = generateId();
      pendingCommands.push({
        id,
        command: `__SELF_UPGRADE__`,
        type: 'upgrade',
        payload: upgradeScript,
        timeout: 120000,
        queuedAt: Date.now()
      });
      log('INFO', `Upgrade command queued: ${id}`);
      return sendJSON(res, 200, { ok: true, id, message: 'Upgrade queued for next agent poll' });
    }
    // ── 404 ─────────────────────────────────────────────────────────
    sendJSON(res, 404, { error: 'Not found' });
  } catch (e) {
    log('ERROR', `Request error: ${e.message}`);
    sendJSON(res, 500, { error: 'Internal server error' });
  }
});
// ── CLEANUP TIMER ──────────────────────────────────────────────────────────
setInterval(cleanupResults, 60000);
// ── STALE COMMAND CLEANUP ──────────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  while (pendingCommands.length > 0 && now - pendingCommands[0].queuedAt > 180000) {
    const stale = pendingCommands.shift();
    completedResults.set(stale.id, {
      status: 'completed',
      result: { exitCode: -1, stdout: '(command expired — agent did not pick up within 3 minutes)', stderr: '' },
      completedAt: now
    });
    log('WARN', `Expired: ${stale.id}`);
  }
}, 30000);
// ── START ──────────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  log('INFO', `Solomon Relay v4.0 listening on port ${PORT}`);
  log('INFO', `Rate limit: ${RATE_LIMIT_MAX} commands/${RATE_LIMIT_WINDOW/1000}s`);
  log('INFO', `Max pending: ${MAX_PENDING_COMMANDS}, Result TTL: ${RESULT_TTL_MS/1000}s`);
  log('INFO', `Browser command timeout: ${BROWSER_COMMAND_TIMEOUT/1000}s`);
  log('INFO', `Endpoints: /browser/command (POST), /command/queue (POST), /agent/poll (GET)`);
});
// Load persisted agent state
try {
  const saved = JSON.parse(fs.readFileSync(path.join(__dirname, '.agent_state.json'), 'utf8'));
  if (saved.lastHeartbeat && Date.now() - saved.lastHeartbeat < 120000) {
    agentState = saved;
    log('INFO', `Restored agent state: ${saved.agentId} v${saved.version}`);
  }
} catch {}
