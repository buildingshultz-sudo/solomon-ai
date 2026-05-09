/**
 * Solomon's Forge — local SQLite adapter (sql.js edition).
 *
 * Why sql.js? It is a pure-JavaScript / WebAssembly port of SQLite that
 * requires *zero* native compilation. The previous adapter used
 * better-sqlite3, which depends on node-gyp + Python distutils + Visual
 * Studio Build Tools on Windows and routinely fails to install for end
 * users. sql.js works anywhere Node 18+ runs.
 *
 * Trade-off: sql.js is in-memory by default, so we explicitly persist the
 * database file to disk on every mutation (debounced) and on process exit.
 *
 * The shim surface (select / insert / update / delete with eq/desc + onDup)
 * is identical to the original adapter so all higher-level routers,
 * scheduler, memory and tools code keeps working unchanged.
 */
import path from "node:path";
import fs from "node:fs";
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);

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
  const sym = Object.getOwnPropertySymbols(t).find((s) => String(s).includes("Name"));
  if (sym) return String((t as any)[sym]);
  throw new Error("tableNameOf: unknown drizzle table");
}

function parseRow(table: string, row: any) {
  if (!row) return row;
  const out: any = { ...row };
  for (const col of JSON_COLS[table] ?? []) {
    if (out[col] !== undefined && out[col] !== null && typeof out[col] === "string") {
      try {
        out[col] = JSON.parse(out[col]);
      } catch {
        /* leave as-is */
      }
    }
  }
  for (const col of BOOL_COLS[table] ?? []) {
    if (out[col] !== undefined && out[col] !== null) {
      out[col] = !!Number(out[col]);
    }
  }
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

// ─── sql.js wrapper that mimics the better-sqlite3 surface we use ────────────
//
// We keep a tiny subset: prepare(sql).all(...params), prepare(sql).run(...params),
// prepare(sql).get(...params), exec(sql), pragma(name = value | name).
class SqlJsWrapper {
  constructor(private sqlite: SqlJsDatabase, private onMutate: () => void) {}

  pragma(stmt: string): any {
    // sql.js supports pragmas via run/exec. Returning [] keeps callers happy.
    this.sqlite.run(`PRAGMA ${stmt}`);
    return [];
  }

  exec(sql: string): void {
    this.sqlite.run(sql);
    this.onMutate();
  }

  prepare(sql: string) {
    const trimmed = sql.trim().toLowerCase();
    const isWrite =
      trimmed.startsWith("insert") ||
      trimmed.startsWith("update") ||
      trimmed.startsWith("delete") ||
      trimmed.startsWith("create") ||
      trimmed.startsWith("drop") ||
      trimmed.startsWith("alter") ||
      trimmed.startsWith("replace");
    const self = this;
    return {
      all(...params: any[]): any[] {
        const stmt = self.sqlite.prepare(sql);
        try {
          stmt.bind(params);
          const rows: any[] = [];
          while (stmt.step()) {
            rows.push(stmt.getAsObject());
          }
          return rows;
        } finally {
          stmt.free();
        }
      },
      get(...params: any[]): any {
        const stmt = self.sqlite.prepare(sql);
        try {
          stmt.bind(params);
          if (stmt.step()) {
            return stmt.getAsObject();
          }
          return undefined;
        } finally {
          stmt.free();
        }
      },
      run(...params: any[]): { changes: number; lastInsertRowid: number } {
        self.sqlite.run(sql, params as any);
        const changes = (self.sqlite as any).getRowsModified
          ? (self.sqlite as any).getRowsModified()
          : 0;
        // last_insert_rowid via a quick query
        let lastInsertRowid = 0;
        try {
          const r = self.sqlite.exec("SELECT last_insert_rowid() AS id");
          if (r[0]?.values?.[0]?.[0] != null) {
            lastInsertRowid = Number(r[0].values[0][0]);
          }
        } catch {
          /* ignore */
        }
        if (isWrite) self.onMutate();
        return { changes, lastInsertRowid };
      },
    };
  }

  close() {
    this.sqlite.close();
  }
}

// ─── Condition compiler ──────────────────────────────────────────────────────
type Cond = { kind: "eq"; col: string; val: any } | { kind: "and"; conds: Cond[] };

function decodeCondition(node: any): Cond | null {
  if (!node) return null;
  const queryChunks = node.queryChunks ?? node.chunks ?? [];
  let colName: string | null = null;
  let val: any = undefined;
  for (const chunk of queryChunks) {
    if (chunk && typeof chunk === "object") {
      if (chunk.name && colName === null) colName = chunk.name;
      if (chunk.value !== undefined && val === undefined) val = chunk.value;
      if (Array.isArray(chunk.queryChunks)) {
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
  if (!colName && node.name) colName = node.name;
  return colName ? { col: colName, dir } : null;
}

// ─── Query builders ──────────────────────────────────────────────────────────

class SelectBuilder {
  private _from: any;
  private _where: Cond[] = [];
  private _order: { col: string; dir: "asc" | "desc" }[] = [];
  private _limit: number | null = null;
  constructor(private db: SqlJsWrapper) {}
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
  constructor(private db: SqlJsWrapper, private table: any) {}
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
  constructor(private db: SqlJsWrapper, private table: any) {}
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
  constructor(private db: SqlJsWrapper, private table: any) {}
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

let _wrapper: SqlJsWrapper | null = null;
let _shim: any = null;
let _dbPath: string = "";
let _dirty = false;
let _flushTimer: NodeJS.Timeout | null = null;
let _exitHooked = false;

function scheduleFlush() {
  _dirty = true;
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    flushNow();
  }, 1000); // debounce: 1 second after last write
}

function flushNow() {
  if (!_wrapper || !_dirty || !_dbPath) return;
  try {
    const data = (_wrapper as any).sqlite.export() as Uint8Array;
    // Atomic write: write to a temp file then rename.
    const tmp = _dbPath + ".tmp";
    fs.writeFileSync(tmp, Buffer.from(data));
    fs.renameSync(tmp, _dbPath);
    _dirty = false;
  } catch (e) {
    console.error("[db.local] flush failed:", e);
  }
}

function hookExit() {
  if (_exitHooked) return;
  _exitHooked = true;
  const handler = () => {
    try {
      if (_flushTimer) clearTimeout(_flushTimer);
      _flushTimer = null;
      flushNow();
    } catch {
      /* ignore */
    }
  };
  process.on("exit", handler);
  process.on("SIGINT", () => { handler(); process.exit(0); });
  process.on("SIGTERM", () => { handler(); process.exit(0); });
  process.on("beforeExit", handler);
}

export async function openLocalDb(): Promise<{ db: SqlJsWrapper; drizzleShim: any }> {
  if (_wrapper && _shim) return { db: _wrapper, drizzleShim: _shim };

  const dataDir = process.env.SOLOMON_DATA_DIR || path.join(process.cwd(), ".solomon-data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  _dbPath = path.join(dataDir, "data.db");

  // Initialise sql.js. The `locateFile` callback tells the loader where to
  // find the wasm binary that ships with the package.
  const SQL = await initSqlJs({
    locateFile: (file: string) => {
      // Resolve relative to the installed sql.js package so this works whether
      // we're running from source (tsx) or from the bundled dist/index.js.
      try {
        return _require.resolve(`sql.js/dist/${file}`);
      } catch {
        return file;
      }
    },
  } as any);

  // Load existing file from disk if present.
  let sqlite: SqlJsDatabase;
  if (fs.existsSync(_dbPath)) {
    try {
      const buf = fs.readFileSync(_dbPath);
      sqlite = new SQL.Database(new Uint8Array(buf));
    } catch (e) {
      console.warn("[db.local] failed to load existing db, starting fresh:", e);
      sqlite = new SQL.Database();
    }
  } else {
    sqlite = new SQL.Database();
  }

  _wrapper = new SqlJsWrapper(sqlite, scheduleFlush);
  // Note: WAL is irrelevant for sql.js (in-memory), but foreign_keys still applies.
  _wrapper.pragma("foreign_keys = ON");
  _wrapper.exec(SCHEMA_SQL);

  // Seed local owner user once so the auth bypass has someone to log in as.
  const existing = _wrapper.prepare("SELECT id FROM users WHERE openId = ?").get("local-owner") as
    | { id: number }
    | undefined;
  if (!existing) {
    _wrapper.prepare(
      `INSERT INTO users (openId, name, email, role) VALUES (?,?,?,?)`
    ).run("local-owner", "Owner", "owner@solomon.local", "admin");
  }

  // Persist immediately so the file exists even if no writes happen later.
  flushNow();
  hookExit();

  const wrap = _wrapper;
  _shim = {
    select: () => new SelectBuilder(wrap),
    insert: (table: any) => new InsertBuilder(wrap, table),
    update: (table: any) => new UpdateBuilder(wrap, table),
    delete: (table: any) => new DeleteBuilder(wrap, table),
  };
  return { db: _wrapper, drizzleShim: _shim };
}

export function closeLocalDb() {
  try { flushNow(); } catch { /* ignore */ }
  if (_wrapper) {
    try { _wrapper.close(); } catch { /* ignore */ }
    _wrapper = null;
    _shim = null;
  }
}
