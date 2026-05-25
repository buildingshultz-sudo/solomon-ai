'use strict';
// activity-logger.js — Lightweight activity logging for Solomon dashboard
// Logs tool calls, messages, errors, and status changes to SQLite.
// Used by bot.js to write logs, and by dashboard.js to read them.

const Database = require('better-sqlite3');
const path = require('path');
const DB_PATH = path.join(__dirname, 'solomon.db');

let db;
try {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
} catch (err) {
  console.error('[ActivityLogger] Failed to open DB:', err.message);
  // Provide no-op fallback so bot doesn't crash
  db = null;
}

// Create activity_log table if it doesn't exist
if (db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      type TEXT NOT NULL,
      tool_name TEXT,
      status TEXT DEFAULT 'ok',
      summary TEXT,
      duration_ms INTEGER,
      metadata TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_activity_log_timestamp ON activity_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_activity_log_type ON activity_log(type);
  `);
}

// Current bot status (in-memory, shared via module)
let currentStatus = {
  state: 'IDLE',        // IDLE, THINKING, WORKING
  description: '',
  since: new Date().toISOString()
};

// Listeners for real-time push (dashboard WebSocket clients)
const listeners = [];

function addListener(fn) {
  listeners.push(fn);
}

function removeListener(fn) {
  const idx = listeners.indexOf(fn);
  if (idx >= 0) listeners.splice(idx, 1);
}

function notifyListeners(event) {
  for (const fn of listeners) {
    try { fn(event); } catch (_) {}
  }
}

// ── LOGGING FUNCTIONS ────────────────────────────────────────────────────

function logActivity(type, { toolName, status, summary, durationMs, metadata } = {}) {
  if (!db) return;
  try {
    db.prepare(`INSERT INTO activity_log (type, tool_name, status, summary, duration_ms, metadata)
      VALUES (?, ?, ?, ?, ?, ?)`).run(
      type,
      toolName || null,
      status || 'ok',
      summary || null,
      durationMs || null,
      metadata ? JSON.stringify(metadata) : null
    );
    const event = { type, toolName, status, summary, durationMs, metadata, timestamp: new Date().toISOString() };
    notifyListeners(event);
  } catch (err) {
    // Silent fail — never break the bot
  }
}

function setStatus(state, description) {
  currentStatus = { state, description: description || '', since: new Date().toISOString() };
  notifyListeners({ type: 'status_change', status: currentStatus });
}

function getStatus() {
  return currentStatus;
}

// ── QUERY FUNCTIONS (for dashboard) ──────────────────────────────────────

function getRecentActivity(limit = 50) {
  if (!db) return [];
  return db.prepare('SELECT * FROM activity_log ORDER BY id DESC LIMIT ?').all(limit);
}

function getTodayStats() {
  if (!db) return { messages: 0, tasks_completed: 0, errors: 0, tool_calls: 0 };
  const today = new Date().toISOString().slice(0, 10);
  const messages = db.prepare(`SELECT COUNT(*) as c FROM activity_log WHERE type IN ('message_received','message_sent') AND timestamp >= ?`).get(today + ' 00:00:00');
  const tasksCompleted = db.prepare(`SELECT COUNT(*) as c FROM activity_log WHERE type = 'task_complete' AND timestamp >= ?`).get(today + ' 00:00:00');
  const errors = db.prepare(`SELECT COUNT(*) as c FROM activity_log WHERE status = 'error' AND timestamp >= ?`).get(today + ' 00:00:00');
  const toolCalls = db.prepare(`SELECT COUNT(*) as c FROM activity_log WHERE type = 'tool_call' AND timestamp >= ?`).get(today + ' 00:00:00');
  return {
    messages: (messages?.c || 0),
    tasks_completed: (tasksCompleted?.c || 0),
    errors: (errors?.c || 0),
    tool_calls: (toolCalls?.c || 0)
  };
}

function getToolUsageStats() {
  if (!db) return [];
  const today = new Date().toISOString().slice(0, 10);
  return db.prepare(`SELECT tool_name, COUNT(*) as count, AVG(duration_ms) as avg_duration
    FROM activity_log WHERE type = 'tool_call' AND tool_name IS NOT NULL AND timestamp >= ?
    GROUP BY tool_name ORDER BY count DESC LIMIT 15`).all(today + ' 00:00:00');
}

function getRecentErrors(limit = 10) {
  if (!db) return [];
  return db.prepare(`SELECT * FROM activity_log WHERE status = 'error' ORDER BY id DESC LIMIT ?`).all(limit);
}

function getTaskQueue() {
  if (!db) return { pending: [], running: [], completed: [] };
  try {
    const pending = db.prepare("SELECT * FROM tasks WHERE status='pending' ORDER BY priority ASC, id ASC LIMIT 10").all();
    const running = db.prepare("SELECT * FROM tasks WHERE status='running' ORDER BY id DESC LIMIT 5").all();
    const completed = db.prepare("SELECT * FROM tasks WHERE status IN ('done','failed') ORDER BY completed_at DESC LIMIT 10").all();
    return { pending, running, completed };
  } catch (_) {
    return { pending: [], running: [], completed: [] };
  }
}

function getUptime() {
  // Read from a file that bot.js writes on startup
  const uptimeFile = path.join(__dirname, '.bot-start-time');
  try {
    const startTime = require('fs').readFileSync(uptimeFile, 'utf8').trim();
    const ms = Date.now() - new Date(startTime).getTime();
    return ms;
  } catch (_) {
    return 0;
  }
}

module.exports = {
  logActivity,
  setStatus,
  getStatus,
  getRecentActivity,
  getTodayStats,
  getToolUsageStats,
  getRecentErrors,
  getTaskQueue,
  getUptime,
  addListener,
  removeListener
};
