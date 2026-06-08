'use strict';
// pc-relay.js — Runs ONLY on Jed's Windows PC.
// Lightweight Express relay. NO LLM. NO Ollama. NO heavy processing.
// Just receives commands from VPS and executes them via PowerShell.
require('dotenv').config();

const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
app.use(express.json());

const SECRET = process.env.PC_RELAY_SECRET;
const PORT = parseInt(process.env.PC_RELAY_PORT || '7777');
const HMAC_ENABLED = String(process.env.PC_RELAY_HMAC || 'false').toLowerCase() === 'true';

if (!SECRET) {
  console.error('[PC RELAY] FATAL: PC_RELAY_SECRET not set in .env');
  process.exit(1);
}

// ── AUTH MIDDLEWARE ──────────────────────────────────────────────────────
// Two-mode: x-secret header (always accepted as fallback) + optional HMAC-SHA256
// signature in X-Signature header when PC_RELAY_HMAC=true (stronger; verifies
// body integrity too). If HMAC mode is on AND request has X-Signature, validate.
app.use((req, res, next) => {
  if (req.headers['x-secret'] !== SECRET) {
    console.log('[RELAY] Unauthorized request from', req.ip);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (HMAC_ENABLED && req.headers['x-signature']) {
    // Only validate signature on requests that carry one (avoids breaking older clients).
    const crypto = require('crypto');
    const rawBody = req.body && Object.keys(req.body).length ? JSON.stringify(req.body) : '';
    const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
    const provided = req.headers['x-signature'];
    if (provided !== expected) {
      console.log('[RELAY] HMAC mismatch from', req.ip);
      return res.status(401).json({ error: 'Bad signature' });
    }
  }
  next();
});

// ── HEALTH / STATUS ───────────────────────────────────────────────────────
// ── CALEB-WORKER SUPERVISION STATE ─────────────────────────────────────────
// The relay supervises caleb-worker as a child process (see bottom of file) and
// exposes its liveness here so solomon-health (VPS) can probe it via /status.
const WORKER_HEARTBEAT = path.join(__dirname, 'caleb-worker.heartbeat');
let _calebChild = null;
function _calebWorkerStatus() {
  let hb = 0;
  try { hb = parseInt(fs.readFileSync(WORKER_HEARTBEAT, 'utf8'), 10) || 0; } catch (_) {}
  const ageMs = hb ? (Date.now() - hb) : null;
  return {
    child_pid: _calebChild ? _calebChild.pid : null,
    heartbeat_epoch_ms: hb || null,
    heartbeat_age_s: ageMs != null ? Math.round(ageMs / 1000) : null,
    alive: ageMs != null && ageMs < 120000  // heartbeat within 2 min
  };
}

app.get('/status', (req, res) => {
  res.json({
    ok: true,
    hostname: os.hostname(),
    platform: os.platform(),
    uptime: os.uptime(),
    time: new Date().toISOString(),
    cowork_active: _coworkActive(),
    cowork_lock_path: COWORK_LOCK_PATH,
    d_readonly_prefixes: D_READONLY_PREFIXES,
    d_bridge_routes: ['/file', '/file/list', '/file/meta'],
    d_write_routes: ['/file/write'],
    d_write_allowlist: D_WRITE_ALLOWLIST,
    relay_version: '1.3.0',
    caleb_worker: _calebWorkerStatus()
  });
});

// ── EXECUTE POWERSHELL ───────────────────────────────────────────────────
app.post('/execute', (req, res) => {
  const { command, timeout = 30000 } = req.body;
  if (!command) return res.status(400).json({ error: 'No command provided' });

  // D: write-pattern guard — refuse PowerShell commands that would write/move/delete on D:.
  const refuseReason = dWriteRefuseReason(command);
  if (refuseReason) {
    console.log('[RELAY] /execute D-WRITE-REFUSED:', refuseReason, '|', command.slice(0, 120));
    return res.status(403).json({ ok: false, error: 'Command refused: D: drive is read-only on this relay.', reason: refuseReason });
  }
  // Cowork lock — refuse desktop-driving commands while Cowork is active.
  // (PowerShell that doesn't touch D: still runs — this is desktop-aware safety, not a hard block.)
  if (_coworkActive() && /\b(Start-Process|Invoke-Item|New-Object\s+-ComObject)\b/i.test(command)) {
    console.log('[RELAY] /execute COWORK-GUARD: refusing desktop-driving cmd while Cowork is active');
    return res.status(423).json({ ok: false, error: 'Cowork is currently active — refusing desktop-driving command to avoid contention.', cowork_lock: COWORK_LOCK_PATH });
  }

  console.log('[RELAY] Execute:', command.slice(0, 100));

  execFile('powershell', ['-NonInteractive', '-NoProfile', '-Command', command], {
    timeout,
    maxBuffer: 10 * 1024 * 1024 // 10MB
  }, (err, stdout, stderr) => {
    res.json({
      ok: !err,
      stdout: stdout || '',
      stderr: stderr || '',
      exitCode: err ? (err.code || 1) : 0,
      error: err ? err.message : null
    });
  });
});

// ── CALEB TASK QUEUE ─────────────────────────────────────────────────────
// Solomon's dispatch engine (caleb-relay.js on the VPS) POSTs structured
// Caleb tasks here. We persist them as JSON files in the Caleb queue dir
// for Cowork (the desktop agent) to pick up. The payload schema is the one
// shaped by shapeCalebPayload() in /root/solomon-v4/caleb-relay.js.
// T0-G: default queue dir updated to C:\Users\Ashle\Solomon\caleb-queue\ per the
// new spec. Falls back to D:\caleb-queue (the original cutover path) if the C:
// path can't be created (drive-letter difference between dev boxes). Override
// always via CALEB_QUEUE_DIR env.
const CALEB_QUEUE_DIR = (function () {
  if (process.env.CALEB_QUEUE_DIR) return process.env.CALEB_QUEUE_DIR;
  if (os.platform() !== 'win32') return path.join(os.homedir(), 'caleb-queue');
  const preferred = 'C:\\Users\\Ashle\\Solomon\\caleb-queue';
  const fallback  = 'D:\\caleb-queue';
  try { fs.mkdirSync(preferred, { recursive: true }); return preferred; }
  catch (_) { return fallback; }
})();
try {
  if (!fs.existsSync(CALEB_QUEUE_DIR)) fs.mkdirSync(CALEB_QUEUE_DIR, { recursive: true });
  console.log(`[PC RELAY] Caleb queue dir: ${CALEB_QUEUE_DIR}`);
} catch (e) {
  console.error(`[PC RELAY] Could not create Caleb queue dir at ${CALEB_QUEUE_DIR}: ${e.message}`);
}

app.post('/caleb-task', (req, res) => {
  const p = req.body || {};
  // Required fields (matches shapeCalebPayload in caleb-relay.js on the VPS).
  const missing = [];
  for (const k of ['task', 'template_id', 'handler']) {
    if (!p[k] || typeof p[k] !== 'string') missing.push(k);
  }
  if (missing.length) {
    return res.status(400).json({ ok: false, error: 'Missing required fields: ' + missing.join(',') });
  }
  if (p.handler !== 'caleb') {
    return res.status(400).json({ ok: false, error: `Wrong handler: expected 'caleb', got '${p.handler}'` });
  }
  // Persist to queue dir. Filename = ISO timestamp + template id (filesystem-safe).
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const safeId = String(p.template_id).replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80);
  const filename = `${ts}-${safeId}.json`;
  const filepath = path.join(CALEB_QUEUE_DIR, filename);
  // Stamp received_at server-side so Cowork sees when it landed at the PC.
  const persisted = Object.assign({}, p, {
    received_at: new Date().toISOString(),
    status: 'pending'
  });
  try {
    fs.writeFileSync(filepath, JSON.stringify(persisted, null, 2), 'utf8');
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'write failed: ' + e.message });
  }
  console.log(`[PC RELAY] Caleb task queued: ${filename} (template ${p.template_id})`);
  res.json({
    ok: true,
    file: filepath,
    filename,
    task_id: ts + '-' + safeId,
    queue_dir: CALEB_QUEUE_DIR
  });
});

// Lets Cowork (or anyone) check what's pending without consuming.
app.get('/caleb-task/queue', (req, res) => {
  try {
    const files = fs.readdirSync(CALEB_QUEUE_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const full = path.join(CALEB_QUEUE_DIR, f);
        const st = fs.statSync(full);
        return { filename: f, size: st.size, mtime: st.mtime.toISOString() };
      })
      .sort((a, b) => a.mtime.localeCompare(b.mtime));
    res.json({ ok: true, queue_dir: CALEB_QUEUE_DIR, count: files.length, files });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── SCREENSHOT ───────────────────────────────────────────────────────────
app.get('/screenshot', (req, res) => {
  const tmpFile = path.join(os.tmpdir(), `shot_${Date.now()}.png`);
  const cmd = `Add-Type -AssemblyName System.Windows.Forms; $screen = [System.Windows.Forms.Screen]::PrimaryScreen; $bmp = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height); $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size); $bmp.Save('${tmpFile.replace(/\\/g, '\\\\')}'); Write-Output 'done'`;

  execFile('powershell', ['-NonInteractive', '-NoProfile', '-Command', cmd], { timeout: 15000 }, (err) => {
    if (err || !fs.existsSync(tmpFile)) {
      return res.status(500).json({ error: 'Screenshot failed' });
    }
    res.sendFile(tmpFile, () => {
      try { fs.unlinkSync(tmpFile); } catch (_) {}
    });
  });
});

// ── FILE BRIDGE (D:\ drive read) ─────────────────────────────────────────
// Solomon (VPS-side) can fetch PC-local files over the relay so the VPS can
// process raw footage stills, PDFs in D:\Solomon\reports\, etc., without
// having to mirror everything via scp first.
//
// Allowlist defaults to D:\Solomon\ + D:\B ROLL FOOTAGE\ (matches the docs).
// Override via PC_RELAY_FILE_ALLOWLIST (comma-separated absolute prefixes).
// Allowlist values are case-insensitively prefix-matched against the resolved
// canonical path AFTER fs.realpathSync, so symlink escapes don't help.

const FILE_DEFAULT_ALLOWLIST = ['D:\\Solomon\\', 'D:\\B ROLL FOOTAGE\\'];
const FILE_ALLOWLIST = (process.env.PC_RELAY_FILE_ALLOWLIST
  ? process.env.PC_RELAY_FILE_ALLOWLIST.split(',').map(s => s.trim()).filter(Boolean)
  : FILE_DEFAULT_ALLOWLIST
).map(p => p.endsWith('\\') || p.endsWith('/') ? p : p + '\\');
const FILE_MAX_BYTES = parseInt(process.env.PC_RELAY_FILE_MAX_BYTES || (500 * 1024 * 1024)); // 500 MB
console.log('[PC RELAY] /file allowlist:', FILE_ALLOWLIST.join(' | '));
console.log('[PC RELAY] /file max bytes:', FILE_MAX_BYTES);

// ── D: DRIVE READ-ONLY EXTENSION ─────────────────────────────────────────
// Adds a wider read-only allowlist for D: footage scanning, plus the cowork
// lock so Solomon-side never reads while Caleb/Cowork is driving the desktop.
//
// READ-ONLY ENFORCEMENT: any path under D:\ refuses non-GET methods at the
// router. /execute is also scanned for write-pattern PowerShell verbs that
// target D: (Remove-Item, Move-Item, Set-Content, Out-File, Copy-Item -Dest D:,
// New-Item, Rename-Item, ffmpeg -y output to D:, etc.).
const D_READONLY_PREFIXES = (process.env.PC_RELAY_D_READONLY_PREFIXES
  ? process.env.PC_RELAY_D_READONLY_PREFIXES.split(',').map(s => s.trim()).filter(Boolean)
  : ['D:\\']
).map(p => p.endsWith('\\') || p.endsWith('/') ? p : p + '\\');
const COWORK_LOCK_PATH = process.env.PC_COWORK_LOCK_PATH || 'C:\\Users\\Ashle\\Solomon\\.cowork-active';
const FFPROBE_BIN = process.env.PC_FFPROBE_BIN || 'ffprobe';

// ── D: WRITE CARVE-OUT (tightly scoped) ───────────────────────────────────
// The ONLY writable D: location: D:\Solomon\reports\ — used to mirror the
// inventory CSV/TXT outputs. Everything else on D: stays HARD read-only.
// Methods: POST/PUT only (no DELETE, no MOVE). Override via env if ever needed.
const D_WRITE_ALLOWLIST = (process.env.PC_RELAY_D_WRITE_ALLOWLIST
  ? process.env.PC_RELAY_D_WRITE_ALLOWLIST.split(',').map(s => s.trim()).filter(Boolean)
  : ['D:\\Solomon\\reports\\']
).map(p => p.endsWith('\\') || p.endsWith('/') ? p : p + '\\');
console.log('[PC RELAY] /file/write carve-out:', D_WRITE_ALLOWLIST.join(' | '));

function _coworkActive() {
  try { return fs.existsSync(COWORK_LOCK_PATH); } catch (_) { return false; }
}
function _isUnderD(absOrRaw) {
  if (!absOrRaw || typeof absOrRaw !== 'string') return false;
  const norm = absOrRaw.toLowerCase();
  return D_READONLY_PREFIXES.some(p => norm.startsWith(p.toLowerCase()));
}
// True ONLY for paths strictly UNDER a write-allowlist root (reports\). The bare
// root dir itself is not a writable *file* target, so we require the trailing sep.
function _isUnderWriteAllowlist(absOrRaw) {
  if (!absOrRaw || typeof absOrRaw !== 'string') return false;
  const lowered = path.win32.normalize(absOrRaw).toLowerCase();
  return D_WRITE_ALLOWLIST.some(prefix => {
    const bare = prefix.replace(/[\\/]+$/, '').toLowerCase();
    return lowered.startsWith(bare + '\\') || lowered.startsWith(bare + '/');
  });
}
// Resolve + validate a write target. Symlink-safe: realpaths the PARENT dir (which
// must resolve under the carve-out) so a symlinked reports\ can't escape. Creates
// the parent dir if missing, but only within the carve-out.
function resolveWritePath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return { ok: false, code: 400, reason: 'path query parameter required' };
  if (rawPath.includes('..')) return { ok: false, code: 400, reason: 'path contains "..": traversal rejected' };
  if (!path.isAbsolute(rawPath)) return { ok: false, code: 400, reason: 'path must be absolute' };
  const norm = path.win32.normalize(rawPath);
  // Coarse pre-check against the literal path (before touching the filesystem).
  if (!_isUnderWriteAllowlist(norm)) {
    return { ok: false, code: 405, reason: 'write path outside carve-out (only D:\\Solomon\\reports\\ is writable)' };
  }
  const dir = path.win32.dirname(norm);
  const base = path.win32.basename(norm);
  if (!base || base === '.' || base === '..') return { ok: false, code: 400, reason: 'invalid file name' };
  try { fs.mkdirSync(dir, { recursive: true }); }
  catch (e) { return { ok: false, code: 500, reason: 'mkdir failed: ' + e.message }; }
  let realDir;
  try { realDir = fs.realpathSync.native(dir); }
  catch (e) { return { ok: false, code: 500, reason: 'realpath(dir) failed: ' + e.message }; }
  // Re-check the REAL (symlink-resolved) dir is under the carve-out.
  const realLowered = realDir.toLowerCase();
  const realOk = D_WRITE_ALLOWLIST.some(prefix => {
    const bare = prefix.replace(/[\\/]+$/, '').toLowerCase();
    return realLowered === bare || realLowered.startsWith(bare + '\\') || realLowered.startsWith(bare + '/');
  });
  if (!realOk) return { ok: false, code: 405, reason: 'resolved write dir escaped the carve-out' };
  return { ok: true, abs: path.win32.join(realDir, base) };
}

// PowerShell write-verb scanner for /execute. Pure-regex; not a sandbox.
// Matches Remove-Item D:, Move-Item ... D:, Set-Content ..D:, Out-File ..D:,
// Copy-Item ... -Destination D:, New-Item -Path D:, Rename-Item D:,
// ffmpeg ... -y D:, robocopy SRC D: /MIR, del D:, rd D:, etc.
const D_WRITE_PATTERNS = [
  /\bRemove[-_]Item\b[^|;\n]*\bd:[\\/]/i,
  /\bMove[-_]Item\b[^|;\n]*\bd:[\\/]/i,
  /\bRename[-_]Item\b[^|;\n]*\bd:[\\/]/i,
  /\bSet[-_]Content\b[^|;\n]*\bd:[\\/]/i,
  /\bOut[-_]File\b[^|;\n]*\bd:[\\/]/i,
  /\bAdd[-_]Content\b[^|;\n]*\bd:[\\/]/i,
  /\bNew[-_]Item\b[^|;\n]*\bd:[\\/]/i,
  /\bCopy[-_]Item\b[^|;\n]*-(?:Destination|Path)\b[^|;\n]*\bd:[\\/]/i,
  /\bMkdir\b[^|;\n]*\bd:[\\/]/i,
  /\bdel\b\s+["']?d:[\\/]/i,
  /\bdel\s+\/[sq]\b[^|;\n]*\bd:[\\/]/i,
  /\brmdir\b[^|;\n]*\bd:[\\/]/i,
  /\brd\b\s+["']?d:[\\/]/i,
  /\brobocopy\b[^|;\n]+\bd:[\\/]/i,
  /\bxcopy\b[^|;\n]+\bd:[\\/]/i,
  /\bffmpeg\b[^|;\n]+(?:-y\s+)?[^|;\n]+\bd:[\\/]/i,
  /\bhandbrake\b[^|;\n]+\bd:[\\/]/i,
  // redirection > or >> to D:
  />>?\s*["']?d:[\\/]/i
];
function dWriteRefuseReason(cmd) {
  if (!cmd || typeof cmd !== 'string') return null;
  for (const re of D_WRITE_PATTERNS) if (re.test(cmd)) return 're=' + re.toString();
  return null;
}

// Hard-refuse non-GET on any D: path. Mounts as middleware so EVERY route
// that touches a D: path-query gets caught, not just /file*.
app.use((req, res, next) => {
  if (req.method === 'GET') return next();
  // Inspect query.path / query.dir for D:.
  const cand = req.query?.path || req.query?.dir || req.body?.path || req.body?.dir || '';
  // WRITE CARVE-OUT: POST/PUT to /file/write targeting D:\Solomon\reports\ is allowed
  // to pass through to its route (which does strict, symlink-safe validation). Any
  // other D: target — including footage — falls through to the hard 405 below.
  if ((req.method === 'POST' || req.method === 'PUT') && req.path === '/file/write'
      && cand && _isUnderWriteAllowlist(String(cand))) {
    return next();
  }
  if (cand && _isUnderD(String(cand))) {
    return res.status(405).json({ ok: false, error: 'D: drive is read-only on this relay. Non-GET methods refused for D: paths.', method: req.method, path: cand });
  }
  next();
});

const MIME_BY_EXT = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md':  'text/markdown; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.html':'text/html; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp':'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.zip': 'application/zip',
};
function mimeFor(p) {
  const ext = path.extname(p).toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

// Resolve + validate a user-supplied path. Returns { ok, abs, reason? }.
// Rejects: missing param, non-absolute, traversal attempt (..), off-allowlist,
// non-existent, symlink that escapes the allowlist (via realpathSync).
function resolveAndCheck(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return { ok: false, code: 400, reason: 'path query parameter required' };
  // Reject obvious traversal markers BEFORE normalization.
  if (rawPath.includes('..')) return { ok: false, code: 400, reason: 'path contains "..": traversal rejected' };
  if (!path.isAbsolute(rawPath)) return { ok: false, code: 400, reason: 'path must be absolute' };

  let resolved;
  try {
    // realpath collapses any "..", resolves symlinks, normalizes case.
    resolved = fs.realpathSync.native(rawPath);
  } catch (e) {
    if (e.code === 'ENOENT') return { ok: false, code: 404, reason: 'path does not exist' };
    return { ok: false, code: 500, reason: 'realpath failed: ' + e.message };
  }

  // Allowlist check: resolved must equal a prefix's bare form (the allowlist ROOT
  // itself, e.g. "D:\B ROLL FOOTAGE") OR sit strictly UNDER it. realpathSync returns
  // directory paths WITHOUT a trailing separator, but FILE_ALLOWLIST prefixes are
  // normalized to END with "\", so a naive startsWith() rejected the roots (403 bug).
  // Strip the trailing separator from the prefix and compare both forms.
  const lowered = resolved.toLowerCase();
  const allowed = FILE_ALLOWLIST.some(prefix => {
    const bare = prefix.replace(/[\\/]+$/, '').toLowerCase();
    return lowered === bare || lowered.startsWith(bare + '\\') || lowered.startsWith(bare + '/');
  });
  if (!allowed) return { ok: false, code: 403, reason: 'path outside allowlist: ' + FILE_ALLOWLIST.join(', ') };

  return { ok: true, abs: resolved };
}

// GET /file?path=<absolute-path>
// Streams the file as binary with Content-Type, Content-Length, Content-Disposition.
// Supports Range: bytes=START-END for partial-content streaming (returns 206).
app.get('/file', (req, res) => {
  const rawPath = req.query.path;
  const check = resolveAndCheck(rawPath);
  if (!check.ok) {
    console.log('[RELAY] /file REJECT', check.code, check.reason, '|', rawPath);
    return res.status(check.code).json({ ok: false, error: check.reason });
  }
  let st;
  try {
    st = fs.statSync(check.abs);
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'stat failed: ' + e.message });
  }
  if (st.isDirectory()) return res.status(400).json({ ok: false, error: 'path is a directory; use /file/list instead' });

  // Range header parse (bytes=start-end). RFC 7233 single-range only — multipart not supported.
  const rangeHeader = req.headers['range'];
  let rangeStart = 0, rangeEnd = st.size - 1, isPartial = false;
  if (rangeHeader) {
    const m = String(rangeHeader).match(/^bytes=(\d*)-(\d*)$/i);
    if (!m) return res.status(416).json({ ok: false, error: 'malformed Range header (expect bytes=START-END)' });
    const s = m[1] === '' ? null : parseInt(m[1], 10);
    const e = m[2] === '' ? null : parseInt(m[2], 10);
    if (s == null && e == null) return res.status(416).json({ ok: false, error: 'Range header has no bounds' });
    if (s != null && e != null) { rangeStart = s; rangeEnd = e; }
    else if (s != null)         { rangeStart = s; }
    else if (e != null)         { rangeStart = Math.max(0, st.size - e); }
    if (rangeStart < 0 || rangeEnd >= st.size || rangeStart > rangeEnd) {
      res.set('Content-Range', `bytes */${st.size}`);
      return res.status(416).json({ ok: false, error: 'Range Not Satisfiable', size: st.size, requested: { start: rangeStart, end: rangeEnd } });
    }
    isPartial = true;
  }
  const chunkSize = rangeEnd - rangeStart + 1;
  if (!isPartial && st.size > FILE_MAX_BYTES) {
    console.log('[RELAY] /file TOO LARGE', st.size, '>', FILE_MAX_BYTES, '|', check.abs);
    return res.status(413).json({ ok: false, error: 'file exceeds size cap (use Range header for partial reads)', size: st.size, cap: FILE_MAX_BYTES });
  }
  if (isPartial && chunkSize > FILE_MAX_BYTES) {
    return res.status(413).json({ ok: false, error: 'requested range exceeds size cap', range_size: chunkSize, cap: FILE_MAX_BYTES });
  }

  const filename = path.basename(check.abs);
  const filenameAttr = filename.replace(/["\\]/g, '_');
  res.set('Content-Type', mimeFor(check.abs));
  res.set('Content-Length', String(chunkSize));
  res.set('Accept-Ranges', 'bytes');
  res.set('Content-Disposition', `attachment; filename="${filenameAttr}"`);
  res.set('X-File-Path', check.abs);
  res.set('X-File-Bytes', String(st.size));
  if (isPartial) {
    res.set('Content-Range', `bytes ${rangeStart}-${rangeEnd}/${st.size}`);
    res.status(206);
  }
  console.log(`[RELAY] /file SERVE ${check.abs} (${chunkSize}/${st.size}B${isPartial ? ` range=${rangeStart}-${rangeEnd}` : ''}, ${mimeFor(check.abs)})`);
  const stream = fs.createReadStream(check.abs, isPartial ? { start: rangeStart, end: rangeEnd } : undefined);
  stream.on('error', (e) => {
    console.error('[RELAY] /file stream error:', e.message);
    if (!res.headersSent) res.status(500).json({ ok: false, error: e.message });
    else res.destroy(e);
  });
  stream.pipe(res);
});

// GET /file/meta?path=<absolute-path>
// Returns metadata; for media files, runs ffprobe (read-only) for duration/resolution.
// Format: { ok, path, name, size, mtime, mime, is_dir, media?: {duration_sec, width, height, codec, bitrate}, ffprobe_error? }
const MEDIA_EXTS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v', '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.jpg', '.jpeg', '.png', '.webp', '.gif']);
app.get('/file/meta', (req, res) => {
  const rawPath = req.query.path;
  const check = resolveAndCheck(rawPath);
  if (!check.ok) return res.status(check.code).json({ ok: false, error: check.reason });
  let st;
  try { st = fs.statSync(check.abs); }
  catch (e) { return res.status(500).json({ ok: false, error: 'stat failed: ' + e.message }); }
  const ext = path.extname(check.abs).toLowerCase();
  const out = {
    ok: true,
    path: check.abs,
    name: path.basename(check.abs),
    size: st.size,
    mtime: st.mtime.toISOString(),
    mime: mimeFor(check.abs),
    is_dir: st.isDirectory(),
    ext
  };
  if (st.isDirectory() || !MEDIA_EXTS.has(ext)) {
    return res.json(out);
  }
  // ffprobe (read-only) for media metadata. JSON output.
  execFile(FFPROBE_BIN, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', check.abs], { timeout: 8000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) {
      out.ffprobe_error = (stderr || err.message || '').toString().slice(0, 200);
      return res.json(out);
    }
    try {
      const probe = JSON.parse(stdout);
      const v = (probe.streams || []).find(s => s.codec_type === 'video') || null;
      const a = (probe.streams || []).find(s => s.codec_type === 'audio') || null;
      const f = probe.format || {};
      out.media = {
        duration_sec: f.duration ? Number(f.duration) : null,
        bitrate: f.bit_rate ? Number(f.bit_rate) : null,
        format_name: f.format_name || null,
        width: v?.width || null,
        height: v?.height || null,
        video_codec: v?.codec_name || null,
        fps: v?.r_frame_rate ? v.r_frame_rate : null,
        audio_codec: a?.codec_name || null,
        audio_sample_rate: a?.sample_rate ? Number(a.sample_rate) : null
      };
    } catch (e) {
      out.ffprobe_error = 'ffprobe JSON parse: ' + e.message.slice(0, 120);
    }
    res.json(out);
  });
});

// GET /file/list?dir=<absolute-dir>
// Returns { ok, dir, count, entries:[{name,size,mtime,is_dir}] }.
app.get('/file/list', (req, res) => {
  const rawDir = req.query.dir || req.query.path;
  const check = resolveAndCheck(rawDir);
  if (!check.ok) {
    return res.status(check.code).json({ ok: false, error: check.reason });
  }
  let st;
  try { st = fs.statSync(check.abs); }
  catch (e) { return res.status(500).json({ ok: false, error: 'stat failed: ' + e.message }); }
  if (!st.isDirectory()) return res.status(400).json({ ok: false, error: 'path is not a directory' });

  let names;
  try { names = fs.readdirSync(check.abs); }
  catch (e) { return res.status(500).json({ ok: false, error: 'readdir failed: ' + e.message }); }

  const entries = [];
  for (const name of names) {
    try {
      const full = path.join(check.abs, name);
      const s = fs.lstatSync(full);
      entries.push({
        name,
        size: s.size,
        mtime: s.mtime.toISOString(),
        is_dir: s.isDirectory()
      });
    } catch (_) {
      // Skip entries that can't be stat'd (permission denied, etc.).
    }
  }
  res.json({ ok: true, dir: check.abs, count: entries.length, entries });
});

// ── FILE WRITE CARVE-OUT (D:\Solomon\reports\ ONLY) ───────────────────────
// POST|PUT /file/write?path=<absolute-path>  body = raw file content.
// Mirrors VPS-side inventory outputs (CSV/TXT) onto the PC. The global D:
// read-only gate above only lets POST/PUT through here when the path is under
// the write allowlist; resolveWritePath() then re-validates symlink-safely.
// No DELETE/MOVE — those never reach here (gate refuses them with 405).
// express.raw is route-scoped so arbitrary text/binary bodies arrive intact;
// the global express.json() only consumes application/json, leaving others raw.
const fileWriteHandler = (req, res) => {
  const rawPath = req.query.path;
  const check = resolveWritePath(rawPath);
  if (!check.ok) {
    console.log('[RELAY] /file/write REJECT', check.code, check.reason, '|', rawPath);
    return res.status(check.code).json({ ok: false, error: check.reason });
  }
  let data = req.body;
  if (Buffer.isBuffer(data)) { /* raw body — use as-is */ }
  else if (typeof data === 'string') data = Buffer.from(data, 'utf8');
  else if (data && typeof data === 'object' && Object.keys(data).length) data = Buffer.from(JSON.stringify(data), 'utf8');
  else data = Buffer.alloc(0);
  if (data.length > FILE_MAX_BYTES) {
    return res.status(413).json({ ok: false, error: 'body exceeds size cap', bytes: data.length, cap: FILE_MAX_BYTES });
  }
  try {
    fs.writeFileSync(check.abs, data);
  } catch (e) {
    console.error('[RELAY] /file/write FAILED', check.abs, e.message);
    return res.status(500).json({ ok: false, error: 'write failed: ' + e.message });
  }
  let size = data.length;
  try { size = fs.statSync(check.abs).size; } catch (_) {}
  console.log(`[RELAY] /file/write OK ${check.abs} (${size}B, ${req.method})`);
  res.json({ ok: true, path: check.abs, bytes: size, method: req.method });
};
const rawBodyParser = express.raw({ type: () => true, limit: FILE_MAX_BYTES });
app.post('/file/write', rawBodyParser, fileWriteHandler);
app.put('/file/write', rawBodyParser, fileWriteHandler);

// ── START ────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[PC RELAY] Running on port ${PORT}`);
  console.log(`[PC RELAY] Hostname: ${os.hostname()}`);
  console.log('[PC RELAY] Ready for Solomon commands');
});

// ── CALEB-WORKER SUPERVISOR ────────────────────────────────────────────────
// Root-cause persistence fix: the worker used to run from a one-shot logon task
// and die silently, stalling every Caleb dispatch. The relay (the always-up
// process that RECEIVES dispatches) now OWNS the worker lifecycle — it spawns the
// worker as a CHILD (separate OS process, so a Playwright/browser crash can't take
// down dispatch reception) and respawns it on exit with capped backoff. Runs in
// the relay's interactive session, so the worker's headful Chrome stays visible.
const { spawn: _spawn } = require('child_process');
const WORKER_SCRIPT = path.join(__dirname, 'caleb-worker.js');
let _calebRestarts = 0;
let _calebBackoff = 1000;
let _calebStableTimer = null;
function startCalebWorker() {
  if (!fs.existsSync(WORKER_SCRIPT)) { console.error('[RELAY] caleb-worker.js missing — cannot supervise'); return; }
  try {
    _calebChild = _spawn(process.execPath, [WORKER_SCRIPT], { cwd: __dirname, env: process.env, stdio: 'ignore', windowsHide: true });
  } catch (e) { console.error('[RELAY] caleb-worker spawn failed:', e.message); _calebChild = null; setTimeout(startCalebWorker, _calebBackoff); return; }
  console.log(`[RELAY] caleb-worker spawned pid=${_calebChild.pid} (restart #${_calebRestarts})`);
  if (_calebStableTimer) clearTimeout(_calebStableTimer);
  _calebStableTimer = setTimeout(() => { _calebBackoff = 1000; }, 60000); // reset backoff after a stable minute
  _calebChild.on('error', (e) => console.error('[RELAY] caleb-worker child error:', e.message));
  _calebChild.on('exit', (code, sig) => {
    _calebChild = null; _calebRestarts++;
    console.error(`[RELAY] caleb-worker exited (code=${code} sig=${sig}) — respawning in ${_calebBackoff}ms`);
    setTimeout(startCalebWorker, _calebBackoff);
    _calebBackoff = Math.min(_calebBackoff * 2, 30000);
  });
}
// Adopt any worker started outside the relay: kill strays so the relay is the
// SINGLE supervisor, then spawn our own.
startCalebWorker();
process.on('exit', () => { try { if (_calebChild) _calebChild.kill(); } catch (_) {} });
