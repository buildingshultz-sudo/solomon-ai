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

if (!SECRET) {
  console.error('[PC RELAY] FATAL: PC_RELAY_SECRET not set in .env');
  process.exit(1);
}

// ── AUTH MIDDLEWARE ──────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (req.headers['x-secret'] !== SECRET) {
    console.log('[RELAY] Unauthorized request from', req.ip);
    return res.status(401).json({ error: 'Unauthorized' });
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
const CALEB_QUEUE_DIR = process.env.CALEB_QUEUE_DIR || (os.platform() === 'win32' ? 'D:\\caleb-queue' : path.join(os.homedir(), 'caleb-queue'));
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

// ── START ────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[PC RELAY] Running on port ${PORT}`);
  console.log(`[PC RELAY] Hostname: ${os.hostname()}`);
  console.log('[PC RELAY] Ready for Solomon commands');
});
