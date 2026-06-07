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
  },
  {
    name: 'append_master_context',
    description: "Persist a CONFIRMED decision to the permanent master context file (shultz_master_context.md), APPEND-ONLY. Prepends a [YYYY-MM-DD CT] timestamp and inserts the entry as a new line directly under the chosen section's log marker, then git add/commit/pushes. Use this to lock in a decision during a chat. Append-only by construction: never edits, deletes, reorders, or compresses any existing line. REFUSES any entry that looks like a credential/secret (sk-, API key, token, password, secret, Bearer, private key) and caps a single entry at ~1000 chars. Returns {ok, section, entry, committed, commit, pushed}.",
    inputSchema: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          enum: ['PROJECTS', 'GENERAL', 'REVENUE', 'STACK', 'SAMQUEUE'],
          description: 'Which section log marker to append under.'
        },
        entry: {
          type: 'string',
          minLength: 1,
          maxLength: 1000,
          description: 'Plain-text decision to record. No credentials/secrets. The timestamp is added automatically — do not include one.'
        }
      },
      required: ['section', 'entry']
    }
  },
  {
    name: 'dispatch_task',
    description: 'Dispatch a task from Nathan to Sam or Caleb via Solomon. Solomon owns routing and approval. ALL irreversibles hard-escalate to Jed regardless of other flags.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: ['sam', 'caleb', 'gabriel'], description: 'sam=CTO (build/shell/git/deploy), caleb=VP Ops (browser/gmail/spreadshop/etc), gabriel=auto-route by task_type.' },
        task_type: { type: 'string', description: 'build/fix/deploy/shell/git/browser/verify/click/capture/gmail/spreadshop/kdp/youtube' },
        title: { type: 'string', description: 'short Telegram label' },
        description: { type: 'string', description: 'full context Sam or Caleb needs — NO credentials' },
        priority: { type: 'string', enum: ['high', 'normal', 'low'], default: 'normal' },
        requires_approval: { type: 'boolean', default: true },
        is_irreversible: { type: 'boolean', default: false, description: 'money/legal/publish/delete/UAC/deploy-to-prod; if true hard-escalates to Jed regardless of requires_approval.' },
        params: { type: 'object', description: 'task-specific fields forwarded to the Caleb/Playwright executor, e.g. {url, book_title, kdp_section, file_path, wait_ms}. NO credentials.' },
        urls: { type: 'array', items: { type: 'string' }, description: 'optional list of URLs for multi-site browser/scrape tasks. The executor iterates each, finds the contact email (mailto/contact/about) or contact-form URL, and returns results for all.' }
      },
      required: ['target', 'task_type', 'title', 'description']
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

// ── append_master_context — Nathan-facing append-only writer ──────────────
// HARD CONSTRAINTS (enforced here, BEFORE any write):
//   * section must be one of the 5 known log markers
//   * entry capped at 1000 chars
//   * entry rejected if it matches any credential pattern
//   * NEVER writes .env — the reused updater only ever touches the master
//     context file, so this is structurally guaranteed
// The actual file mutation REUSES the existing 2026-05-29 append-only updater
// in tools.js (executeTool -> appendMasterContext): timestamp + insert under
// the first <!-- LOG:section --> marker, never deleting/reordering anything.
// This tool adds only the git add/commit/push orchestration on top.
const APPEND_ALLOWED_SECTIONS = ['PROJECTS', 'GENERAL', 'REVENUE', 'STACK', 'SAMQUEUE'];
const APPEND_MAX_LEN = 1000;
const CREDENTIAL_PATTERNS = [
  /sk-/i,                                   // Anthropic/OpenAI-style key prefix
  /\bapi[ _-]?keys?\b/i,                    // "API key" / api_key / apikey
  /\btokens?\b/i,                           // token / tokens
  /\bpasswords?\b/i,                        // password(s)
  /\bsecrets?\b/i,                          // secret(s)
  /\bbearer\b/i,                            // Bearer <...>
  /\bprivate[ _-]?key\b/i,                  // private key
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i     // PEM block
];

function _execFileP(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      if (err) { err.stdout = String(stdout || ''); err.stderr = String(stderr || ''); return reject(err); }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

async function _toolAppendMasterContext(args) {
  const section = String((args && args.section) || '').toUpperCase().trim();
  const entry = (args && typeof args.entry === 'string') ? args.entry.trim() : '';

  if (!APPEND_ALLOWED_SECTIONS.includes(section)) {
    throw new Error('invalid section: must be one of ' + APPEND_ALLOWED_SECTIONS.join(', '));
  }
  if (!entry) throw new Error('entry required (non-empty plain text)');
  if (entry.length > APPEND_MAX_LEN) {
    throw new Error('entry too long: ' + entry.length + ' chars (max ' + APPEND_MAX_LEN + ')');
  }
  for (const re of CREDENTIAL_PATTERNS) {
    if (re.test(entry)) {
      throw new Error('refused: entry looks like it contains a credential/secret (matched ' + re + '). The master context never stores secrets.');
    }
  }

  // Reuse the existing append-only updater (tools.js). Lazy-require so the tools
  // dependency graph only loads when this tool is actually invoked.
  const { executeTool } = require(path.join(SOLOMON_DIR, 'tools.js'));
  const r = await executeTool('append_master_context', { section, entry });
  if (!r || !r.ok) {
    throw new Error('append failed: ' + ((r && r.error) || 'unknown error from updater'));
  }

  // git add/commit/push — orchestration only (file already mutated above).
  // The entry text is intentionally NOT placed in the commit message, so even a
  // benign entry can never leak into commit metadata.
  const gitOpts = { cwd: SOLOMON_DIR, timeout: 30000, maxBuffer: 4 * 1024 * 1024 };
  await _execFileP('git', ['add', 'shultz_master_context.md'], gitOpts);
  let committed = false, commitHash = null, pushed = false;
  try {
    await _execFileP('git', ['commit', '-m', 'docs(master-context): Nathan append [' + section + ']'], gitOpts);
    committed = true;
  } catch (e) {
    const blob = (e.stdout || '') + (e.stderr || '') + (e.message || '');
    if (!/nothing to commit/i.test(blob)) throw e; // genuine failure
  }
  if (committed) {
    const h = await _execFileP('git', ['rev-parse', 'HEAD'], gitOpts);
    commitHash = h.stdout.trim();
    await _execFileP('git', ['push', 'origin', 'master'], gitOpts);
    pushed = true;
  }

  return { ok: true, section: r.section, entry: r.entry, committed, commit: commitHash, pushed };
}

// ── dispatch_task — Nathan → Solomon → Sam/Caleb ──────────────────────────
// All routing/approval logic lives in dispatch-core.js (shared with bot.js).
// Gate 0 runs inside prepareDispatch(): a credential hit THROWS, which the
// CallTool handler surfaces as an error — no file written, no Telegram sent.
async function _toolDispatchTask(args) {
  const core = require(path.join(SOLOMON_DIR, 'dispatch-core.js'));
  const { record, autoProceed } = core.prepareDispatch(args || {});
  // Auto-queue path (requires_approval=false AND not irreversible): route now.
  if (autoProceed) {
    try { await core.routeOnApprove(record); }
    catch (e) { console.error(`[${APP_NAME}] dispatch_task auto-route failed:`, e.message); }
  }
  // Telegram card — Approve/Cancel buttons only while pending_approval.
  if (tgBot) {
    try {
      const card = core.buildCard(record);
      await tgBot.sendMessage(OWNER_ID, card.text, card.reply_markup ? { reply_markup: card.reply_markup } : {});
    } catch (e) {
      console.error(`[${APP_NAME}] dispatch_task telegram send failed:`, e.message);
    }
  }
  return {
    ok: true, id: record.id, target: record.target, requested_target: record.requested_target,
    rerouted: record.rerouted, status: record.status, hard_escalated: record.hard_escalated,
    auto_proceeded: autoProceed
  };
}

const TOOL_IMPLS = {
  get_master_context:   _toolGetMasterContext,
  get_pm2_status:       _toolGetPm2Status,
  get_sam_queue:        _toolGetSamQueue,
  get_revenue_snapshot: _toolGetRevenueSnapshot,
  get_activity_log:     _toolGetActivityLog,
  get_morning_scorecard:_toolGetMorningScorecard,
  send_telegram:        _toolSendTelegram,
  append_master_context:_toolAppendMasterContext,
  dispatch_task:        _toolDispatchTask
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
// Form-encoded bodies for OAuth /token (Claude UI may POST application/x-www-form-urlencoded)
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

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

// ── OAUTH 2.0 WRAPPER FOR CLAUDE CONNECTOR HANDSHAKE ──────────────────────
// claude.ai's custom-connector UI expects a real OAuth authorization_code flow
// before it will mark the connector "connected". We don't actually authenticate
// anyone here -- this is a single-tenant wrapper that always issues the existing
// MCP_SERVER_SECRET back to the client after the round-trip. The real auth on
// /mcp is still the bearer check via _auth(). The OAuth endpoints themselves
// must NOT require auth -- they ARE the handshake that produces the bearer.
//
// Security: the only meaningful guard is that redirect_uri must be claude.ai /
// claude.com. Without it, anyone could initiate /authorize and trick our
// redirect into leaking the code to an attacker's domain.

const OAUTH_ISSUER = process.env.MCP_OAUTH_ISSUER || 'https://mcp.buildingshultz.com';
const OAUTH_REDIRECT_RE = /^https:\/\/([a-z0-9-]+\.)*claude\.(ai|com)(\/|$|\?)/i;
const OAUTH_CODE_TTL_MS = 5 * 60 * 1000;
const oauthCodes = new Map();

function _oauthNewCode() { return crypto.randomBytes(16).toString('hex'); }
function _oauthGc() {
  const now = Date.now();
  for (const [k, v] of oauthCodes) if (v.expires_at <= now) oauthCodes.delete(k);
}
setInterval(_oauthGc, 60 * 1000).unref();

function _oauthCors(req, res) {
  const origin = req.headers.origin || '';
  // Echo claude.* origins so credentialed requests work; fallback to * for others.
  res.set('Access-Control-Allow-Origin', OAUTH_REDIRECT_RE.test(origin + '/') ? origin : '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Max-Age', '600');
}

function _htmlEscape(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}

function _oauthErrorHtml(title, detail) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${_htmlEscape(title)}</title>
<style>body{background:#1a1a1a;color:#f3ede1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem}.c{max-width:30rem;text-align:center}h1{color:#E25822;margin:0 0 .5rem;font-size:1.4rem}p{color:#b5ad9d;line-height:1.5}</style>
</head><body><div class="c"><h1>${_htmlEscape(title)}</h1><p>${_htmlEscape(detail)}</p></div></body></html>`;
}

// Discovery: RFC 8414 (authorization server metadata)
app.get('/.well-known/oauth-authorization-server', (req, res) => {
  _oauthCors(req, res);
  res.json({
    issuer: OAUTH_ISSUER,
    authorization_endpoint: OAUTH_ISSUER + '/authorize',
    token_endpoint: OAUTH_ISSUER + '/token',
    scopes_supported: ['mcp'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none']
  });
});

// Discovery: draft MCP protected-resource metadata (newer spec Claude uses)
app.get('/.well-known/oauth-protected-resource', (req, res) => {
  _oauthCors(req, res);
  res.json({
    resource: OAUTH_ISSUER + '/mcp',
    authorization_servers: [OAUTH_ISSUER],
    scopes_supported: ['mcp'],
    bearer_methods_supported: ['header']
  });
});

// CORS preflight for /token
app.options('/token', (req, res) => { _oauthCors(req, res); res.status(204).end(); });

// /authorize -- generate a short-lived code, redirect to Claude's callback
app.get('/authorize', (req, res) => {
  const { client_id, redirect_uri, response_type, scope, state } = req.query || {};

  if (!redirect_uri || typeof redirect_uri !== 'string') {
    return res.status(400).type('html').send(_oauthErrorHtml('Missing redirect_uri', 'The OAuth request was malformed -- no redirect_uri parameter was provided.'));
  }
  if (!OAUTH_REDIRECT_RE.test(redirect_uri)) {
    console.warn(`[${APP_NAME}] /authorize REJECTED redirect_uri (not claude.ai/claude.com): ${redirect_uri.slice(0, 120)}`);
    return res.status(400).type('html').send(_oauthErrorHtml('Invalid redirect_uri', 'Only claude.ai and claude.com redirect URIs are accepted by this connector.'));
  }
  if (response_type && response_type !== 'code') {
    return res.status(400).type('html').send(_oauthErrorHtml('Unsupported response_type', 'Only response_type=code is supported.'));
  }

  const code = _oauthNewCode();
  oauthCodes.set(code, {
    expires_at: Date.now() + OAUTH_CODE_TTL_MS,
    redirect_uri,
    state: typeof state === 'string' ? state : null,
    client_id: typeof client_id === 'string' ? client_id : null,
    scope: typeof scope === 'string' ? scope : null
  });

  // Compose target URL preserving any existing query string in redirect_uri.
  const sep = redirect_uri.includes('?') ? '&' : '?';
  const stateParam = state ? '&state=' + encodeURIComponent(state) : '';
  const target = redirect_uri + sep + 'code=' + encodeURIComponent(code) + stateParam;
  const targetAttr = _htmlEscape(target);

  console.log(`[${APP_NAME}] /authorize -> code issued (client_id=${client_id || '<none>'}, redirect=${redirect_uri.slice(0, 60)})`);

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Solomon MCP Authorized</title>
  <meta http-equiv="refresh" content="0;url=${targetAttr}" />
  <meta name="robots" content="noindex" />
  <style>
    body { margin: 0; min-height: 100vh; background: #1a1a1a; color: #f3ede1;
           font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           display: flex; align-items: center; justify-content: center; padding: 2rem; }
    .card { max-width: 28rem; text-align: center; }
    h1 { color: #f3ede1; font-size: 1.6rem; margin: 0 0 0.75rem; letter-spacing: -0.01em; }
    h1 span { color: #E25822; }
    p { color: #b5ad9d; margin: 0.5rem 0; font-size: 0.98rem; line-height: 1.5; }
    a.btn { display: inline-block; margin-top: 1.25rem; padding: 0.7rem 1.25rem;
            background: #E25822; color: #fff; text-decoration: none;
            border-radius: 4px; font-weight: 600; letter-spacing: 0.02em; }
    a.btn:hover { background: #c44a1a; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Solomon MCP <span>·</span> Authorized</h1>
    <p>Authorization successful — redirecting back to Claude...</p>
    <p style="font-size: 0.85rem;">If you are not redirected automatically:</p>
    <a class="btn" href="${targetAttr}">Continue to Claude</a>
  </div>
</body>
</html>
`);
});

// /token -- exchange the code for the bearer (returns the MCP_SERVER_SECRET)
function _oauthTokenHandler(req, res) {
  _oauthCors(req, res);
  // Body for POST (json or form-urlencoded) -- query for GET fallback.
  const src = req.method === 'GET' ? (req.query || {}) : (req.body || {});
  const grant_type = src.grant_type;
  const code = src.code;
  const redirect_uri = src.redirect_uri;

  if (grant_type !== 'authorization_code') {
    return res.status(400).json({ error: 'unsupported_grant_type', error_description: 'grant_type must be authorization_code' });
  }
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'Missing code parameter' });
  }
  const rec = oauthCodes.get(code);
  if (!rec) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'Unknown or already-used code' });
  }
  if (rec.expires_at <= Date.now()) {
    oauthCodes.delete(code);
    return res.status(400).json({ error: 'invalid_grant', error_description: 'Code has expired' });
  }
  if (redirect_uri && rec.redirect_uri !== redirect_uri) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri does not match the one used to obtain the code' });
  }

  // Single-use: delete the code immediately so it can't be replayed.
  oauthCodes.delete(code);

  console.log(`[${APP_NAME}] /token -> bearer issued (code consumed, ${oauthCodes.size} codes remaining)`);
  res.json({
    access_token: BEARER_TOKEN,
    token_type: 'Bearer',
    expires_in: 31536000, // 1 year -- single-tenant wrapper, no real session
    scope: 'mcp'
  });
}
app.post('/token', _oauthTokenHandler);
app.get('/token', _oauthTokenHandler);

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

// Bind to 127.0.0.1 only -- nginx (running on the same host) reverse-proxies
// public HTTPS traffic through to this loopback port. Direct external access
// to port 3002 is intentionally blocked so the bearer-token auth is enforced
// through exactly one ingress (nginx). Override via MCP_BIND env if needed.
app.listen(PORT, process.env.MCP_BIND || '127.0.0.1', () => {
  console.log(`[${APP_NAME}] v${VERSION} listening on 0.0.0.0:${PORT}`);
  console.log(`[${APP_NAME}] health:  http://0.0.0.0:${PORT}/health`);
  console.log(`[${APP_NAME}] mcp:     http://0.0.0.0:${PORT}/mcp  (bearer required)`);
  console.log(`[${APP_NAME}] tools:   ${TOOLS.length} -- ${TOOLS.map(t => t.name).join(', ')}`);
  console.log(`[${APP_NAME}] token:   ${_tailToken(BEARER_TOKEN)}  (full value in /root/solomon-v4/.env as MCP_SERVER_SECRET)`);
});

process.on('unhandledRejection', (e) => console.error(`[${APP_NAME}] unhandledRejection:`, e));
process.on('uncaughtException', (e) => console.error(`[${APP_NAME}] uncaughtException:`, e));
