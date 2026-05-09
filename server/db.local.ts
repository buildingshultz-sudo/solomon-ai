/**
 * Solomon Forge — local SQLite adapter.
 *
 * Goal: let the existing drizzle-mysql2 query code in routers/agent/memory
 * keep working unchanged when the app boots in desktop mode (SOLOMON_LOCAL=1),
 * by exposing the same handful of methods we use across the codebase
 * (`select`, `insert`, `update`, `delete`, `$dynamic`, where/orderBy/limit
 * chaining, plus `onDuplicateKeyUpdate`) backed by a single `data.db` file
 * via better-sqlite3.
 *
 * We don't need full drizzle parity — just the surface our routers actually
 * touch. All higher-level features (search ranking, importance scoring,
 * scheduler) are pure JS over the rows we return, so as long as we hand back
 * the right row shape, everything just works.
 */
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";

import {
  users,
  conversations,
  messages,
  memories,
  tasks,
  financeEntries,
  settings,
  scheduledJobs,
  toolRuns,
} from "../drizzle/schema";

// ─── Schema ──────────────────────────────────────────────────────────────────
//
// Only what we actually persist for the desktop build. JSON columns are stored
// as TEXT and parsed on read; timestamps as TEXT in ISO8601. Enums are plain
// TEXT with the same allowed values as the MySQL schema.
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  openId TEXT NOT NULL UNIQUE,
  name TEXT,
  email TEXT,
  loginMethod TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  lastSignedIn TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT 'New conversation',
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS conv_user_idx ON conversations(userId);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversationId INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  toolName TEXT,
  toolPayload TEXT,
  modelTier TEXT,
  modelName TEXT,
  tokensIn INTEGER DEFAULT 0,
  tokensOut INTEGER DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS msg_conv_idx ON messages(conversationId);

CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL DEFAULT 'general',
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT DEFAULT '',
  metadata TEXT,
  importance INTEGER NOT NULL DEFAULT 5,
  pinned INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS mem_cat_idx ON memories(category);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  priority TEXT NOT NULL DEFAULT 'medium',
  project TEXT DEFAULT 'general',
  dueAt TEXT,
  autonomous INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  completedAt TEXT
);
CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status);

CREATE TABLE IF NOT EXISTS finance_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  amount TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  description TEXT DEFAULT '',
  occurredAt TEXT NOT NULL DEFAULT (datetime('now')),
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS fin_type_idx ON finance_entries(type);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  isSecret INTEGER NOT NULL DEFAULT 0,
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  cron TEXT NOT NULL DEFAULT '0 6 * * *',
  enabled INTEGER NOT NULL DEFAULT 1,
  payload TEXT,
  lastRunAt TEXT,
  lastResult TEXT,
  nextRunAt TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tool_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  toolName TEXT NOT NULL,
  status TEXT NOT NULL,
  input TEXT,
  output TEXT,
  errorMessage TEXT,
  durationMs INTEGER DEFAULT 0,
  triggeredBy TEXT DEFAULT 'user',
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS tool_runs_tool_idx ON tool_runs(toolName);
`;

// JSON / boolean columns by table → so we can transparently parse on read and
// stringify on write. We only need to track the columns the app touches.
const JSON_COLS: Record<string, string[]> = {
  messages: ["toolPayload"],
  memories: ["metadata"],
  scheduled_jobs: ["payload"],
  tool_runs: ["input", "output"],
};
const BOOL_COLS: Record<string, string[]> = {
  memories: ["pinned"],
  tasks: ["autonomous"],
  scheduled_jobs: ["enabled"],
  settings: ["isSecret"],
};

// drizzle table object → SQLite physical name
function tableNameOf(t: any): string {
  if (!t) throw new Error("tableNameOf: null table");
  if (t === users) return "users";
  if (t === conversations) return "conversations";
  if (t === messages) return "messages";
  if (t === memories) return "memories";
  if (t === tasks) return "tasks";
  if (t === financeEntries) return "finance_entries";
  if (t === settings) return "settings";
  if (t === scheduledJobs) return "scheduled_jobs";
  if (t === toolRuns) return "tool_runs";
  // drizzle-mysql tables expose a Symbol-keyed name; fall back to that.
  const sym = Object.getOwnPropertySymbols(t).find((s) => String(s).includes("Name"));
  if (sym) return String((t as any)[sym]);
  throw new Error("tableNameOf: unknown drizzle table");
}

function colNameOf(col: any): string {
  if (!col) throw new Error("colNameOf: null column");
  if (typeof col === "string") return col;
  if (col.name) return col.name;
  // drizzle MySqlColumn exposes `.name` and `.columnType`
  const sym = Object.getOwnPropertySymbols(col).find((s) => String(s).includes("Name"));
  if (sym) return String((col as any)[sym]);
  throw new Error("colNameOf: unknown column shape");
}

function parseRow(table: string, row: any) {
  if (!row) return row;
  const out: any = { ...row };
  // JSON
  for (const col of JSON_COLS[table] ?? []) {
    if (out[col] !== undefined && out[col] !== null && typeof out[col] === "string") {
      try {
        out[col] = JSON.parse(out[col]);
      } catch {
        /* leave as-is */
      }
    }
  }
  // booleans
  for (const col of BOOL_COLS[table] ?? []) {
    if (out[col] !== undefined && out[col] !== null) {
      out[col] = !!Number(out[col]);
    }
  }
  // dates: convert TEXT → Date for known timestamp columns
  for (const k of Object.keys(out)) {
    if (
      (k === "createdAt" || k === "updatedAt" || k === "lastSignedIn" ||
        k === "occurredAt" || k === "dueAt" || k === "completedAt" ||
        k === "lastRunAt" || k === "nextRunAt") &&
      typeof out[k] === "string"
    ) {
      const d = new Date(out[k].includes("T") ? out[k] : out[k] + "Z");
      if (!isNaN(d.getTime())) out[k] = d;
    }
  }
  return out;
}

function serializeValues(table: string, values: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue;
    if ((JSON_COLS[table] ?? []).includes(k) && v !== null && typeof v !== "string") {
      out[k] = JSON.stringify(v);
    } else if ((BOOL_COLS[table] ?? []).includes(k)) {
      out[k] = v ? 1 : 0;
    } else if (v instanceof Date) {
      out[k] = v.toISOString();
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ─── Condition compiler ──────────────────────────────────────────────────────
//
// We accept the lightweight condition objects produced by drizzle helpers
// `eq(col, val)` and `desc(col)`. The route handlers in this repo only use
// `eq` for filtering and `desc` for ordering — that's all we have to handle.

type Cond = { kind: "eq"; col: string; val: any } | { kind: "and"; conds: Cond[] };

function decodeCondition(node: any): Cond | null {
  if (!node) return null;
  // drizzle SQL builder returns objects with a `queryChunks` array containing
  // column refs and inline params. We'll do something simpler: at the call
  // sites we use `eq(table.col, value)`, which produces an object with a
  // recognisable structure. We sniff the first column reference and the first
  // bound param.
  const queryChunks = node.queryChunks ?? node.chunks ?? [];
  let colName: string | null = null;
  let val: any = undefined;
  for (const chunk of queryChunks) {
    if (chunk && typeof chunk === "object") {
      if (chunk.name && colName === null) colName = chunk.name;
      if (chunk.value !== undefined && val === undefined) val = chunk.value;
      if (Array.isArray(chunk.queryChunks)) {
        // nested expression — recurse and pick first
        const inner = decodeCondition(chunk);
        if (inner && inner.kind === "eq") {
          colName = colName ?? inner.col;
          if (val === undefined) val = inner.val;
        }
      }
    }
  }
  if (colName !== null && val !== undefined) {
    return { kind: "eq", col: colName, val: val instanceof Date ? val.toISOString() : val };
  }
  return null;
}

function decodeOrder(node: any): { col: string; dir: "asc" | "desc" } | null {
  if (!node) return null;
  // drizzle desc()/asc() wrap a column with a direction tag.
  const queryChunks = node.queryChunks ?? node.chunks ?? [];
  let colName: string | null = null;
  let dir: "asc" | "desc" = "asc";
  const text = JSON.stringify(node).toLowerCase();
  if (text.includes("desc")) dir = "desc";
  for (const chunk of queryChunks) {
    if (chunk && typeof chunk === "object" && chunk.name) {
      colName = chunk.name;
      break;
    }
  }
  // Also support a direct column reference ordering ascending.
  if (!colName && node.name) colName = node.name;
  return colName ? { col: colName, dir } : null;
}

// ─── Query builders ──────────────────────────────────────────────────────────

class SelectBuilder {
  private _from: any;
  private _where: Cond[] = [];
  private _order: { col: string; dir: "asc" | "desc" }[] = [];
  private _limit: number | null = null;
  constructor(private db: Database.Database) {}
  from(table: any) { this._from = table; return this; }
  $dynamic() { return this; }
  where(cond: any) {
    const c = decodeCondition(cond);
    if (c) this._where.push(c);
    return this;
  }
  orderBy(...nodes: any[]) {
    for (const n of nodes) {
      const o = decodeOrder(n);
      if (o) this._order.push(o);
    }
    return this;
  }
  limit(n: number) { this._limit = n; return this; }
  // Make the builder thenable so `await db.select().from(...)` works.
  then(onFulfilled: any, onRejected?: any) {
    try {
      const rows = this._exec();
      return Promise.resolve(rows).then(onFulfilled, onRejected);
    } catch (e) {
      return Promise.reject(e).then(onFulfilled, onRejected);
    }
  }
  private _exec(): any[] {
    const table = tableNameOf(this._from);
    const params: any[] = [];
    let sql = `SELECT * FROM ${table}`;
    if (this._where.length) {
      sql += " WHERE " + this._where.map((c) => {
        params.push(c.val);
        return `${c.col} = ?`;
      }).join(" AND ");
    }
    if (this._order.length) {
      sql += " ORDER BY " + this._order.map((o) => `${o.col} ${o.dir.toUpperCase()}`).join(", ");
    }
    if (this._limit !== null) sql += ` LIMIT ${this._limit}`;
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => parseRow(table, r));
  }
}

class InsertBuilder {
  private _values: any | any[] | null = null;
  private _onDup: any | null = null;
  constructor(private db: Database.Database, private table: any) {}
  values(v: any | any[]) { this._values = v; return this; }
  onDuplicateKeyUpdate(opts: { set: Record<string, any> }) { this._onDup = opts.set; return this; }
  then(onFulfilled: any, onRejected?: any) {
    try { return Promise.resolve(this._exec()).then(onFulfilled, onRejected); }
    catch (e) { return Promise.reject(e).then(onFulfilled, onRejected); }
  }
  private _exec() {
    const tableName = tableNameOf(this.table);
    const rows = Array.isArray(this._values) ? this._values : [this._values];
    let lastInfo: any = null;
    for (const raw of rows) {
      const row = serializeValues(tableName, raw);
      const cols = Object.keys(row);
      const placeholders = cols.map(() => "?").join(",");
      const vals = cols.map((c) => row[c]);
      let sql: string;
      if (this._onDup && tableName === "settings") {
        // Common path: settings.upsert. Use SQLite's UPSERT.
        const update = serializeValues(tableName, this._onDup);
        const updateCols = Object.keys(update);
        sql = `INSERT INTO ${tableName} (${cols.join(",")}) VALUES (${placeholders}) ` +
              `ON CONFLICT(key) DO UPDATE SET ${updateCols.map((c) => `${c}=excluded.${c}`).join(",")}`;
      } else if (this._onDup && tableName === "users") {
        const update = serializeValues(tableName, this._onDup);
        const updateCols = Object.keys(update);
        sql = `INSERT INTO ${tableName} (${cols.join(",")}) VALUES (${placeholders}) ` +
              `ON CONFLICT(openId) DO UPDATE SET ${updateCols.map((c) => `${c}=excluded.${c}`).join(",")}`;
      } else {
        sql = `INSERT INTO ${tableName} (${cols.join(",")}) VALUES (${placeholders})`;
      }
      lastInfo = this.db.prepare(sql).run(...vals);
    }
    return lastInfo;
  }
}

class UpdateBuilder {
  private _set: Record<string, any> = {};
  private _where: Cond[] = [];
  constructor(private db: Database.Database, private table: any) {}
  set(values: Record<string, any>) { this._set = values; return this; }
  where(cond: any) {
    const c = decodeCondition(cond);
    if (c) this._where.push(c);
    return this;
  }
  then(onFulfilled: any, onRejected?: any) {
    try { return Promise.resolve(this._exec()).then(onFulfilled, onRejected); }
    catch (e) { return Promise.reject(e).then(onFulfilled, onRejected); }
  }
  private _exec() {
    const tableName = tableNameOf(this.table);
    const set = serializeValues(tableName, this._set);
    const cols = Object.keys(set);
    if (cols.length === 0) return { changes: 0 };
    const params: any[] = cols.map((c) => set[c]);
    let sql = `UPDATE ${tableName} SET ${cols.map((c) => `${c}=?`).join(",")}`;
    if (this._where.length) {
      sql += " WHERE " + this._where.map((c) => { params.push(c.val); return `${c.col} = ?`; }).join(" AND ");
    }
    return this.db.prepare(sql).run(...params);
  }
}

class DeleteBuilder {
  private _where: Cond[] = [];
  constructor(private db: Database.Database, private table: any) {}
  where(cond: any) {
    const c = decodeCondition(cond);
    if (c) this._where.push(c);
    return this;
  }
  then(onFulfilled: any, onRejected?: any) {
    try { return Promise.resolve(this._exec()).then(onFulfilled, onRejected); }
    catch (e) { return Promise.reject(e).then(onFulfilled, onRejected); }
  }
  private _exec() {
    const tableName = tableNameOf(this.table);
    const params: any[] = [];
    let sql = `DELETE FROM ${tableName}`;
    if (this._where.length) {
      sql += " WHERE " + this._where.map((c) => { params.push(c.val); return `${c.col} = ?`; }).join(" AND ");
    }
    return this.db.prepare(sql).run(...params);
  }
}

// ─── Public driver ───────────────────────────────────────────────────────────

let _db: Database.Database | null = null;
let _shim: any = null;

export function openLocalDb(): { db: Database.Database; drizzleShim: any } {
  if (_db && _shim) return { db: _db, drizzleShim: _shim };

  const dataDir = process.env.SOLOMON_DATA_DIR || path.join(process.cwd(), ".solomon-data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "data.db");

  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  _db.exec(SCHEMA_SQL);

  // Seed local owner user once so the auth bypass has someone to log in as.
  const existing = _db.prepare("SELECT id FROM users WHERE openId = ?").get("local-owner") as
    | { id: number }
    | undefined;
  if (!existing) {
    _db.prepare(
      `INSERT INTO users (openId, name, email, role) VALUES (?,?,?,?)`
    ).run("local-owner", "Owner", "owner@solomon.local", "admin");
  }

  const sqlite = _db;
  _shim = {
    select: () => new SelectBuilder(sqlite),
    insert: (table: any) => new InsertBuilder(sqlite, table),
    update: (table: any) => new UpdateBuilder(sqlite, table),
    delete: (table: any) => new DeleteBuilder(sqlite, table),
  };
  return { db: _db, drizzleShim: _shim };
}

export function closeLocalDb() {
  if (_db) {
    try { _db.close(); } catch { /* ignore */ }
    _db = null;
    _shim = null;
  }
}
