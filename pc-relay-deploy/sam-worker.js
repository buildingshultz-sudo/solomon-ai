'use strict';
// sam-worker.js — PC-side GREEN EXECUTOR for Sam (GATE A).
//
// LOCKED DESIGN (do not reopen):
//  - SCOPE = the GREEN executor only. Routing green-sam jobs here is Gate B.
//  - Single-writer BY CONSTRUCTION: every GREEN type maps to a fixed handler.
//    No handler accepts a write-destination argument, so a job-controlled write
//    is NOT EXPRESSIBLE. There is NO free-form "run this command" GREEN type and
//    never will be. NEVER bash -c, NEVER -Command, NEVER a free-form command
//    string. Only pinned execFile (findstr, read-only git) + in-process
//    read-only fs/os calls. This is NOT the regex D-write scanner at
//    pc-relay.js:304 (that file itself disclaims it as "not a sandbox").
//  - DEFAULT-DENY: any task_type not in the closed GREEN registry is REFUSED and
//    HELD (moved to refused/, never executed) for a live Sam session + Jed
//    approval. RED types (build/fix/deploy/git-commit/push/write/pm2/npm/creds/
//    anything irreversible) all fall here by default.
//  - Own queue dir (sam-green-queue), own pidfile (sam-worker.pid, written by the
//    relay), own heartbeat (sam-worker.heartbeat) — so caleb-worker and sam-worker
//    never race-claim jobs nor kill each other's process.
//  - VERIFIED execution-ledger line per auto-run (verify-at-write-time).
//
// LEDGER NOTE (honest, Gate A): the universal execution-ledger (SQLite +
// shultz_master_context.md) lives on the VPS and cannot be require()'d here.
// For Gate A the VERIFIED line is written to a PC-LOCAL MIRROR that faithfully
// reuses the universal ledger's contract (same compact line format + verify-at-
// write-time artifact semantics: text/file/http -> VERIFIED, missing ->
// UNVERIFIED). Jobs that carry a VPS dispatch_id ALSO report back over the
// existing /caleb-result path into the universal ledger; such jobs only appear
// once Gate B routes real dispatches. No VPS code is touched by Gate A.
//
// Run: node sam-worker.js   (cwd = pc-relay so it loads pc-relay/.env)

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

try { require('dotenv').config(); } catch (_) { /* env may be pre-set */ }

// ── CONFIG ──────────────────────────────────────────────────────────────────
const QUEUE_DIR = process.env.SAM_GREEN_QUEUE_DIR || 'C:\\Users\\Ashle\\Solomon\\sam-green-queue';
const POLL_MS   = parseInt(process.env.SAM_WORKER_POLL_MS || '10000', 10);
const SECRET    = process.env.PC_RELAY_SECRET;
const REPORT_URL = process.env.CALEB_REPORT_URL || 'http://167.99.237.26:3000/caleb-result'; // Gate B only (needs dispatch_id)
const HEARTBEAT_PATH = path.join(__dirname, 'sam-worker.heartbeat');
const LEDGER_JSONL   = path.join(__dirname, 'sam-worker.ledger.jsonl');
const LEDGER_LOG     = path.join(__dirname, 'sam-worker.ledger.log');
const LOG_PATH       = path.join(QUEUE_DIR, 'sam-worker.log');

// Read-SCOPE allowlist. NOT a write guard (handlers are read-only by
// construction) — it just keeps GREEN reads inside known trees.
const READ_ALLOWLIST = (process.env.SAM_READ_ALLOWLIST
  ? process.env.SAM_READ_ALLOWLIST.split(',').map(s => s.trim()).filter(Boolean)
  : ['C:\\Users\\Ashle\\Solomon\\', 'D:\\Solomon\\', 'D:\\B ROLL FOOTAGE\\']
).map(p => (p.endsWith('\\') || p.endsWith('/')) ? p : p + '\\');
const READ_MAX_BYTES = parseInt(process.env.SAM_READ_MAX_BYTES || (256 * 1024), 10);

function ensureDir(p) { try { fs.mkdirSync(p, { recursive: true }); } catch (_) {} }
ensureDir(QUEUE_DIR);
['in-progress', 'processed', 'failed', 'refused'].forEach(d => ensureDir(path.join(QUEUE_DIR, d)));

function logLine(s) {
  const line = `${new Date().toISOString()} [${os.hostname()}] ${s}\n`;
  try { fs.appendFileSync(LOG_PATH, line, 'utf8'); } catch (_) {}
  process.stdout.write(line);
}

// ── LOCAL LEDGER (faithful mirror of the universal ledger contract) ──────────
function ctStamp() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const g = t => (p.find(x => x.type === t) || {}).value;
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')} CT`;
}
function verifyArtifact(a) {
  if (!a || !a.type) return { ok: false, label: 'UNVERIFIED' };
  try {
    if (a.type === 'file') return (a.value && fs.existsSync(a.value)) ? { ok: true, label: `file:${path.basename(String(a.value))}` } : { ok: false, label: 'UNVERIFIED' };
    if (a.type === 'http') { const c = Number(a.value); return Number.isFinite(c) ? { ok: c >= 200 && c < 400, label: `http:${c}` } : { ok: false, label: 'UNVERIFIED' }; }
    if (a.type === 'text') { const t = String(a.value || '').trim(); return t ? { ok: true, label: t.slice(0, 64) } : { ok: false, label: 'UNVERIFIED' }; }
  } catch (_) {}
  return { ok: false, label: 'UNVERIFIED' };
}
const _ACT = new Set(['dispatched', 'started', 'completed', 'failed', 'escalated', 'blocked']);
function normAction(a) { const s = String(a || '').toLowerCase().trim(); return _ACT.has(s) ? s : (s ? s.replace(/[^a-z0-9_]/g, '_').slice(0, 24) : 'event'); }
function ledgerRecord(evt) {
  const agent = 'sam';
  const taskId = String(evt.taskId || '-').replace(/\s+/g, '_').slice(0, 60);
  const title = String(evt.title || '(untitled)').replace(/[\r\n]+/g, ' ').trim().slice(0, 120);
  const action = normAction(evt.action);
  const art = verifyArtifact(evt.artifact);
  const label = art.ok ? art.label : 'UNVERIFIED';
  const compact = `- [${ctStamp()}] ${agent} · ${taskId} · "${title}" · ${action.toUpperCase()} · ${label}`;
  try { fs.appendFileSync(LEDGER_JSONL, JSON.stringify({ ts: new Date().toISOString(), agent, taskId, title, action, label, verified: art.ok, detail: evt.detail || null, artifact: evt.artifact || null }) + '\n', 'utf8'); } catch (_) {}
  try { fs.appendFileSync(LEDGER_LOG, compact + '\n', 'utf8'); } catch (_) {}
  return { verified: art.ok, label, line: compact };
}

// ── READ-SCOPE RESOLVER (read-only; realpath + allowlist prefix) ─────────────
function resolveRead(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return { ok: false, reason: 'path required' };
  if (rawPath.includes('..')) return { ok: false, reason: 'path contains ".."' };
  if (!path.isAbsolute(rawPath)) return { ok: false, reason: 'path must be absolute' };
  let resolved;
  try { resolved = fs.realpathSync.native(rawPath); }
  catch (e) { return { ok: false, reason: e.code === 'ENOENT' ? 'path does not exist' : ('realpath: ' + e.message) }; }
  const lowered = resolved.toLowerCase();
  const ok = READ_ALLOWLIST.some(pre => { const bare = pre.replace(/[\\/]+$/, '').toLowerCase(); return lowered === bare || lowered.startsWith(bare + '\\') || lowered.startsWith(bare + '/'); });
  if (!ok) return { ok: false, reason: 'path outside read allowlist' };
  return { ok: true, abs: resolved };
}
function field(job, ...names) { for (const n of names) { if (job[n] != null) return job[n]; if (job.args && job.args[n] != null) return job.args[n]; } return undefined; }

// ── GREEN HANDLERS (each READ-ONLY BY CONSTRUCTION — no write-dest arg exists) ─
function execVerify() {
  const free = Math.round(os.freemem() / 1048576);
  const summary = `verify OK on ${os.hostname()} (${os.platform()}); free ${free}MB; uptime ${Math.round(os.uptime())}s`;
  return { status: 'done', worker_status: 'executed', summary, artifact: { type: 'text', value: summary } };
}
function execGrep(job) {
  const pattern = field(job, 'pattern', 'query');
  const raw = field(job, 'path', 'file');
  if (!pattern || typeof pattern !== 'string') throw new Error('grep requires string "pattern"');
  const chk = resolveRead(raw); if (!chk.ok) throw new Error('grep path: ' + chk.reason);
  let out = '';
  try { out = execFileSync('findstr', ['/N', '/I', '/C:' + pattern, chk.abs], { timeout: 15000, maxBuffer: 4 * 1024 * 1024 }).toString(); }
  catch (e) { if (e.status === 1) out = ''; else throw new Error('findstr: ' + String(e.message || '').slice(0, 160)); }
  const lines = out ? out.split(/\r?\n/).filter(Boolean) : [];
  const summary = `grep '${pattern}' in ${path.basename(chk.abs)}: ${lines.length} match(es)`;
  return { status: 'done', worker_status: 'executed', summary, detail: lines.slice(0, 20).join(' | ').slice(0, 800), artifact: { type: 'text', value: summary } };
}
function execRead(job) {
  const raw = field(job, 'path', 'file');
  const chk = resolveRead(raw); if (!chk.ok) throw new Error('read path: ' + chk.reason);
  const st = fs.statSync(chk.abs); if (st.isDirectory()) throw new Error('path is a directory; use list');
  const slice = fs.readFileSync(chk.abs).slice(0, READ_MAX_BYTES);
  const summary = `read ${path.basename(chk.abs)} (${st.size}B${st.size > READ_MAX_BYTES ? `, showing ${READ_MAX_BYTES}B` : ''})`;
  return { status: 'done', worker_status: 'executed', summary, detail: slice.toString('utf8').slice(0, 800), artifact: { type: 'file', value: chk.abs } };
}
function execList(job) {
  const raw = field(job, 'dir', 'path');
  const chk = resolveRead(raw); if (!chk.ok) throw new Error('list path: ' + chk.reason);
  const st = fs.statSync(chk.abs); if (!st.isDirectory()) throw new Error('path is not a directory');
  const names = fs.readdirSync(chk.abs);
  const summary = `list ${path.basename(chk.abs) || chk.abs}: ${names.length} entr${names.length === 1 ? 'y' : 'ies'}`;
  return { status: 'done', worker_status: 'executed', summary, detail: names.slice(0, 40).join(' | ').slice(0, 800), artifact: { type: 'text', value: summary } };
}
function execStat(job) {
  const raw = field(job, 'path', 'file', 'dir');
  const chk = resolveRead(raw); if (!chk.ok) throw new Error('stat path: ' + chk.reason);
  const st = fs.statSync(chk.abs);
  const summary = `stat ${path.basename(chk.abs)}: ${st.isDirectory() ? 'dir' : 'file'} ${st.size}B mtime ${st.mtime.toISOString()}`;
  return { status: 'done', worker_status: 'executed', summary, artifact: { type: 'file', value: chk.abs } };
}
function execGitLog(job) {
  const chk = resolveRead(field(job, 'repo', 'path', 'dir')); if (!chk.ok) throw new Error('git-log repo: ' + chk.reason);
  let n = parseInt(field(job, 'n', 'count'), 10); if (!Number.isFinite(n) || n < 1 || n > 200) n = 20;
  let out = '';
  try { out = execFileSync('git', ['-C', chk.abs, '--no-optional-locks', 'log', '--oneline', '-n', String(n)], { timeout: 15000, maxBuffer: 4 * 1024 * 1024 }).toString(); }
  catch (e) { throw new Error('git: ' + String(e.message || '').slice(0, 160)); }
  const lines = out.split(/\r?\n/).filter(Boolean);
  const summary = `git-log ${path.basename(chk.abs)}: ${lines.length} commit(s)`;
  return { status: 'done', worker_status: 'executed', summary, detail: lines.slice(0, 20).join(' | ').slice(0, 800), artifact: { type: 'text', value: summary } };
}
function execGitStatus(job) {
  const chk = resolveRead(field(job, 'repo', 'path', 'dir')); if (!chk.ok) throw new Error('git-status repo: ' + chk.reason);
  let out = '';
  try { out = execFileSync('git', ['-C', chk.abs, '--no-optional-locks', 'status', '--porcelain'], { timeout: 15000, maxBuffer: 4 * 1024 * 1024 }).toString(); }
  catch (e) { throw new Error('git: ' + String(e.message || '').slice(0, 160)); }
  const lines = out.split(/\r?\n/).filter(Boolean);
  const summary = `git-status ${path.basename(chk.abs)}: ${lines.length} change(s)`;
  return { status: 'done', worker_status: 'executed', summary, detail: lines.slice(0, 30).join(' | ').slice(0, 800), artifact: { type: 'text', value: summary } };
}

// CLOSED GREEN registry — the ONLY executable types. Anything else => default-deny.
const GREEN = {
  verify: execVerify, ping: execVerify,
  grep: execGrep,
  read: execRead, cat: execRead,
  list: execList, ls: execList, dir: execList,
  stat: execStat, meta: execStat,
  'git-log': execGitLog, gitlog: execGitLog,
  'git-status': execGitStatus, gitstatus: execGitStatus,
};

function classify(job) { return String(job.task_type || job.template_id || '').toLowerCase().trim(); }

function execute(job) {
  const tt = classify(job);
  const handler = GREEN[tt];
  if (!handler) {
    // DEFAULT-DENY. Not a GREEN type => refuse + hold. NEVER executed here.
    return { status: 'refused', worker_status: 'red_hold',
      summary: `'${tt || 'unknown'}' is not a GREEN type — default-deny. Held for live Sam + Jed approval; NOT executed.`,
      artifact: null };
  }
  try { return handler(job); }
  catch (e) { return { status: 'failed', worker_status: 'sam_error', summary: `${tt} failed: ${e.message}`.slice(0, 400), artifact: null }; }
}

// ── report-back to VPS (Gate B; only when the job carries a VPS dispatch_id) ──
function reportBack(job, result) {
  if (!job.dispatch_id) return; // Gate A local jobs have none; universal ledger reached in Gate B
  if (!SECRET) { logLine('PC_RELAY_SECRET missing — cannot report back'); return; }
  const payload = JSON.stringify({ dispatch_id: job.dispatch_id, status: result.status, summary: result.summary, title: job.title || job.task });
  let u; try { u = new URL(REPORT_URL); } catch (e) { logLine('bad REPORT_URL: ' + e.message); return; }
  const lib = u.protocol === 'https:' ? require('https') : require('http');
  const req = lib.request({ hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'X-Secret': SECRET }, timeout: 8000 },
    res => { let b = ''; res.on('data', d => b += d); res.on('end', () => logLine(`report-back ${job.dispatch_id} -> HTTP ${res.statusCode} ${b.slice(0, 120)}`)); });
  req.on('error', e => logLine(`report-back error ${job.dispatch_id}: ${e.message}`));
  req.on('timeout', () => { req.destroy(); logLine(`report-back timeout ${job.dispatch_id}`); });
  req.write(payload); req.end();
}

// ── queue lifecycle ──────────────────────────────────────────────────────────
function pickJob() { const e = fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('.json') && !f.startsWith('.')).sort(); return e.length ? e[0] : null; }
function processOne() {
  const fname = pickJob(); if (!fname) return false;
  const src = path.join(QUEUE_DIR, fname);
  const claimed = path.join(QUEUE_DIR, 'in-progress', fname);
  try { fs.renameSync(src, claimed); } catch (e) { logLine(`claim failed ${fname}: ${e.message}`); return false; }
  let job = null;
  try { job = JSON.parse(fs.readFileSync(claimed, 'utf8')); }
  catch (e) { logLine(`parse failed ${fname}: ${e.message}`); try { fs.renameSync(claimed, path.join(QUEUE_DIR, 'failed', fname)); } catch (_) {} return true; }

  const result = execute(job);
  const verb = result.status === 'done' ? 'completed' : result.status === 'refused' ? 'blocked' : 'failed';
  const led = ledgerRecord({ taskId: job.dispatch_id || job.task_id || fname, title: job.title || job.task || classify(job), action: verb, detail: result.summary, artifact: result.artifact });
  logLine(`job ${fname} type=${classify(job) || '?'} -> ${result.status} (${result.worker_status}) | LEDGER ${led.verified ? 'VERIFIED' : 'UNVERIFIED'} ${led.label}`);

  job.worker_picked_at = new Date().toISOString();
  job.worker_status = result.worker_status;
  job.worker_result = result.summary;
  job.ledger_line = led.line;
  job.ledger_verified = led.verified;
  const destDir = result.status === 'refused' ? 'refused' : result.status === 'failed' ? 'failed' : 'processed';
  try { fs.writeFileSync(claimed, JSON.stringify(job, null, 2), 'utf8'); } catch (_) {}
  try { fs.renameSync(claimed, path.join(QUEUE_DIR, destDir, fname)); } catch (e) { logLine(`move failed ${fname}: ${e.message}`); }
  reportBack(job, result);
  return true;
}

logLine(`sam-worker starting. queue=${QUEUE_DIR} poll=${POLL_MS}ms green=[${Object.keys(GREEN).join(',')}] secret=${SECRET ? 'set' : 'MISSING'} pid=${process.pid}`);
let _busy = false;
function tick() {
  if (_busy) return; _busy = true;
  try { let n = 0; while (processOne()) { if (++n >= 20) break; } }
  catch (e) { logLine(`tick error: ${e.message}`); }
  finally { _busy = false; }
}
tick();
setInterval(tick, POLL_MS);

// ── HEARTBEAT (relay reads sam-worker.heartbeat for /status.sam_worker.alive) ──
function writeHeartbeat() { try { fs.writeFileSync(HEARTBEAT_PATH, String(Date.now())); } catch (_) {} }
writeHeartbeat(); setInterval(writeHeartbeat, 30000);

process.on('SIGINT', () => { logLine('SIGINT — exiting'); process.exit(0); });
process.on('SIGTERM', () => { logLine('SIGTERM — exiting'); process.exit(0); });
