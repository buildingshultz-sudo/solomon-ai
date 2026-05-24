'use strict';
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'solomon.db');
const db = new Database(DB_PATH);

// WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── SCHEMA — 7 tables ────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    type TEXT DEFAULT 'general',
    status TEXT DEFAULT 'pending',
    priority INTEGER DEFAULT 5,
    retries INTEGER DEFAULT 0,
    result TEXT,
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    completed_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(category, key)
  );

  CREATE TABLE IF NOT EXISTS budget (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cost_usd REAL DEFAULT 0,
    model TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS code_lessons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project TEXT NOT NULL,
    phase TEXT,
    session_type TEXT,
    what_worked TEXT,
    what_failed TEXT,
    error_patterns TEXT,
    code_snippets TEXT,
    time_taken_minutes INTEGER,
    applied_to_next INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS project_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    repo_url TEXT,
    local_path TEXT,
    current_phase TEXT DEFAULT 'spec',
    status TEXT DEFAULT 'active',
    spec_summary TEXT,
    last_commit TEXT,
    tech_stack TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS error_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    error_signature TEXT UNIQUE NOT NULL,
    error_context TEXT,
    solution TEXT NOT NULL,
    times_encountered INTEGER DEFAULT 1,
    times_applied INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ── MESSAGES ────────────────────────────────────────────────────────────
const messages = {
  add(role, content) {
    db.prepare('INSERT INTO messages (role, content) VALUES (?, ?)').run(role, content);
  },
  getLast(n = 20) {
    return db.prepare('SELECT role, content FROM messages ORDER BY id DESC LIMIT ?').all(n).reverse();
  },
  clear() {
    db.prepare('DELETE FROM messages').run();
  }
};

// ── TASKS ───────────────────────────────────────────────────────────────
const tasks = {
  add({ title, description, type = 'general', priority = 5 }) {
    const r = db.prepare(
      'INSERT INTO tasks (title, description, type, priority) VALUES (?, ?, ?, ?)'
    ).run(title, description, type, priority);
    return r.lastInsertRowid;
  },
  start(id) {
    db.prepare("UPDATE tasks SET status='in_progress', started_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
  },
  complete(id, result) {
    db.prepare("UPDATE tasks SET status='complete', result=?, completed_at=CURRENT_TIMESTAMP WHERE id=?").run(result, id);
  },
  fail(id, error) {
    db.prepare("UPDATE tasks SET status='failed', error=? WHERE id=?").run(error, id);
  },
  incrementRetry(id) {
    db.prepare("UPDATE tasks SET retries=retries+1, status='pending' WHERE id=?").run(id);
    const row = db.prepare('SELECT retries FROM tasks WHERE id=?').get(id);
    return row ? row.retries : 0;
  },
  getPending() {
    // Max 3 retries enforced here
    return db.prepare("SELECT * FROM tasks WHERE status='pending' AND retries < 3 ORDER BY priority ASC, id ASC").all();
  },
  getAll() {
    return db.prepare('SELECT * FROM tasks ORDER BY id DESC LIMIT 20').all();
  }
};

// ── MEMORY ───────────────────────────────────────────────────────────────
const mem = {
  set(category, key, value) {
    db.prepare(`INSERT INTO memory (category, key, value, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(category, key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`
    ).run(category, key, String(value));
  },
  get(category, key) {
    const row = db.prepare('SELECT value FROM memory WHERE category=? AND key=?').get(category, key);
    return row ? row.value : null;
  },
  getCategory(category) {
    return db.prepare('SELECT key, value FROM memory WHERE category=?').all(category);
  },
  getAll() {
    return db.prepare('SELECT category, key, value FROM memory ORDER BY category, key').all();
  }
};

// ── BUDGET ──────────────────────────────────────────────────────────────
const budget = {
  log({ taskId, inputTokens, outputTokens, model }) {
    // Claude Sonnet 4 pricing: $3/M input, $15/M output
    const cost = (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15;
    db.prepare('INSERT INTO budget (task_id, input_tokens, output_tokens, cost_usd, model) VALUES (?, ?, ?, ?, ?)')
      .run(taskId || null, inputTokens, outputTokens, cost, model);
    return cost;
  },
  getMonthTotal() {
    const row = db.prepare(`SELECT SUM(cost_usd) as total FROM budget
      WHERE created_at >= date('now', 'start of month')`).get();
    return row ? (row.total || 0) : 0;
  }
};

// ── CODE LESSONS (Phase 7) ──────────────────────────────────────────────
const lessons = {
  add({ project, phase, sessionType, whatWorked, whatFailed, errorPatterns, codeSnippets, timeTaken }) {
    db.prepare(`INSERT INTO code_lessons
      (project, phase, session_type, what_worked, what_failed, error_patterns, code_snippets, time_taken_minutes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(project, phase, sessionType, whatWorked, whatFailed, errorPatterns || null, codeSnippets || null, timeTaken || null);
  },
  getForProject(project) {
    return db.prepare('SELECT * FROM code_lessons WHERE project = ? ORDER BY id DESC').all(project);
  },
  getTop(limit = 10) {
    return db.prepare('SELECT * FROM code_lessons ORDER BY id DESC LIMIT ?').all(limit);
  },
  markApplied(id) {
    db.prepare('UPDATE code_lessons SET applied_to_next = 1 WHERE id = ?').run(id);
  }
};

// ── PROJECT STATE (Phase 7) ─────────────────────────────────────────────
const projects = {
  upsert({ name, repoUrl, localPath, phase, status, specSummary, lastCommit, techStack }) {
    db.prepare(`INSERT INTO project_state
      (name, repo_url, local_path, current_phase, status, spec_summary, last_commit, tech_stack, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(name) DO UPDATE SET
        repo_url = COALESCE(excluded.repo_url, project_state.repo_url),
        local_path = COALESCE(excluded.local_path, project_state.local_path),
        current_phase = COALESCE(excluded.current_phase, project_state.current_phase),
        status = COALESCE(excluded.status, project_state.status),
        spec_summary = COALESCE(excluded.spec_summary, project_state.spec_summary),
        last_commit = COALESCE(excluded.last_commit, project_state.last_commit),
        tech_stack = COALESCE(excluded.tech_stack, project_state.tech_stack),
        updated_at = CURRENT_TIMESTAMP`
    ).run(
      name,
      repoUrl || null,
      localPath || null,
      phase || null,
      status || null,
      specSummary || null,
      lastCommit || null,
      techStack || null
    );
  },
  get(name) {
    return db.prepare('SELECT * FROM project_state WHERE name = ?').get(name);
  },
  getAll() {
    return db.prepare('SELECT * FROM project_state ORDER BY updated_at DESC').all();
  }
};

// ── ERROR PATTERNS (Phase 7) ────────────────────────────────────────────
const errorDB = {
  record(signature, context, solution) {
    db.prepare(`INSERT INTO error_patterns (error_signature, error_context, solution)
      VALUES (?, ?, ?)
      ON CONFLICT(error_signature) DO UPDATE SET
        times_encountered = times_encountered + 1,
        solution = excluded.solution,
        error_context = excluded.error_context`
    ).run(signature, context, solution);
  },
  find(signature) {
    const searchTerm = `%${(signature || '').slice(0, 50)}%`;
    return db.prepare('SELECT * FROM error_patterns WHERE error_signature LIKE ? LIMIT 3').all(searchTerm);
  },
  markApplied(id) {
    db.prepare('UPDATE error_patterns SET times_applied = times_applied + 1 WHERE id = ?').run(id);
  }
};

// ── TEST / RESET ─────────────────────────────────────────────────────────
function testDB() {
  mem.set('identity', 'name', 'Solomon');
  mem.set('identity', 'owner', 'Jedidiah Shultz');
  const val = mem.get('identity', 'name');
  console.log('[DB TEST] Read back:', val);
  console.log('[DB TEST] All memory entries:', mem.getAll().length);
  console.log('[DB] SQLite ready at', DB_PATH);
  if (val !== 'Solomon') throw new Error('DB TEST FAILED');
  console.log('[DB TEST] PASS');
}

function resetDB() {
  db.exec('DELETE FROM messages; DELETE FROM tasks; DELETE FROM budget;');
  console.log('[DB] Reset complete. Memory preserved.');
}

module.exports = { messages, tasks, mem, budget, lessons, projects, errorDB, testDB, resetDB, db };
