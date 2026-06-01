'use strict';
// mcp-server.js -- Remote MCP server for Nathan integration.
//
// Transport: Streamable HTTP (the current MCP transport, replacing SSE).
// Stateless mode -- one transport per POST request, no persistent session.
// Auth: Bearer token via Authorization header, checked BEFORE any tool dispatch.
//       Token in .env as MCP_SERVER_SECRET. Generated on first run if missing.
//
// Port: 3002 (3001 is taken by solomon-dashboard -- pivot documented in commit).
// Public URL: http://167.99.237.26:3002/
//   GET  /health  -- unauth, returns {ok, app, version, uptime}
//   POST /mcp     -- bearer-authed, MCP JSON-RPC 2.0 over HTTP
//
// SDK: @modelcontextprotocol/sdk (installed). Server + StreamableHTTPServerTransport.
// Each tool returns a single text-content block whose body is a JSON string of
// the structured payload, plus isError on failure -- the canonical MCP tool shape.

require('dotenv').config({ path: '/root/solomon-v4/.env' });
const path = require('path');
const fs = require('fs');
const express = require('express');
const crypto = require('crypto');
const { execFile } = require('child_process');
const Database = require('better-sqlite3');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const APP_NAME   = 'solomon-mcp';
const VERSION    = '0.1.0';
const PORT       = parseInt(process.env.MCP_PORT || '3002', 10);
const STARTED_AT = Date.now();
const SOLOMON_DIR = '/root/solomon-v4';
const DB_PATH     = path.join(SOLOMON_DIR, 'solomon.db');
const MASTER_CONTEXT_PATH = path.join(SOLOMON_DIR, 'shultz_master_context.md');
const SAM_QUEUE_DIR = path.join(SOLOMON_DIR, 'sam-queue');
const OWNER_ID = parseInt(process.env.OWNER_CHAT_ID || '8762434280', 10);

// ── BEARER TOKEN BOOTSTRAP ────────────────────────────────────────────────
// On first startup, generate a 32-char URL-safe random secret and append to .env.
// Never log the value; only first/last 4 chars sanitized for diagnostic output.
function _ensureSecret() {
  let secret = process.env.MCP_SERVER_SECRET;
  if (secret && secret.length >= 16 && secret !== 'PLACEHOLDER') return secret;
  secret = crypto.randomBytes(24).toString('base64url'); // 32 chars URL-safe
  const envPath = path.join(SOLOMON_DIR, '.env');
  try {
    let body = fs.readFileSync(envPath, 'utf8');
    if (/^MCP_SERVER_SECRET=/m.test(body)) {
      body = body.replace(/^MCP_SERVER_SECRET=.*$/m, 'MCP_SERVER_SECRET=' + secret);
    } else {
      if (!body.endsWith('\n')) body += '\n';
      body += 'MCP_SERVER_SECRET=' + secret + '\n';
    }
    fs.writeFileSync(envPath, body);
    process.env.MCP_SERVER_SECRET = secret;
    console.log('[' + APP_NAME + '] generated MCP_SERVER_SECRET and wrote to .env');
  } catch (e) {
    console.error('[' + APP_NAME + '] FATAL: could not persist MCP_SERVER_SECRET to .env:', e.message);
    process.exit(1);
  }
  return secret;
}
const BEARER_TOKEN = _ensureSecret();
const _tailToken = (t) => t ? t.slice(0, 4) + '...' + t.slice(-4) : '<none>';

// ── SHARED CLIENTS ────────────────────────────────────────────────────────
const db = new Database(DB_PATH, { readonly: false, fileMustExist: false });
db.pragma('journal_mode = WAL');
const tgBot = process.env.TELEGRAM_BOT_TOKEN
  ? new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false }) // NEVER poll here (would conflict with solomon-v4)
  : null;

// ── TOOL DEFINITIONS ──────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'get_master_context',
    description: 'Read the live Shultz Enterprises master context document (shultz_master_context.md). The single source of truth for the operation -- includes Jed bio, team roster, stack, projects, revenue streams, current pending action items. Always pull this first when bootstrapping a new conversation.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_pm2_status',
    description: "Snapshot of all PM2 processes via `pm2 jlist`. Returns [{name, pid, status, restarts, uptime_ms, mem_bytes, cpu_pct}] for solomon-v4, solomon-scheduler, solomon-dashboard, tradequote-ai, imminav, ruralroute, solomon-mcp, and pm2-logrotate.",
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_sam_queue',
    description: 'List pending Sam-queue jobs (JSON files in /root/solomon-v4/sam-queue/). Returns [{filename, size, mtime, summary}] where summary is parsed from the job\'s `task` field if loadable.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_revenue_snapshot',
    description: "Latest revenue figures across configured streams: Gumroad 24h sales + revenue (from activity_log type='gumroad_sale'), Spreadshirt (not connected -- returned as status note), KDP yesterday royalty (from mem.kdp.last set by the daily Playwright scrape). Returns {gumroad:{sales_24h,revenue_24h_usd}, spreadshirt:{status,...}, kdp:{prior_day_royalty,currency,checked_at}}.",
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_activity_log',
    description: 'Last N entries from the activity_log SQLite table (default 50, max 500). Newest first. Returns [{id, timestamp, type, tool_name, status, summary, duration_ms}].',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 }
      }
    }
  },
  {
    name: 'get_morning_scorecard',
    description: 'Generate the live morning scorecard right now (live YT subs+views, Gumroad 24h, KDP yesterday, campaign tag, budget bar, attention count). Calls scheduler.js exported buildMorningScorecard() under the dual-use guard so no cron jobs register in this process. Returns {scorecard: string}.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'send_telegram',
    description: "Send a message to Jed via the Telegram bot. Goes to owner chat 8762434280. Use sparingly -- every send notifies Jed's phone. Markdown formatting accepted. Returns {ok, message_id, chat_id}.",
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', minLength: 1, maxLength: 4000 }
      },
      required: ['message']
    }
  }
];

// ── TOOL IMPLEMENTATIONS ──────────────────────────────────────────────────
async function _toolGetMasterContext() {
  const text = fs.readFileSync(MASTER_CONTEXT_PATH, 'utf8');
  return { bytes: text.length, content: text };
}

async function _toolGetPm2Status() {
  return await new Promise((resolve, reject) => {
    execFile('pm2', ['jlist'], { timeout: 6000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      let parsed;
      try { parsed = JSON.parse(stdout); }
      catch (e) { return reject(new Error('pm2 jlist returned non-JSON: ' + e.message)); }
      const out = parsed.map(p => ({
        name: p.name,
        pid: p.pid,
        status: p.pm2_env && p.pm2_env.status,
        restarts: p.pm2_env && p.pm2_env.restart_time,
        uptime_ms: p.pm2_env && p.pm2_env.pm_uptime ? Date.now() - p.pm2_env.pm_uptime : 0,
        mem_bytes: p.monit && p.monit.memory,
        cpu_pct: p.monit && p.monit.cpu
      }));
      resolve({ count: out.length, processes: out });
    });
  });
}

async function _toolGetSamQueue() {
  const files = fs.existsSync(SAM_QUEUE_DIR)
    ? fs.readdirSync(SAM_QUEUE_DIR).filter(f => f.endsWith('.json'))
    : [];
  const out = files.map(f => {
    const full = path.join(SAM_QUEUE_DIR, f);
    const st = fs.statSync(full);
    let summary = '(could not parse)';
    try {
      const job = JSON.parse(fs.readFileSync(full, 'utf8'));
      summary = job.task || job.template_id || '(no task field)';
    } catch (_) {}
    return { filename: f, size: st.size, mtime: st.mtime.toISOString(), summary };
  });
  return { count: out.length, jobs: out };
}

async function _toolGetRevenueSnapshot() {
  // Gumroad 24h: sum from activity_log
  let gumroad = { sales_24h: 0, revenue_24h_usd: 0 };
  try {
    const rows = db.prepare("SELECT summary FROM activity_log WHERE type = 'gumroad_sale' AND timestamp >= datetime('now','-24 hours')").all();
    let total = 0;
    for (const r of rows) {
      const m = (r.summary || '').match(/\$\s*([\d.]+)/);
      if (m) total += parseFloat(m[1]);
    }
    gumroad = { sales_24h: rows.length, revenue_24h_usd: Number(total.toFixed(2)) };
  } catch (e) { gumroad = { error: e.message }; }

  // Spreadshirt: not connected on Jed's plan (per master context)
  const spreadshirt = { status: 'not_connected', note: 'No API on current Spreadshirt plan; check buildingshultz.myspreadshop.com manually.' };

  // KDP: latest scrape result stored at mem.kdp.last
  let kdp = { status: 'not_set' };
  try {
    const row = db.prepare("SELECT value FROM memory WHERE category='kdp' AND key='last'").get();
    if (row && row.value) {
      const k = JSON.parse(row.value);
      if (k.auth_missing)      kdp = { status: 'auth_missing', note: 'Run PLAYWRIGHT_KDP_AUTH.md to enable.' };
      else if (k.auth_expired) kdp = { status: 'auth_expired', note: 'Re-run KDP Playwright capture.' };
      else if (k.prior_day_royalty) kdp = { status: 'ok', prior_day_royalty: k.prior_day_royalty, currency: k.currency || 'USD', checked_at: k.checked_at };
      else if (k.error)        kdp = { status: 'error', error: String(k.error).slice(0, 200) };
      else                     kdp = { status: 'unknown', raw: k };
    }
  } catch (e) { kdp = { status: 'error', error: e.message }; }

  return { gumroad, spreadshirt, kdp, generated_at: new Date().toISOString() };
}

async function _toolGetActivityLog(args) {
  let limit = (args && Number.isInteger(args.limit)) ? args.limit : 50;
  if (limit < 1) limit = 1;
  if (limit > 500) limit = 500;
  const rows = db.prepare(`
    SELECT id, timestamp, type, tool_name, status, summary, duration_ms
    FROM activity_log
    ORDER BY id DESC
    LIMIT ?
  `).all(limit);
  return { count: rows.length, entries: rows };
}

async function _toolGetMorningScorecard() {
  // Lazy require so scheduler.js dual-use guard fires cleanly only when called.
  const scheduler = require('/root/solomon-v4/scheduler.js');
  if (typeof scheduler.buildMorningScorecard !== 'function') {
    throw new Error('scheduler.buildMorningScorecard not exported -- check scheduler.js commit history');
  }
  const text = await scheduler.buildMorningScorecard();
  return { scorecard: text, generated_at: new Date().toISOString() };
}

async function _toolSendTelegram(args) {
  if (!args || typeof args.message !== 'string' || !args.message.trim()) {
    throw new Error('message required (non-empty string)');
  }
  if (!tgBot) throw new Error('TELEGRAM_BOT_TOKEN not configured');
  const sent = await tgBot.sendMessage(OWNER_ID, args.message.slice(0, 4000));
  return { ok: true, message_id: sent.message_id, chat_id: OWNER_ID };
}

const TOOL_IMPLS = {
  get_master_context:   _toolGetMasterContext,
  get_pm2_status:       _toolGetPm2Status,
  get_sam_queue:        _toolGetSamQueue,
  get_revenue_snapshot: _toolGetRevenueSnapshot,
  get_activity_log:     _toolGetActivityLog,
  get_morning_scorecard:_toolGetMorningScorecard,
  send_telegram:        _toolSendTelegram
};

// ── MCP SERVER FACTORY ────────────────────────────────────────────────────
// Stateless mode: a fresh Server + transport per POST request. This is the
// simplest pattern for remote MCP -- no session cookies, no SSE persistence,
// each tool call is a clean JSON-RPC round-trip. Suitable for Nathan / Claude
// project connectors which expect this exact shape.
function buildServer() {
  const server = new Server(
    { name: APP_NAME, version: VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params || {};
    const impl = TOOL_IMPLS[name];
    if (!impl) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'unknown tool: ' + name }) }],
        isError: true
      };
    }
    const t0 = Date.now();
    try {
      const result = await impl(args);
      console.log(`[${APP_NAME}] tool ${name} ok in ${Date.now() - t0}ms`);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        isError: false
      };
    } catch (e) {
      console.error(`[${APP_NAME}] tool ${name} FAIL in ${Date.now() - t0}ms:`, e.message);
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: e.message || String(e), tool: name }) }],
        isError: true
      };
    }
  });

  return server;
}

// ── EXPRESS APP ───────────────────────────────────────────────────────────
const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '256kb' }));

// /health -- public, no auth (so monitors + curl from anywhere can probe)
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    app: APP_NAME,
    version: VERSION,
    uptime: Math.round((Date.now() - STARTED_AT) / 1000),
    transport: 'streamable_http',
    tools: TOOLS.length,
    auth: 'bearer'
  });
});

// /mcp -- bearer-authed JSON-RPC over HTTP
function _auth(req, res, next) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Missing Authorization: Bearer <token>' } });
  }
  // Timing-safe compare to avoid timing oracle on the token.
  const a = Buffer.from(m[1]);
  const b = Buffer.from(BEARER_TOKEN);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Invalid bearer token' } });
  }
  next();
}

app.post('/mcp', _auth, async (req, res) => {
  // Stateless: spin up a transport + server per request, handle, close.
  // sessionIdGenerator: undefined = no session, fresh per call.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = buildServer();
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error(`[${APP_NAME}] /mcp handler error:`, e.message);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error: ' + e.message } });
    }
  }
});

// GET /mcp -- the MCP streamable HTTP spec lets the server return 405 for
// pure GET when SSE isn't supported. Sticking to stateless POST-only.
app.get('/mcp', _auth, (req, res) => {
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'GET /mcp not supported in stateless mode -- use POST with JSON-RPC body' } });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[${APP_NAME}] v${VERSION} listening on 0.0.0.0:${PORT}`);
  console.log(`[${APP_NAME}] health:  http://0.0.0.0:${PORT}/health`);
  console.log(`[${APP_NAME}] mcp:     http://0.0.0.0:${PORT}/mcp  (bearer required)`);
  console.log(`[${APP_NAME}] tools:   ${TOOLS.length} -- ${TOOLS.map(t => t.name).join(', ')}`);
  console.log(`[${APP_NAME}] token:   ${_tailToken(BEARER_TOKEN)}  (full value in /root/solomon-v4/.env as MCP_SERVER_SECRET)`);
});

process.on('unhandledRejection', (e) => console.error(`[${APP_NAME}] unhandledRejection:`, e));
process.on('uncaughtException', (e) => console.error(`[${APP_NAME}] uncaughtException:`, e));
