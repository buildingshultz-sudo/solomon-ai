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
app.get('/status', (req, res) => {
  res.json({
    ok: true,
    hostname: os.hostname(),
    platform: os.platform(),
    uptime: os.uptime(),
    time: new Date().toISOString()
  });
});

// ── EXECUTE POWERSHELL ───────────────────────────────────────────────────
app.post('/execute', (req, res) => {
  const { command, timeout = 30000 } = req.body;
  if (!command) return res.status(400).json({ error: 'No command provided' });

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

  // Allowlist check: resolved must startWith one of the prefixes (case-insensitive on Windows).
  const lowered = resolved.toLowerCase();
  const allowed = FILE_ALLOWLIST.some(prefix => lowered.startsWith(prefix.toLowerCase()));
  if (!allowed) return { ok: false, code: 403, reason: 'path outside allowlist: ' + FILE_ALLOWLIST.join(', ') };

  return { ok: true, abs: resolved };
}

// GET /file?path=<absolute-path>
// Streams the file as binary with Content-Type, Content-Length, Content-Disposition.
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
  if (st.size > FILE_MAX_BYTES) {
    console.log('[RELAY] /file TOO LARGE', st.size, '>', FILE_MAX_BYTES, '|', check.abs);
    return res.status(413).json({ ok: false, error: 'file exceeds size cap', size: st.size, cap: FILE_MAX_BYTES });
  }

  const filename = path.basename(check.abs);
  // Quote-safe filename for Content-Disposition (RFC 6266 fallback).
  const filenameAttr = filename.replace(/["\\]/g, '_');
  res.set('Content-Type', mimeFor(check.abs));
  res.set('Content-Length', String(st.size));
  res.set('Content-Disposition', `attachment; filename="${filenameAttr}"`);
  res.set('X-File-Path', check.abs);
  res.set('X-File-Bytes', String(st.size));
  console.log(`[RELAY] /file SERVE ${check.abs} (${st.size}B, ${mimeFor(check.abs)})`);
  const stream = fs.createReadStream(check.abs);
  stream.on('error', (e) => {
    console.error('[RELAY] /file stream error:', e.message);
    if (!res.headersSent) res.status(500).json({ ok: false, error: e.message });
    else res.destroy(e);
  });
  stream.pipe(res);
});

// GET /file/list?dir=<absolute-dir>
// Returns { ok, dir, count, entries:[{name,size,mtime,is_dir}] }.
app.get('/file/list', (req, res) => {
  const rawDir = req.query.dir;
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

// ── START ────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[PC RELAY] Running on port ${PORT}`);
  console.log(`[PC RELAY] Hostname: ${os.hostname()}`);
  console.log('[PC RELAY] Ready for Solomon commands');
});
