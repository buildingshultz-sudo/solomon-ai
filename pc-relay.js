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
