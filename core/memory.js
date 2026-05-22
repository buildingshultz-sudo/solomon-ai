/**
 * Solomon Memory System v2.0
 *
 * Persistent knowledge storage for business context, user preferences,
 * learned facts, and operational history. SQLite-backed for reliability.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'sol-memory.db');
const KB_FILE = path.join(__dirname, '..', 'sol-knowledge.json');

let db;

function initDB() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER DEFAULT (strftime('%s','now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, timestamp);

    CREATE TABLE IF NOT EXISTS knowledge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      key TEXT,
      value TEXT NOT NULL,
      source TEXT,
      confidence REAL DEFAULT 1.0,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_cat ON knowledge(category);

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'active',
      phase TEXT,
      category TEXT,
      data TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      text TEXT NOT NULL,
      trigger_time INTEGER NOT NULL,
      recurring TEXT,
      fired INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_reminders_time ON reminders(trigger_time, fired);

    CREATE TABLE IF NOT EXISTS credentials (
      service TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );

    CREATE TABLE IF NOT EXISTS metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      metric TEXT NOT NULL,
      value REAL,
      metadata TEXT,
      recorded_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_metrics_cat ON metrics(category, recorded_at);
  `);

  return db;
}

// ── MESSAGES ───────────────────────────────────────────────────────────────
function saveMessage(chatId, role, content) {
  const stmt = db.prepare('INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)');
  stmt.run(String(chatId), role, content);
}

function getChatHistory(chatId, limit = 30) {
  const stmt = db.prepare(
    'SELECT role, content FROM messages WHERE chat_id = ? ORDER BY timestamp DESC LIMIT ?'
  );
  return stmt.all(String(chatId), limit).reverse();
}

function clearChatHistory(chatId) {
  db.prepare('DELETE FROM messages WHERE chat_id = ?').run(String(chatId));
}

// ── KNOWLEDGE BASE ─────────────────────────────────────────────────────────
function addKnowledge(category, value, key = null, source = null) {
  // Upsert if key exists
  if (key) {
    const existing = db.prepare('SELECT id FROM knowledge WHERE category = ? AND key = ?').get(category, key);
    if (existing) {
      db.prepare('UPDATE knowledge SET value = ?, source = ?, updated_at = ? WHERE id = ?')
        .run(value, source, Date.now(), existing.id);
      return existing.id;
    }
  }
  const stmt = db.prepare('INSERT INTO knowledge (category, key, value, source) VALUES (?, ?, ?, ?)');
  return stmt.run(category, key, typeof value === 'string' ? value : JSON.stringify(value), source).lastInsertRowid;
}

function getKnowledge(category, key = null) {
  if (key) {
    return db.prepare('SELECT * FROM knowledge WHERE category = ? AND key = ?').get(category, key);
  }
  return db.prepare('SELECT * FROM knowledge WHERE category = ? ORDER BY updated_at DESC LIMIT 50').all(category);
}

function searchKnowledge(query) {
  return db.prepare('SELECT * FROM knowledge WHERE value LIKE ? ORDER BY updated_at DESC LIMIT 20')
    .all(`%${query}%`);
}

function getKnowledgeSummary() {
  const categories = db.prepare('SELECT category, COUNT(*) as count FROM knowledge GROUP BY category').all();
  const recent = db.prepare('SELECT category, key, value FROM knowledge ORDER BY updated_at DESC LIMIT 10').all();
  return { categories, recent };
}

function getKBContext() {
  // Build context string for LLM injection
  const facts = db.prepare("SELECT value FROM knowledge WHERE category = 'facts' ORDER BY updated_at DESC LIMIT 10").all();
  const decisions = db.prepare("SELECT value FROM knowledge WHERE category = 'decisions' ORDER BY updated_at DESC LIMIT 5").all();
  const research = db.prepare("SELECT value FROM knowledge WHERE category = 'research_findings' ORDER BY updated_at DESC LIMIT 3").all();

  let ctx = '';
  if (facts.length > 0) ctx += `\n[Known Facts]\n${facts.map(f => `• ${f.value}`).join('\n')}\n`;
  if (decisions.length > 0) ctx += `\n[Recent Decisions]\n${decisions.map(d => `• ${d.value}`).join('\n')}\n`;
  if (research.length > 0) ctx += `\n[Research Findings]\n${research.map(r => `• ${(typeof r.value === 'string' ? r.value : '').slice(0, 200)}`).join('\n')}\n`;
  return ctx;
}

// ── PROJECTS ───────────────────────────────────────────────────────────────
function saveProject(id, data) {
  const existing = db.prepare('SELECT id FROM projects WHERE id = ?').get(id);
  if (existing) {
    db.prepare('UPDATE projects SET name = ?, description = ?, status = ?, phase = ?, category = ?, data = ?, updated_at = ? WHERE id = ?')
      .run(data.name, data.description, data.status, data.phase, data.category, JSON.stringify(data), Date.now(), id);
  } else {
    db.prepare('INSERT INTO projects (id, name, description, status, phase, category, data) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, data.name, data.description, data.status || 'active', data.phase, data.category, JSON.stringify(data));
  }
}

function getProjects(status = null) {
  if (status) {
    return db.prepare('SELECT * FROM projects WHERE status = ? ORDER BY updated_at DESC').all(status);
  }
  return db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all();
}

function getProject(id) {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (row && row.data) {
    try { return { ...row, ...JSON.parse(row.data) }; } catch {}
  }
  return row;
}

// ── REMINDERS ──────────────────────────────────────────────────────────────
function addReminder(chatId, text, triggerTime, recurring = null) {
  return db.prepare('INSERT INTO reminders (chat_id, text, trigger_time, recurring) VALUES (?, ?, ?, ?)')
    .run(String(chatId), text, triggerTime, recurring).lastInsertRowid;
}

function getDueReminders() {
  const now = Date.now();
  return db.prepare('SELECT * FROM reminders WHERE trigger_time <= ? AND fired = 0').all(now);
}

function markReminderFired(id) {
  db.prepare('UPDATE reminders SET fired = 1 WHERE id = ?').run(id);
}

function getActiveReminders(chatId) {
  return db.prepare('SELECT * FROM reminders WHERE chat_id = ? AND fired = 0 ORDER BY trigger_time').all(String(chatId));
}

// ── METRICS ────────────────────────────────────────────────────────────────
function recordMetric(category, metric, value, metadata = null) {
  db.prepare('INSERT INTO metrics (category, metric, value, metadata) VALUES (?, ?, ?, ?)')
    .run(category, metric, value, metadata ? JSON.stringify(metadata) : null);
}

function getMetrics(category, metric, since = null) {
  if (since) {
    return db.prepare('SELECT * FROM metrics WHERE category = ? AND metric = ? AND recorded_at >= ? ORDER BY recorded_at')
      .all(category, metric, since);
  }
  return db.prepare('SELECT * FROM metrics WHERE category = ? AND metric = ? ORDER BY recorded_at DESC LIMIT 100')
    .all(category, metric);
}

// ── CREDENTIALS (encrypted in future) ─────────────────────────────────────
function saveCredential(service, data) {
  const existing = db.prepare('SELECT service FROM credentials WHERE service = ?').get(service);
  const json = JSON.stringify(data);
  if (existing) {
    db.prepare('UPDATE credentials SET data = ?, updated_at = ? WHERE service = ?').run(json, Date.now(), service);
  } else {
    db.prepare('INSERT INTO credentials (service, data) VALUES (?, ?)').run(service, json);
  }
}

function getCredential(service) {
  const row = db.prepare('SELECT data FROM credentials WHERE service = ?').get(service);
  if (row) {
    try { return JSON.parse(row.data); } catch { return null; }
  }
  return null;
}

// ── MIGRATION from JSON files ──────────────────────────────────────────────
function migrateFromJSON() {
  // Migrate knowledge base
  if (fs.existsSync(KB_FILE)) {
    try {
      const kb = JSON.parse(fs.readFileSync(KB_FILE, 'utf8'));
      for (const [category, entries] of Object.entries(kb)) {
        if (Array.isArray(entries)) {
          for (const entry of entries) {
            addKnowledge(category, typeof entry === 'string' ? entry : JSON.stringify(entry));
          }
        }
      }
      console.log('[MEMORY] Migrated knowledge base from JSON');
    } catch (e) {
      console.log('[MEMORY] KB migration skipped:', e.message);
    }
  }
}

// ── INIT ───────────────────────────────────────────────────────────────────
initDB();

module.exports = {
  db, initDB,
  saveMessage, getChatHistory, clearChatHistory,
  addKnowledge, getKnowledge, searchKnowledge, getKnowledgeSummary, getKBContext,
  saveProject, getProjects, getProject,
  addReminder, getDueReminders, markReminderFired, getActiveReminders,
  recordMetric, getMetrics,
  saveCredential, getCredential,
  migrateFromJSON
};
