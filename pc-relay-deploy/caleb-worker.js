'use strict';
// caleb-worker.js — PC-side worker that consumes the Caleb queue and REPORTS BACK.
//
// FIX 2 (6/5): the relay's /caleb-task accepts + queues jobs (HTTP 200), but
// nothing was consuming the queue (this worker was built 6/2 and never started),
// and even when run it only acknowledged jobs with no report-back. This version:
//   1. polls + claims jobs (in-progress/ → processed/|failed/ quarantine)
//   2. EXECUTES safe task types for real (verify/ping → system probe;
//      capture/screenshot → real screenshot). Desktop/browser types (kdp,
//      spreadshop, youtube, gmail, browser, click) are honestly acknowledged as
//      "needs the Cowork/Playwright desktop agent" — never faked.
//   3. REPORTS BACK to the VPS at /caleb-result (auth: X-Secret == PC_RELAY_SECRET,
//      the same shared secret used by /cowork/busy). The VPS updates the dispatch
//      status and Telegrams Jed. This closes the Nathan→Solomon→Caleb→Jed loop.
//
// The PC has no Telegram token, so report-back MUST go through the VPS.
// Run: node caleb-worker.js   (cwd = pc-relay so it loads pc-relay/.env)

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

try { require('dotenv').config(); } catch (_) { /* dotenv optional; env may be pre-set */ }

const QUEUE_DIR = process.env.CALEB_QUEUE_DIR || 'C:\\Users\\Ashle\\Solomon\\caleb-queue';
const POLL_MS = parseInt(process.env.CALEB_WORKER_POLL_MS || '60000', 10);
const REPORT_URL = process.env.CALEB_REPORT_URL || 'http://167.99.237.26:3000/caleb-result';
const SECRET = process.env.PC_RELAY_SECRET;
const LOG_PATH = path.join(QUEUE_DIR, 'caleb-worker.log');

function ensureDir(p) { try { fs.mkdirSync(p, { recursive: true }); } catch (_) {} }
ensureDir(QUEUE_DIR);
['in-progress', 'processed', 'failed'].forEach(d => ensureDir(path.join(QUEUE_DIR, d)));

function logLine(s) {
  const line = `${new Date().toISOString()} [${os.hostname()}] ${s}\n`;
  try { fs.appendFileSync(LOG_PATH, line, 'utf8'); } catch (_) {}
  process.stdout.write(line);
}

// ── executors ────────────────────────────────────────────────────────────
function execVerify() {
  const free = Math.round(os.freemem() / 1048576);
  return { status: 'done', worker_status: 'executed',
    summary: `verify OK on ${os.hostname()} (${os.platform()}); free ${free}MB; uptime ${Math.round(os.uptime())}s` };
}
function execCapture() {
  const out = path.join(QUEUE_DIR, 'processed', `shot_${Date.now()}.png`);
  const ps = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height); $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save('${out.replace(/\\/g, '\\\\')}'); 'ok'`;
  execFileSync('powershell', ['-NonInteractive', '-NoProfile', '-Command', ps], { timeout: 15000 });
  return { status: 'done', worker_status: 'executed', summary: `screenshot captured: ${out} (${fs.statSync(out).size} bytes)` };
}
function execute(job) {
  const tt = String(job.task_type || job.template_id || '').toLowerCase();
  try {
    if (tt === 'verify' || tt === 'ping') return execVerify();
    if (tt === 'capture' || tt === 'screenshot') return execCapture();
    return { status: 'acknowledged', worker_status: 'queued_needs_desktop_agent',
      summary: `Received '${tt || 'unknown'}' task '${job.title || job.task || ''}'. Full execution needs the Cowork/Playwright desktop agent (not wired yet) — quarantined.` };
  } catch (e) {
    return { status: 'failed', worker_status: 'failed', summary: ('executor error: ' + e.message).slice(0, 400) };
  }
}

// ── report-back to VPS (built-in http, no extra deps) ──────────────────────
function reportBack(job, result) {
  if (!job.dispatch_id) { logLine(`no dispatch_id on '${job.title || job.task || '?'}' — skipping report-back`); return; }
  if (!SECRET) { logLine('PC_RELAY_SECRET missing — cannot report back'); return; }
  const payload = JSON.stringify({ dispatch_id: job.dispatch_id, status: result.status, summary: result.summary, title: job.title || job.task });
  let u; try { u = new URL(REPORT_URL); } catch (e) { logLine('bad REPORT_URL: ' + e.message); return; }
  const lib = u.protocol === 'https:' ? require('https') : require('http');
  const req = lib.request({
    hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'X-Secret': SECRET }, timeout: 8000
  }, res => { let b = ''; res.on('data', d => b += d); res.on('end', () => logLine(`report-back ${job.dispatch_id} -> HTTP ${res.statusCode} ${b.slice(0, 120)}`)); });
  req.on('error', e => logLine(`report-back error ${job.dispatch_id}: ${e.message}`));
  req.on('timeout', () => { req.destroy(); logLine(`report-back timeout ${job.dispatch_id}`); });
  req.write(payload); req.end();
}

function pickJob() {
  const entries = fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('.json') && !f.startsWith('.')).sort();
  return entries.length ? entries[0] : null;
}
function processOne() {
  const fname = pickJob();
  if (!fname) return false;
  const src = path.join(QUEUE_DIR, fname);
  const claimed = path.join(QUEUE_DIR, 'in-progress', fname);
  try { fs.renameSync(src, claimed); } catch (e) { logLine(`claim failed ${fname}: ${e.message}`); return false; }
  let job = null;
  try { job = JSON.parse(fs.readFileSync(claimed, 'utf8')); }
  catch (e) { logLine(`parse failed ${fname}: ${e.message}`); try { fs.renameSync(claimed, path.join(QUEUE_DIR, 'failed', fname)); } catch (_) {} return true; }

  const result = execute(job);
  logLine(`job ${fname} type=${job.task_type || job.template_id || '?'} dispatch_id=${job.dispatch_id || '-'} -> ${result.status} (${result.worker_status})`);
  job.worker_picked_at = new Date().toISOString();
  job.worker_status = result.worker_status;
  job.worker_result = result.summary;
  const destDir = result.status === 'failed' ? 'failed' : 'processed';
  try { fs.writeFileSync(claimed, JSON.stringify(job, null, 2), 'utf8'); } catch (_) {}
  try { fs.renameSync(claimed, path.join(QUEUE_DIR, destDir, fname)); } catch (e) { logLine(`move failed ${fname}: ${e.message}`); }
  reportBack(job, result);
  return true;
}

logLine(`caleb-worker starting. queue=${QUEUE_DIR} poll=${POLL_MS}ms report=${REPORT_URL} secret=${SECRET ? 'set' : 'MISSING'} pid=${process.pid}`);
function tick() {
  try { let n = 0; while (processOne()) { if (++n >= 10) break; } }
  catch (e) { logLine(`tick error: ${e.message}`); }
}
tick();
setInterval(tick, POLL_MS);
process.on('SIGINT', () => { logLine('SIGINT — exiting'); process.exit(0); });
process.on('SIGTERM', () => { logLine('SIGTERM — exiting'); process.exit(0); });
