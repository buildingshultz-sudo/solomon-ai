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
  CREATE TABLE IF NOT EXISTS jed_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task TEXT NOT NULL,
    category TEXT,
    priority TEXT CHECK(priority IN ('high','medium','low')),
    status TEXT CHECK(status IN ('open','done','cancelled')) DEFAULT 'open',
    date_added TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_done TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS jed_tasks_status_idx     ON jed_tasks (status);
  CREATE INDEX IF NOT EXISTS jed_tasks_priority_idx   ON jed_tasks (priority);
  CREATE INDEX IF NOT EXISTS jed_tasks_date_added_idx ON jed_tasks (date_added);
  -- T0-B Pattern Logger: learn from Jed's responses to dispatch suggestions.
  CREATE TABLE IF NOT EXISTS jed_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    dispatch_template TEXT,
    confidence_score REAL,
    jed_response TEXT CHECK(jed_response IN ('approved','rejected','modified')),
    modification_summary TEXT,
    raw_response_text TEXT
  );
  CREATE INDEX IF NOT EXISTS jed_patterns_template_idx ON jed_patterns (dispatch_template);
  CREATE INDEX IF NOT EXISTS jed_patterns_response_idx ON jed_patterns (jed_response);
  CREATE INDEX IF NOT EXISTS jed_patterns_ts_idx       ON jed_patterns (timestamp);
  -- T0-B per-template auto-tuned threshold override. Bounded [0.50, 0.95].
  CREATE TABLE IF NOT EXISTS dispatch_thresholds (
    template_id TEXT PRIMARY KEY,
    current_threshold REAL NOT NULL,
    last_adjusted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    sample_count INTEGER DEFAULT 0,
    approval_rate REAL DEFAULT NULL
  );
  -- T0-C post-purchase email drip sequence state.
  CREATE TABLE IF NOT EXISTS purchase_sequences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    buyer_email TEXT NOT NULL,
    buyer_name TEXT,
    product_slug TEXT NOT NULL,
    sale_amount REAL,
    sale_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    current_step INTEGER DEFAULT 0,
    next_send_date DATETIME,
    status TEXT CHECK(status IN ('active','complete','unsubscribed')) DEFAULT 'active'
  );
  CREATE INDEX IF NOT EXISTS purchase_seq_next_idx   ON purchase_sequences (next_send_date, status);
  CREATE INDEX IF NOT EXISTS purchase_seq_email_idx  ON purchase_sequences (buyer_email);
  -- T0-D debt snowball state (priority-ordered, lowest first).
  CREATE TABLE IF NOT EXISTS jed_debts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    original_balance REAL NOT NULL,
    current_balance REAL NOT NULL,
    priority_order INTEGER NOT NULL,
    paid_off_at DATETIME
  );
  CREATE INDEX IF NOT EXISTS jed_debts_order_idx ON jed_debts (priority_order);
  -- T0-E Local Community Intelligence raw search log (90-day TTL).
  CREATE TABLE IF NOT EXISTS local_intel_raw (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    query TEXT NOT NULL,
    results_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS local_intel_ts_idx ON local_intel_raw (timestamp);
  -- T0-F email triage draft store (when EMAIL_TRIAGE_AUTORESPOND=false).
  CREATE TABLE IF NOT EXISTS email_triage_drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    from_addr TEXT,
    subject TEXT,
    intent TEXT CHECK(intent IN ('ROUTINE','MEDIUM','HIGH')),
    template_id TEXT,
    draft_body TEXT,
    status TEXT CHECK(status IN ('pending','sent','skipped','escalated')) DEFAULT 'pending'
  );
  CREATE INDEX IF NOT EXISTS email_drafts_status_idx ON email_triage_drafts (status);
  -- Document registry: PDFs/MD/DOCX from D:\Solomon\reports\ on the PC,
  -- indexed weekly so search_documents can find them by filename + summary.
  CREATE TABLE IF NOT EXISTS solomon_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    filetype TEXT,
    size_bytes INTEGER,
    mtime TIMESTAMP,
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_indexed_at TIMESTAMP,
    summary TEXT,
    summary_model TEXT,
    content_hash TEXT,
    source TEXT DEFAULT 'D:\\Solomon\\reports\\'
  );
  CREATE INDEX IF NOT EXISTS idx_solomon_docs_filename ON solomon_documents(filename);
  CREATE INDEX IF NOT EXISTS idx_solomon_docs_mtime ON solomon_documents(mtime DESC);
`);
// ── jed_tasks SEED (idempotent: only inserts if table is empty) ────────────
// Initial open-task list captured from the Jed-action items that have been
// accumulating across sessions. Runs exactly once: count > 0 means a prior
// instance already seeded (or Jed added rows manually), and we leave it alone.
{
  const existing = db.prepare('SELECT COUNT(*) AS n FROM jed_tasks').get().n;
  if (existing === 0) {
    const ins = db.prepare('INSERT INTO jed_tasks (task, category, priority, status, date_done) VALUES (?, ?, ?, ?, ?)');
    const seed = [
      ['Call IRS 800-829-4933 for 147C letter for Mercury bank', 'finance',     'high',   'open',      null],
      ['Complete KDP Kindle manuscript re-upload',                'publishing',  'high',   'open',      null],
      ['Generate proper Facebook Page tokens for both pages via Graph Explorer and send /setfbtoken to Solomon', 'integration', 'high', 'open', null],
      ["Enable Gmail API at console.developers.google.com (msg 2227) then text Solomon 'gmail enabled'",         'integration', 'medium', 'open', null],
      ['Run YouTube OAuth reauth at 167.99.237.26:3000/oauth/start', 'integration', 'medium', 'open',   null],
      ['Run YouTube Playwright capture setup-yt-pw.ps1 in elevated PowerShell',                                  'integration', 'medium', 'open', null],
      ['Run Instagram Playwright capture setup-ig-pw.ps1 in elevated PowerShell (after Chrome auto-kill fix lands)', 'integration', 'medium', 'open', null],
      ['Sign up at kleintradesmanclub.com',                       'outreach',    'low',    'done',      new Date().toISOString()]
    ];
    const tx = db.transaction((rows) => { for (const r of rows) ins.run(...r); });
    tx(seed);
    console.log('[memory] seeded jed_tasks with ' + seed.length + ' initial rows (' + seed.filter(r => r[3] === 'open').length + ' open)');
  }
}
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

// ── jed_tasks MODULE — Jed-action items (the things only Jed can do) ──────
// Used by the morning brief, /tasks slash command, and the add_jed_task tool
// that dispatch templates with handler 'jed-escalate' can call to drop the
// thing into the queue automatically. Done-detection (bot.js) calls markDone
// after Claude fuzzy-matches Jed's reply ("done with the IRS call") to a row.
const PRIORITY_ORDER_SQL = "CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END";
const jedTasks = {
  add({ task, category, priority } = {}) {
    if (!task || typeof task !== 'string' || !task.trim()) throw new Error('jedTasks.add: task (non-empty string) is required');
    const pri = (priority === 'high' || priority === 'medium' || priority === 'low') ? priority : 'medium';
    const info = db.prepare('INSERT INTO jed_tasks (task, category, priority) VALUES (?, ?, ?)').run(task.trim(), category || null, pri);
    return db.prepare('SELECT * FROM jed_tasks WHERE id = ?').get(info.lastInsertRowid);
  },
  getById(id) {
    return db.prepare('SELECT * FROM jed_tasks WHERE id = ?').get(id);
  },
  getOpen() {
    return db.prepare(`SELECT * FROM jed_tasks WHERE status = 'open' ORDER BY ${PRIORITY_ORDER_SQL}, date_added ASC`).all();
  },
  getAll(limit = 100) {
    return db.prepare(`SELECT * FROM jed_tasks ORDER BY ${PRIORITY_ORDER_SQL}, date_added ASC LIMIT ?`).all(limit);
  },
  markDone(id) {
    db.prepare("UPDATE jed_tasks SET status = 'done', date_done = CURRENT_TIMESTAMP WHERE id = ? AND status = 'open'").run(id);
    return jedTasks.getById(id);
  },
  markCancelled(id) {
    db.prepare("UPDATE jed_tasks SET status = 'cancelled', date_done = CURRENT_TIMESTAMP WHERE id = ? AND status = 'open'").run(id);
    return jedTasks.getById(id);
  },
  // Format the open-task section for the morning brief. 0 open → "All tasks
  // done." 1-10 open → show all. >10 open → show top 5 + tail summary.
  forBrief() {
    const open = jedTasks.getOpen();
    if (open.length === 0) return '📋 All tasks done.';
    const tag = (p) => p === 'high' ? '[H]' : p === 'low' ? '[L]' : '[M]';
    const show = open.length > 10 ? open.slice(0, 5) : open;
    const lines = show.map(t => `${tag(t.priority)} ${t.task}`);
    if (open.length > 10) lines.push(`...and ${open.length - 5} more (/tasks for full)`);
    return `📋 OPEN TASKS (${open.length}):\n` + lines.join('\n');
  },
  // Format the full open list for the /tasks slash command, grouped by priority.
  forTasksCommand() {
    const open = jedTasks.getOpen();
    if (open.length === 0) return '📋 *All tasks done.*';
    const buckets = { high: [], medium: [], low: [] };
    for (const t of open) (buckets[t.priority] || buckets.medium).push(t);
    const out = [`📋 *${open.length} open task${open.length === 1 ? '' : 's'}*`];
    if (buckets.high.length)   { out.push(''); out.push('*HIGH*');   for (const t of buckets.high)   out.push(`#${t.id} · ${t.task}${t.category ? `  _(${t.category})_` : ''}`); }
    if (buckets.medium.length) { out.push(''); out.push('*MEDIUM*'); for (const t of buckets.medium) out.push(`#${t.id} · ${t.task}${t.category ? `  _(${t.category})_` : ''}`); }
    if (buckets.low.length)    { out.push(''); out.push('*LOW*');    for (const t of buckets.low)    out.push(`#${t.id} · ${t.task}${t.category ? `  _(${t.category})_` : ''}`); }
    return out.join('\n');
  }
};

// ── T0-B: jed_patterns + dispatch_thresholds modules ────────────────────────
const jedPatterns = {
  log({ dispatch_template, confidence_score, jed_response, modification_summary, raw_response_text }) {
    if (!['approved','rejected','modified'].includes(jed_response)) {
      throw new Error('jed_response must be approved|rejected|modified');
    }
    const info = db.prepare(`INSERT INTO jed_patterns (dispatch_template, confidence_score, jed_response, modification_summary, raw_response_text) VALUES (?, ?, ?, ?, ?)`)
      .run(dispatch_template || null, typeof confidence_score === 'number' ? confidence_score : null, jed_response, modification_summary || null, raw_response_text || null);
    return info.lastInsertRowid;
  },
  recent(limit = 50) {
    return db.prepare(`SELECT * FROM jed_patterns ORDER BY id DESC LIMIT ?`).all(limit);
  },
  // Approval rate per template over the last N days.
  approvalRateByTemplate(daysBack = 7) {
    return db.prepare(`
      SELECT dispatch_template,
             COUNT(*) AS n,
             SUM(CASE WHEN jed_response='approved' THEN 1 ELSE 0 END) AS approved,
             SUM(CASE WHEN jed_response='rejected' THEN 1 ELSE 0 END) AS rejected,
             SUM(CASE WHEN jed_response='modified' THEN 1 ELSE 0 END) AS modified
      FROM jed_patterns
      WHERE timestamp >= datetime('now','-' || ? || ' days')
        AND dispatch_template IS NOT NULL
      GROUP BY dispatch_template
    `).all(daysBack);
  }
};
const DISPATCH_THRESHOLD_MIN = 0.50;
const DISPATCH_THRESHOLD_MAX = 0.95;
const DISPATCH_THRESHOLD_DEFAULT = parseFloat(process.env.DISPATCH_EXECUTE_THRESHOLD || '0.85');
const dispatchThresholds = {
  get(template_id) {
    if (!template_id) return DISPATCH_THRESHOLD_DEFAULT;
    const row = db.prepare(`SELECT current_threshold FROM dispatch_thresholds WHERE template_id = ?`).get(template_id);
    return row ? row.current_threshold : DISPATCH_THRESHOLD_DEFAULT;
  },
  set(template_id, threshold, sampleCount, approvalRate) {
    const t = Math.max(DISPATCH_THRESHOLD_MIN, Math.min(DISPATCH_THRESHOLD_MAX, threshold));
    db.prepare(`INSERT INTO dispatch_thresholds (template_id, current_threshold, sample_count, approval_rate, last_adjusted_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(template_id) DO UPDATE SET current_threshold=excluded.current_threshold, sample_count=excluded.sample_count, approval_rate=excluded.approval_rate, last_adjusted_at=CURRENT_TIMESTAMP`)
      .run(template_id, t, sampleCount || 0, typeof approvalRate === 'number' ? approvalRate : null);
    return t;
  },
  all() { return db.prepare(`SELECT * FROM dispatch_thresholds ORDER BY template_id`).all(); },
  bounds: { min: DISPATCH_THRESHOLD_MIN, max: DISPATCH_THRESHOLD_MAX, default: DISPATCH_THRESHOLD_DEFAULT }
};

// ── T0-C: purchase_sequences module ─────────────────────────────────────────
const purchaseSequences = {
  enrol({ buyer_email, buyer_name, product_slug, sale_amount }) {
    if (!buyer_email || !product_slug) throw new Error('buyer_email + product_slug required');
    // Day 0 send is immediate (next_send_date = now).
    const info = db.prepare(`INSERT INTO purchase_sequences (buyer_email, buyer_name, product_slug, sale_amount, current_step, next_send_date, status)
      VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP, 'active')`)
      .run(buyer_email, buyer_name || null, product_slug, typeof sale_amount === 'number' ? sale_amount : null);
    return info.lastInsertRowid;
  },
  dueNow() {
    return db.prepare(`SELECT * FROM purchase_sequences WHERE status='active' AND next_send_date <= CURRENT_TIMESTAMP ORDER BY next_send_date ASC LIMIT 50`).all();
  },
  advance(id, daysUntilNext) {
    if (daysUntilNext == null) {
      db.prepare(`UPDATE purchase_sequences SET status='complete', current_step=current_step+1 WHERE id=?`).run(id);
    } else {
      db.prepare(`UPDATE purchase_sequences SET current_step=current_step+1, next_send_date=datetime('now','+' || ? || ' days') WHERE id=?`).run(daysUntilNext, id);
    }
  },
  unsubscribe(buyer_email) {
    db.prepare(`UPDATE purchase_sequences SET status='unsubscribed' WHERE buyer_email=? AND status='active'`).run(buyer_email);
  },
  byEmail(buyer_email, limit = 10) {
    return db.prepare(`SELECT * FROM purchase_sequences WHERE buyer_email=? ORDER BY id DESC LIMIT ?`).all(buyer_email, limit);
  }
};

// ── T0-D: jed_debts module ──────────────────────────────────────────────────
const jedDebts = {
  getAll() { return db.prepare(`SELECT * FROM jed_debts ORDER BY priority_order ASC`).all(); },
  getActive() { return db.prepare(`SELECT * FROM jed_debts WHERE current_balance > 0 ORDER BY priority_order ASC`).all(); },
  getCurrentTarget() { return db.prepare(`SELECT * FROM jed_debts WHERE current_balance > 0 ORDER BY priority_order ASC LIMIT 1`).get(); },
  applyPayment(id, amount) {
    const row = db.prepare(`SELECT * FROM jed_debts WHERE id=?`).get(id);
    if (!row) return null;
    const newBalance = Math.max(0, row.current_balance - amount);
    if (newBalance === 0 && row.current_balance > 0) {
      db.prepare(`UPDATE jed_debts SET current_balance=0, paid_off_at=CURRENT_TIMESTAMP WHERE id=?`).run(id);
    } else {
      db.prepare(`UPDATE jed_debts SET current_balance=? WHERE id=?`).run(newBalance, id);
    }
    return { ...row, current_balance: newBalance, paid_off: newBalance === 0 };
  }
};
// Seed jed_debts once (idempotent): the five known balances in snowball order.
{
  const n = db.prepare('SELECT COUNT(*) AS n FROM jed_debts').get().n;
  if (n === 0) {
    const ins = db.prepare(`INSERT INTO jed_debts (name, original_balance, current_balance, priority_order) VALUES (?, ?, ?, ?)`);
    const seed = [
      ['Comenity',         650,   650,   1],
      ['Citi',             900,   900,   2],
      ['Sheffield',        14372, 14372, 3],
      ['Discover',         17001, 17001, 4],
      ['Chase Suburban',   35341, 35341, 5]
    ];
    const tx = db.transaction(rows => rows.forEach(r => ins.run(...r)));
    tx(seed);
  }
}

// ── T0-E: local_intel_raw module ────────────────────────────────────────────
const localIntel = {
  saveRaw(query, results) {
    db.prepare(`INSERT INTO local_intel_raw (query, results_json) VALUES (?, ?)`).run(query, JSON.stringify(results));
  },
  pruneOlderThanDays(days = 90) {
    const info = db.prepare(`DELETE FROM local_intel_raw WHERE timestamp < datetime('now','-' || ? || ' days')`).run(days);
    return info.changes;
  },
  recent(limit = 25) { return db.prepare(`SELECT id, timestamp, query FROM local_intel_raw ORDER BY id DESC LIMIT ?`).all(limit); }
};

// ── T0-F: email_triage_drafts module ────────────────────────────────────────
const emailTriageDrafts = {
  save({ from_addr, subject, intent, template_id, draft_body }) {
    const info = db.prepare(`INSERT INTO email_triage_drafts (from_addr, subject, intent, template_id, draft_body) VALUES (?, ?, ?, ?, ?)`)
      .run(from_addr || null, subject || null, intent, template_id || null, draft_body || null);
    return info.lastInsertRowid;
  },
  markStatus(id, status) {
    if (!['pending','sent','skipped','escalated'].includes(status)) throw new Error('bad status');
    db.prepare(`UPDATE email_triage_drafts SET status=? WHERE id=?`).run(status, id);
  },
  pending() { return db.prepare(`SELECT * FROM email_triage_drafts WHERE status='pending' ORDER BY id DESC LIMIT 50`).all(); }
};

// ── solomon_documents module: registry lookups + upserts ────────────────────
const solomonDocuments = {
  // Case-insensitive LIKE search across filename + summary. Newest first.
  search(query, limit = 5) {
    const q = '%' + String(query || '').toLowerCase() + '%';
    return db.prepare(`
      SELECT id, filename, path, filetype, size_bytes, mtime, summary, last_indexed_at
      FROM solomon_documents
      WHERE LOWER(filename) LIKE ? OR LOWER(IFNULL(summary, '')) LIKE ?
      ORDER BY mtime DESC
      LIMIT ?
    `).all(q, q, Math.max(1, Math.min(50, limit | 0)));
  },
  getByPath(p) { return db.prepare(`SELECT * FROM solomon_documents WHERE path = ?`).get(p); },
  upsert({ filename, path, filetype, size_bytes, mtime, summary, summary_model, content_hash, source }) {
    const existing = db.prepare(`SELECT id, created_date FROM solomon_documents WHERE path = ?`).get(path);
    if (existing) {
      db.prepare(`UPDATE solomon_documents
        SET filename=?, filetype=?, size_bytes=?, mtime=?, summary=?, summary_model=?, content_hash=?, source=COALESCE(?, source), last_indexed_at=CURRENT_TIMESTAMP
        WHERE id=?`).run(filename, filetype, size_bytes, mtime, summary, summary_model, content_hash, source || null, existing.id);
      return { id: existing.id, action: 'updated' };
    }
    const info = db.prepare(`INSERT INTO solomon_documents
      (filename, path, filetype, size_bytes, mtime, summary, summary_model, content_hash, source, last_indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'D:\\Solomon\\reports\\'), CURRENT_TIMESTAMP)`)
      .run(filename, path, filetype, size_bytes, mtime, summary, summary_model, content_hash, source || null);
    return { id: info.lastInsertRowid, action: 'inserted' };
  },
  count() { return db.prepare(`SELECT COUNT(*) AS n FROM solomon_documents`).get().n; },
  all(limit = 100) { return db.prepare(`SELECT * FROM solomon_documents ORDER BY mtime DESC LIMIT ?`).all(limit); }
};

module.exports = { messages, scheduledPosts, tasks, mem, nativeMem, batchJobs, budget, lessons, projects, errorDB, projectQueue, featureRequests, nathanInbox, claudeFiles, testDB, resetDB, db, jedTasks, jedPatterns, dispatchThresholds, purchaseSequences, jedDebts, localIntel, emailTriageDrafts, solomonDocuments };
