'use strict';
// dispatch-core.js — Nathan → Solomon → Sam/Caleb dispatch engine.
// Shared by mcp-server.js (creates dispatches via the dispatch_task MCP tool)
// and bot.js (handles the Approve/Cancel Telegram callbacks). Keeping the logic
// here avoids duplicating it across the two processes and keeps the protected
// bot.js edit to a thin callback wrapper.
//
// Solomon owns routing + approval. ALL irreversibles hard-escalate to Jed.
// Credential guard runs first on every creation. D:-drive read-only invariant is
// NOT enforced here — Sam/Caleb must respect it in execution.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const Database = require('better-sqlite3');

const SOLOMON_DIR = '/root/solomon-v4';
const SAM_QUEUE_DIR = path.join(SOLOMON_DIR, 'sam-queue');
const DB_PATH = path.join(SOLOMON_DIR, 'solomon.db');

// Own DB handle (WAL → safe concurrent writer alongside bot/scheduler/mcp).
let _db = null;
function db() {
  if (!_db) { _db = new Database(DB_PATH); _db.pragma('journal_mode = WAL'); }
  return _db;
}

// ── time helpers (CT) ───────────────────────────────────────────────────────
function ctHM() {
  return new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false });
}
function ctStamp() {
  // "YYYY-MM-DD HH:MM CT" for master-context lines.
  const d = new Date();
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const g = t => (p.find(x => x.type === t) || {}).value;
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')} CT`;
}

// ── Gate 0.1 — credential guard ─────────────────────────────────────────────
// Matches token|secret|key|password adjacent (within 20 chars, either order) to a
// 16+ char alphanumeric run, plus a few well-known key prefixes. Returns the
// matched label or null.
const _CRED_KEYWORD = /(?:token|secret|key|password|passwd|api[_-]?key)\W{0,20}[A-Za-z0-9_-]{16,}|[A-Za-z0-9_-]{16,}\W{0,20}(?:token|secret|key|password|passwd|api[_-]?key)/i;
const _CRED_PREFIX = /\b(?:sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[0-9A-Z]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
function scanCredential(text) {
  if (!text || typeof text !== 'string') return null;
  if (_CRED_KEYWORD.test(text)) return 'keyword-adjacent-secret';
  if (_CRED_PREFIX.test(text)) return 'known-key-prefix';
  return null;
}

// ── Gate 0.3 / Step 8 — routing resolution ──────────────────────────────────
const SAM_TYPES = ['build', 'fix', 'deploy', 'shell', 'git', 'code', 'ssh'];
const CALEB_TYPES = ['browser', 'verify', 'click', 'capture', 'gmail', 'spreadshop', 'kdp', 'youtube', 'screenshot'];
// Caleb cannot run shell/terminal work — these always go to Sam even if explicitly targeted at Caleb.
const CALEB_FORBIDDEN = ['build', 'fix', 'deploy', 'shell', 'git'];
function resolveRouting(target, taskType) {
  const tt = String(taskType || '').toLowerCase();
  let resolved = (target === 'gabriel') ? null : target;
  let note = null, rerouted = false;
  if (target === 'gabriel') {
    if (SAM_TYPES.includes(tt)) resolved = 'sam';
    else if (CALEB_TYPES.includes(tt)) resolved = 'caleb';
    else { resolved = 'caleb'; note = 'Gabriel: unknown task_type → defaulted to Caleb'; }
  }
  if (resolved === 'caleb' && CALEB_FORBIDDEN.includes(tt)) {
    resolved = 'sam'; rerouted = true; note = '(Gabriel rerouted: shell tasks go to Sam)';
  }
  return { target: resolved, rerouted, note };
}

// ── activity_log writer (spec format) ───────────────────────────────────────
function logActivity(summary) {
  try {
    db().prepare("INSERT INTO activity_log (type, status, summary) VALUES (?, ?, ?)")
      .run('nathan_dispatch', 'ok', summary);
  } catch (_) { /* never break dispatch on a log failure */ }
}

function dispatchFilePath(id) { return path.join(SAM_QUEUE_DIR, id + '.json'); }
function writeRecord(rec) {
  if (!fs.existsSync(SAM_QUEUE_DIR)) fs.mkdirSync(SAM_QUEUE_DIR, { recursive: true });
  fs.writeFileSync(dispatchFilePath(rec.id), JSON.stringify(rec, null, 2), 'utf8');
}
function readDispatch(id) {
  try { return JSON.parse(fs.readFileSync(dispatchFilePath(id), 'utf8')); }
  catch (_) { return null; }
}

// ── Step 2+3 — create a dispatch (Gate 0 → write file → log) ─────────────────
// Throws on credential hit (caller surfaces the exact block message). Returns
// { record, autoProceed }.
function prepareDispatch(input) {
  const target = String((input && input.target) || '').toLowerCase();
  const task_type = String((input && input.task_type) || '').trim();
  const title = String((input && input.title) || '').trim();
  let description = String((input && input.description) || '');
  const priority = ['high', 'normal', 'low'].includes(input && input.priority) ? input.priority : 'normal';
  let requires_approval = (input && input.requires_approval === false) ? false : true;
  const is_irreversible = !!(input && input.is_irreversible);

  if (!['sam', 'caleb', 'gabriel'].includes(target)) throw new Error("target must be one of sam|caleb|gabriel");
  if (!task_type) throw new Error('task_type required');
  if (!title) throw new Error('title required');
  if (!description.trim()) throw new Error('description required');

  // GATE 0.1 — credential guard FIRST. No file, no Telegram.
  const cred = scanCredential(description);
  if (cred) throw new Error('⚠️ Dispatch blocked — possible credential in description. Clean the payload.');

  // GATE 0.2 — irreversible hard-stop forces approval.
  let hard_escalated = false;
  if (is_irreversible && !requires_approval) { requires_approval = true; hard_escalated = true; }
  else if (is_irreversible) { hard_escalated = true; }

  // GATE 0.3 / Step 8 — resolve gabriel + caleb-shell override.
  const routing = resolveRouting(target, task_type);
  const finalTarget = routing.target;

  // cap description at 2000 chars
  if (description.length > 2000) description = description.slice(0, 2000) + '...[truncated]';

  const id = 'dispatch_' + Date.now();
  const status = (!requires_approval && !is_irreversible) ? 'queued' : 'pending_approval';
  const record = {
    id,
    target: finalTarget,
    requested_target: target,
    routing_note: routing.note || null,
    rerouted: routing.rerouted,
    task_type,
    title,
    description,
    priority,
    requires_approval,
    is_irreversible,
    hard_escalated,
    dispatched_by: 'nathan',
    timestamp_ct: new Date().toISOString(),
    status,
    // sam-queue compatibility (get_sam_queue reads .task; Sam watcher reads .handler)
    task: title,
    handler: finalTarget
  };
  writeRecord(record);
  logActivity(`[${ctStamp()}] Nathan dispatch ${id} created: target=${finalTarget} task_type=${task_type} title='${title}' priority=${priority} status=${status}`);
  return { record, autoProceed: (status === 'queued') };
}

// ── Step 4 — Telegram approval card ─────────────────────────────────────────
function buildCard(rec) {
  const desc = rec.description.length > 280 ? rec.description.slice(0, 280) + '…' : rec.description;
  const lines = [
    `🚀 Nathan → ${rec.target.toUpperCase()}`,
    `📋 ${rec.title}`,
    `Priority: ${rec.priority} | ${rec.task_type}`,
    '',
    desc,
    ''
  ];
  if (rec.is_irreversible) lines.push('⚠️ IRREVERSIBLE — Jed approval required');
  if (rec.routing_note) lines.push(rec.routing_note);
  lines.push(`Dispatched by Nathan · ${ctHM()} CT`);
  const text = lines.join('\n');
  const reply_markup = (rec.status === 'pending_approval')
    ? { inline_keyboard: [[
        { text: '✅ Approve', callback_data: `dispatch_approve_${rec.id}` },
        { text: '❌ Cancel', callback_data: `dispatch_cancel_${rec.id}` }
      ]] }
    : null;
  return { text, reply_markup };
}

// ── Step 7 — master-context append (reuses tools.js append + git push) ───────
function _execFileP(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      if (err) { err.stdout = String(stdout || ''); err.stderr = String(stderr || ''); return reject(err); }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}
async function appendSamQueueLog(rec) {
  const entry = `Nathan dispatch → ${rec.target}: '${rec.title}' (status: ${rec.status}, id: ${rec.id})`;
  try {
    const { executeTool } = require(path.join(SOLOMON_DIR, 'tools.js'));
    const r = await executeTool('append_master_context', { section: 'SAMQUEUE', entry });
    if (!r || !r.ok) throw new Error((r && r.error) || 'append updater returned not-ok');
    // best-effort git commit/push (entry text never goes in the commit message)
    const g = { cwd: SOLOMON_DIR, timeout: 30000, maxBuffer: 4 * 1024 * 1024 };
    await _execFileP('git', ['add', 'shultz_master_context.md'], g);
    try {
      await _execFileP('git', ['commit', '-m', 'docs(master-context): Nathan dispatch [SAMQUEUE]'], g);
      await _execFileP('git', ['push', 'origin', 'master'], g);
    } catch (e) {
      const blob = (e.stdout || '') + (e.stderr || '') + (e.message || '');
      if (!/nothing to commit/i.test(blob)) throw e;
    }
    return true;
  } catch (e) {
    logActivity(`[${ctStamp()}] Nathan dispatch ${rec.id} master-context append FAILED: ${String(e.message).slice(0, 160)}`);
    return false;
  }
}

// ── Step 5 — routing on approve (also used by the auto-queue path) ───────────
// Returns { status, cardText, ok }. Persists the updated record + logs + appends
// master context on success.
async function routeOnApprove(rec) {
  let cardText, ok = true;
  if (rec.target === 'sam') {
    rec.status = 'queued';
    writeRecord(rec);
    cardText = `✅ Queued for Sam · ${rec.title}`;
  } else if (rec.target === 'caleb') {
    const base = process.env.PC_RELAY_URL;
    const secret = process.env.PC_RELAY_SECRET;
    if (!base || base === 'PLACEHOLDER') {
      rec.status = 'caleb_error'; ok = false;
      writeRecord(rec);
      cardText = `⚠️ Caleb relay failed (no PC_RELAY_URL) — ${rec.title}`;
    } else {
      const axios = require('axios');
      // Body satisfies BOTH the spec and the live /caleb-task contract
      // (handler/task/template_id are required by the PC relay or it 400s).
      const body = {
        handler: 'caleb',
        task: rec.title,
        template_id: 'nathan_dispatch_' + rec.task_type,
        task_type: rec.task_type,
        title: rec.title,
        description: rec.description,
        priority: rec.priority,
        dispatch_id: rec.id
      };
      // Send both header names: spec asks x-relay-secret; the live relay validates x-secret.
      const headers = { 'x-relay-secret': secret, 'x-secret': secret, 'Content-Type': 'application/json' };
      try {
        const resp = await axios.post(base.replace(/\/+$/, '') + '/caleb-task', body, { headers, timeout: 8000, validateStatus: () => true });
        if (resp.status === 200) {
          rec.status = 'dispatched_to_caleb'; writeRecord(rec);
          cardText = `✅ Sent to Caleb · ${rec.title}`;
        } else {
          rec.status = 'caleb_error'; ok = false; writeRecord(rec);
          cardText = `⚠️ Caleb relay failed (${resp.status}) — ${rec.title}`;
        }
      } catch (e) {
        rec.status = 'caleb_error'; ok = false; writeRecord(rec);
        cardText = `⚠️ Caleb relay failed (${e.code || 'network'}) — ${rec.title}`;
      }
    }
  } else {
    rec.status = 'caleb_error'; ok = false; writeRecord(rec);
    cardText = `⚠️ Unknown target '${rec.target}' — ${rec.title}`;
  }
  logActivity(`[${ctStamp()}] Nathan dispatch ${rec.id} ${rec.status}: ${rec.title}`);
  if (ok && (rec.status === 'queued' || rec.status === 'dispatched_to_caleb')) {
    await appendSamQueueLog(rec); // Step 7
  }
  return { status: rec.status, cardText, ok };
}

// ── Step 6 — cancel ─────────────────────────────────────────────────────────
function cancelDispatch(rec) {
  rec.status = 'cancelled';
  writeRecord(rec);
  logActivity(`[${ctStamp()}] Nathan dispatch ${rec.id} cancelled: ${rec.title}`);
  return `❌ Cancelled · ${rec.title}`;
}

// ── Caleb report-back — PC worker → VPS /caleb-result closes the loop ────────
// status: 'done' | 'failed' | 'acknowledged' (or any short string). Updates the
// dispatch JSON and logs. Returns the updated record (or null if unknown id).
function recordCalebResult(id, status, summary) {
  const rec = readDispatch(id);
  if (!rec) return null;
  rec.status = status === 'done' ? 'caleb_done'
    : status === 'failed' ? 'caleb_failed'
    : 'caleb_' + String(status || 'reported').replace(/[^a-z0-9_]/gi, '_');
  rec.caleb_summary = String(summary || '').slice(0, 500);
  rec.caleb_reported_at = new Date().toISOString();
  writeRecord(rec);
  logActivity(`[${ctStamp()}] Nathan dispatch ${id} ${rec.status}: ${rec.title} — ${rec.caleb_summary}`);
  return rec;
}

module.exports = {
  scanCredential, resolveRouting, prepareDispatch, buildCard,
  routeOnApprove, cancelDispatch, readDispatch, appendSamQueueLog,
  recordCalebResult, SAM_QUEUE_DIR
};
