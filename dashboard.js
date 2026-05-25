'use strict';
// dashboard.js — Solomon Monitoring Dashboard
// Separate Express app on port 3001 with WebSocket for real-time updates.
// Reads from the same SQLite database as Solomon bot.
// Run as separate PM2 process: "solomon-dashboard"

require('dotenv').config();

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const activityLogger = require('./activity-logger');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = parseInt(process.env.DASHBOARD_PORT || '3001');
const PASSWORD = process.env.DASHBOARD_PASSWORD || 'shultz2024';

// Simple session tokens (in-memory, reset on restart)
const validTokens = new Set();

// ── MIDDLEWARE ────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ── AUTH ENDPOINTS ───────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === PASSWORD) {
    const token = crypto.randomBytes(32).toString('hex');
    validTokens.add(token);
    // Clean old tokens if too many (simple memory management)
    if (validTokens.size > 100) {
      const arr = [...validTokens];
      arr.slice(0, 50).forEach(t => validTokens.delete(t));
    }
    res.json({ ok: true, token });
  } else {
    res.status(401).json({ ok: false, error: 'Invalid password' });
  }
});

// Auth middleware for API routes
function authCheck(req, res, next) {
  const token = req.headers['x-auth-token'] || req.query.token;
  if (token && validTokens.has(token)) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

// ── API ENDPOINTS ────────────────────────────────────────────────────────
app.get('/api/status', authCheck, (req, res) => {
  const status = activityLogger.getStatus();
  const uptime = activityLogger.getUptime();
  const stats = activityLogger.getTodayStats();
  res.json({ status, uptime, stats });
});

app.get('/api/activity', authCheck, (req, res) => {
  const limit = parseInt(req.query.limit || '50');
  const activity = activityLogger.getRecentActivity(Math.min(limit, 200));
  res.json(activity);
});

app.get('/api/errors', authCheck, (req, res) => {
  const errors = activityLogger.getRecentErrors(20);
  res.json(errors);
});

app.get('/api/tools', authCheck, (req, res) => {
  const tools = activityLogger.getToolUsageStats();
  res.json(tools);
});

app.get('/api/tasks', authCheck, (req, res) => {
  const tasks = activityLogger.getTaskQueue();
  res.json(tasks);
});

// ── SERVE FRONTEND ───────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// ── WEBSOCKET ────────────────────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  let authenticated = false;

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'auth') {
        if (msg.token && validTokens.has(msg.token)) {
          authenticated = true;
          ws.send(JSON.stringify({ type: 'auth_ok' }));
          // Send current status immediately
          ws.send(JSON.stringify({ type: 'status', data: activityLogger.getStatus() }));
        } else {
          ws.send(JSON.stringify({ type: 'auth_fail' }));
          ws.close();
        }
      }
    } catch (_) {}
  });

  // Register listener for real-time events
  const listener = (event) => {
    if (!authenticated) return;
    try {
      ws.send(JSON.stringify({ type: 'event', data: event }));
    } catch (_) {
      // Client disconnected
    }
  };

  activityLogger.addListener(listener);

  ws.on('close', () => {
    activityLogger.removeListener(listener);
  });

  ws.on('error', () => {
    activityLogger.removeListener(listener);
  });
});

// ── START SERVER ─────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Dashboard] Solomon monitoring dashboard running on port ${PORT}`);
  console.log(`[Dashboard] Access at http://167.99.237.26:${PORT}`);
});
