'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const DB_PATH = path.join(__dirname, 'solomon.db');
const db = new Database(DB_PATH);
// WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
// ── SCHEMA — 10 tables ───────────────────────────────────────────────────
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
  CREATE TABLE IF NOT EXISTS project_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_name TEXT UNIQUE NOT NULL,
    priority INTEGER DEFAULT 5,
    status TEXT DEFAULT 'queued',
    brief TEXT NOT NULL,
    app_type TEXT,
    budget_usd REAL DEFAULT 15.0,
    spent_usd REAL DEFAULT 0.0,
    phases_complete INTEGER DEFAULT 0,
    phases_total INTEGER DEFAULT 6,
    github_repo TEXT,
    deploy_url TEXT,
    started_at DATETIME,
    completed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS feature_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT NOT NULL,
    priority TEXT DEFAULT 'medium',
    status TEXT DEFAULT 'pending',
    requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    notes TEXT
  );
  CREATE TABLE IF NOT EXISTS nathan_inbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    priority TEXT DEFAULT 'normal',
    status TEXT DEFAULT 'unread',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS parallel_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_name TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    tool_args TEXT NOT NULL,
    status TEXT DEFAULT 'queued',
    priority INTEGER DEFAULT 5,
    result TEXT,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    completed_at DATETIME
  );
  CREATE TABLE IF NOT EXISTS claude_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id TEXT NOT NULL,
    original_path TEXT,
    filename TEXT,
    purpose TEXT,
    mime_type TEXT,
    size_bytes INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS native_memories (
    path TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS batch_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id TEXT NOT NULL,
    custom_id TEXT,
    purpose TEXT,
    status TEXT DEFAULT 'processing',
    result TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
  );
  CREATE TABLE IF NOT EXISTS scheduled_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page TEXT NOT NULL,
    platform TEXT DEFAULT "facebook",
    message TEXT NOT NULL,
    link TEXT,
    image_url TEXT,
    scheduled_for DATETIME NOT NULL,
    status TEXT DEFAULT "pending",
    post_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    posted_at DATETIME
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
  getCount() {
    return db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
  },
  clear() {
    db.prepare('DELETE FROM messages').run();
  }
};
// ── TASKS ───────────────────────────────────────────────────────────────
const tasks = {
  add({ title, description, type, priority }) {
    const info = db.prepare(
      'INSERT INTO tasks (title, description, type, priority) VALUES (?, ?, ?, ?)'
    ).run(title, description, type || 'general', priority || 5);
    return info.lastInsertRowid;
  },
  getAll() {
    return db.prepare('SELECT * FROM tasks ORDER BY id DESC LIMIT 20').all();
  },
  getPending() {
    return db.prepare("SELECT * FROM tasks WHERE status='pending' ORDER BY priority ASC, id ASC").all();
  },
  start(id) {
    db.prepare("UPDATE tasks SET status='running', started_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
  },
  complete(id, result) {
    db.prepare("UPDATE tasks SET status='done', result=?, completed_at=CURRENT_TIMESTAMP WHERE id=?").run(result, id);
  },
  fail(id, error) {
    db.prepare("UPDATE tasks SET status='failed', error=?, completed_at=CURRENT_TIMESTAMP WHERE id=?").run(error, id);
  },
  incrementRetry(id) {
    db.prepare("UPDATE tasks SET retries = retries + 1, started_at = CURRENT_TIMESTAMP WHERE id=?").run(id);
    const task = db.prepare("SELECT retries FROM tasks WHERE id=?").get(id);
    return task ? task.retries : 0;
  }
};
// ── MEMORY (key-value) ──────────────────────────────────────────────────
const mem = {
  set(category, key, value) {
    db.prepare(
      `INSERT INTO memory (category, key, value) VALUES (?, ?, ?)
       ON CONFLICT(category, key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`
    ).run(category, key, value);
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
  },
  delete(category, key) {
    db.prepare('DELETE FROM memory WHERE category=? AND key=?').run(category, key);
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
  },
  getRecent(hours = 24) {
    return db.prepare(`SELECT * FROM error_patterns WHERE created_at >= datetime('now', '-' || ? || ' hours') ORDER BY id DESC`).all(hours);
  }
};
// ── PROJECT QUEUE (Phase 8) ─────────────────────────────────────────────
const projectQueue = {
  add({ appName, priority, brief, appType, budgetUsd }) {
    db.prepare(`INSERT INTO project_queue (app_name, priority, brief, app_type, budget_usd)
      VALUES (?, ?, ?, ?, ?)`)
      .run(appName, priority || 5, brief, appType || 'react-web', budgetUsd || 15.0);
    return db.prepare('SELECT * FROM project_queue WHERE app_name = ?').get(appName);
  },
  getAll() {
    return db.prepare('SELECT * FROM project_queue ORDER BY priority ASC, created_at ASC').all();
  },
  getByStatus(status) {
    return db.prepare('SELECT * FROM project_queue WHERE status = ? ORDER BY priority ASC').all(status);
  },
  getNext() {
    return db.prepare("SELECT * FROM project_queue WHERE status = 'queued' ORDER BY priority ASC LIMIT 1").get();
  },
  getActive() {
    return db.prepare("SELECT * FROM project_queue WHERE status = 'active' LIMIT 1").get();
  },
  start(appName) {
    db.prepare("UPDATE project_queue SET status = 'active', started_at = CURRENT_TIMESTAMP WHERE app_name = ?").run(appName);
    return db.prepare('SELECT * FROM project_queue WHERE app_name = ?').get(appName);
  },
  complete(appName, deployUrl, githubRepo) {
    db.prepare(`UPDATE project_queue SET status = 'complete', completed_at = CURRENT_TIMESTAMP,
      deploy_url = COALESCE(?, deploy_url), github_repo = COALESCE(?, github_repo)
      WHERE app_name = ?`).run(deployUrl || null, githubRepo || null, appName);
    return db.prepare('SELECT * FROM project_queue WHERE app_name = ?').get(appName);
  },
  updateProgress(appName, phasesComplete, spentUsd) {
    db.prepare(`UPDATE project_queue SET phases_complete = ?, spent_usd = ? WHERE app_name = ?`)
      .run(phasesComplete, spentUsd, appName);
  },
  block(appName) {
    db.prepare("UPDATE project_queue SET status = 'blocked' WHERE app_name = ?").run(appName);
  },
  getCompletedSince(datetime) {
    return db.prepare("SELECT * FROM project_queue WHERE status = 'complete' AND completed_at >= ?").all(datetime);
  }
};
// ── FEATURE REQUESTS (Phase 8B) ─────────────────────────────────────────
const featureRequests = {
  add(description, priority) {
    const info = db.prepare('INSERT INTO feature_requests (description, priority) VALUES (?, ?)')
      .run(description, priority || 'medium');
    return { id: info.lastInsertRowid, description, priority: priority || 'medium', status: 'pending' };
  },
  getPending() {
    return db.prepare("SELECT * FROM feature_requests WHERE status = 'pending' ORDER BY CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 END, id ASC").all();
  },
  getAll() {
    return db.prepare('SELECT * FROM feature_requests ORDER BY id DESC').all();
  },
  resolve(id, status, notes) {
    db.prepare("UPDATE feature_requests SET status = ?, notes = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(status || 'done', notes || null, id);
    return db.prepare('SELECT * FROM feature_requests WHERE id = ?').get(id);
  }
};
// ── NATHAN INBOX (Phase 8B) ─────────────────────────────────────────────
const nathanInbox = {
  send(subject, body, priority) {
    const info = db.prepare('INSERT INTO nathan_inbox (subject, body, priority) VALUES (?, ?, ?)')
      .run(subject, body, priority || 'normal');
    return { id: info.lastInsertRowid, subject, priority: priority || 'normal' };
  },
  getUnread() {
    return db.prepare("SELECT * FROM nathan_inbox WHERE status = 'unread' ORDER BY CASE priority WHEN 'urgent' THEN 1 ELSE 2 END, id DESC").all();
  },
  getAll() {
    return db.prepare('SELECT * FROM nathan_inbox ORDER BY id DESC LIMIT 50').all();
  },
  markRead(id) {
    db.prepare("UPDATE nathan_inbox SET status = 'read' WHERE id = ?").run(id);
  },
  markActioned(id) {
    db.prepare("UPDATE nathan_inbox SET status = 'actioned' WHERE id = ?").run(id);
  }
};
// ── CLAUDE FILES (Anthropic Files API) ───────────────────────────────────
const claudeFiles = {
  add({ file_id, original_path, filename, purpose, mime_type, size_bytes }) {
    const info = db.prepare(
      'INSERT INTO claude_files (file_id, original_path, filename, purpose, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(file_id, original_path || null, filename || null, purpose || null, mime_type || null, size_bytes || 0);
    return { id: info.lastInsertRowid, file_id };
  },
  getAll() {
    return db.prepare('SELECT * FROM claude_files ORDER BY id DESC').all();
  },
  getByFileId(file_id) {
    return db.prepare('SELECT * FROM claude_files WHERE file_id = ?').get(file_id);
  },
  getRecent(limit) {
    return db.prepare('SELECT * FROM claude_files ORDER BY id DESC LIMIT ?').all(limit || 20);
  },
  delete(file_id) {
    db.prepare('DELETE FROM claude_files WHERE file_id = ?').run(file_id);
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
// ── NATIVE MEMORY (filesystem-style for Anthropic Memory Tool) ───────────
const nativeMem = {
  create(path, content) {
    try {
      db.prepare('INSERT INTO native_memories (path, content) VALUES (?, ?)').run(path, content);
      return { ok: true };
    } catch (err) {
      if (err.message.includes('UNIQUE')) return { ok: false, error: `File ${path} already exists` };
      throw err;
    }
  },
  get(path) {
    return db.prepare('SELECT content FROM native_memories WHERE path = ?').get(path);
  },
  update(path, content) {
    const info = db.prepare('UPDATE native_memories SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE path = ?').run(content, path);
    return info.changes > 0;
  },
  delete(path) {
    // Delete file or directory (recursive)
    const info = db.prepare('DELETE FROM native_memories WHERE path = ? OR path LIKE ?').run(path, path + '/%');
    return info.changes > 0;
  },
  rename(oldPath, newPath) {
    // Check if newPath exists
    const existing = db.prepare('SELECT path FROM native_memories WHERE path = ?').get(newPath);
    if (existing) return { ok: false, error: `The destination ${newPath} already exists` };

    db.transaction(() => {
      // Rename the file/dir itself
      db.prepare('UPDATE native_memories SET path = ? WHERE path = ?').run(newPath, oldPath);
      // Rename all children if it's a directory
      const children = db.prepare('SELECT path FROM native_memories WHERE path LIKE ?').all(oldPath + '/%');
      for (const child of children) {
        const updatedPath = child.path.replace(oldPath, newPath);
        db.prepare('UPDATE native_memories SET path = ? WHERE path = ?').run(updatedPath, child.path);
      }
    })();
    return { ok: true };
  },
  list(basePath) {
    return db.prepare('SELECT path, length(content) as size FROM native_memories WHERE path LIKE ?').all(basePath + '%');
  }
};

// ── BATCH JOBS (Anthropic Batch API) ────────────────────────────────────
const batchJobs = {
  add({ batch_id, custom_id, purpose }) {
    const info = db.prepare('INSERT INTO batch_jobs (batch_id, custom_id, purpose) VALUES (?, ?, ?)')
      .run(batch_id, custom_id || null, purpose || 'general');
    return info.lastInsertRowid;
  },
  getPending() {
    return db.prepare("SELECT * FROM batch_jobs WHERE status = 'processing'").all();
  },
  updateStatus(batch_id, status, result = null) {
    if (result) {
      db.prepare("UPDATE batch_jobs SET status = ?, result = ?, completed_at = CURRENT_TIMESTAMP WHERE batch_id = ?")
        .run(status, result, batch_id);
    } else {
      db.prepare("UPDATE batch_jobs SET status = ? WHERE batch_id = ?").run(status, batch_id);
    }
  },
  getByBatchId(batch_id) {
    return db.prepare("SELECT * FROM batch_jobs WHERE batch_id = ?").get(batch_id);
  }
};

// ── SCHEDULED POSTS ────────────────────────────────────────────────────
const scheduledPosts = {
  add(page, platform, message, scheduledFor, link, imageUrl) {
    return db.prepare(
      "INSERT INTO scheduled_posts (page, platform, message, scheduled_for, link, image_url) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(page, platform || "facebook", message, scheduledFor, link || null, imageUrl || null);
  },
  getDue() {
    return db.prepare(
      "SELECT * FROM scheduled_posts WHERE status = 'pending' AND scheduled_for <= datetime('now') ORDER BY scheduled_for ASC"
    ).all();
  },
  markPosted(id, postId) {
    db.prepare(
      "UPDATE scheduled_posts SET status = 'posted', post_id = ?, posted_at = datetime('now') WHERE id = ?"
    ).run(postId || null, id);
  },
  markFailed(id, error) {
    db.prepare(
      "UPDATE scheduled_posts SET status = 'failed' WHERE id = ?"
    ).run(id);
  },
  getAll(limit) {
    return db.prepare(
      "SELECT * FROM scheduled_posts ORDER BY scheduled_for DESC LIMIT ?"
    ).all(limit || 20);
  },
  cancel(id) {
    db.prepare(
      "UPDATE scheduled_posts SET status = 'cancelled' WHERE id = ? AND status = 'pending'"
    ).run(id);
  }
};

module.exports = { messages, scheduledPosts, tasks, mem, nativeMem, batchJobs, budget, lessons, projects, errorDB, projectQueue, featureRequests, nathanInbox, claudeFiles, testDB, resetDB, db };
