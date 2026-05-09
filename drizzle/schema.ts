import {
  boolean,
  decimal,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Conversations between the owner and Solomon.
 */
export const conversations = mysqlTable("conversations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  title: varchar("title", { length: 255 }).notNull().default("New conversation"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  userIdx: index("conv_user_idx").on(t.userId),
}));

/**
 * Individual chat messages, including assistant tool-call traces.
 */
export const messages = mysqlTable("messages", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull(),
  role: mysqlEnum("role", ["system", "user", "assistant", "tool"]).notNull(),
  content: text("content").notNull(),
  // For tool calls / structured payloads.
  toolName: varchar("toolName", { length: 128 }),
  toolPayload: json("toolPayload"),
  // Which model tier was used to produce this assistant message.
  modelTier: mysqlEnum("modelTier", ["fast", "smart"]),
  modelName: varchar("modelName", { length: 128 }),
  tokensIn: int("tokensIn").default(0),
  tokensOut: int("tokensOut").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  convIdx: index("msg_conv_idx").on(t.conversationId),
}));

/**
 * Long-term memory store. Used for brand voice, business context, decisions,
 * project state and performance data. Searched by tag + keyword scoring.
 */
export const memories = mysqlTable("memories", {
  id: int("id").autoincrement().primaryKey(),
  // Logical bucket: brand_voice, business_context, decision, project, performance, general
  category: mysqlEnum("category", [
    "brand_voice",
    "business_context",
    "decision",
    "project",
    "performance",
    "preference",
    "general",
  ]).notNull().default("general"),
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content").notNull(),
  // Comma-separated lowercase tags for keyword matching.
  tags: varchar("tags", { length: 500 }).default(""),
  // Optional structured metadata (e.g. {channel: "youtube", views: 12000}).
  metadata: json("metadata"),
  // Higher = more important. Used to bias retrieval ranking.
  importance: int("importance").default(5).notNull(),
  pinned: boolean("pinned").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => ({
  catIdx: index("mem_cat_idx").on(t.category),
}));

/**
 * Internal task / project management board.
 */
export const tasks = mysqlTable("tasks", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  status: mysqlEnum("status", ["active", "in_progress", "completed", "blocked"])
    .notNull().default("active"),
  priority: mysqlEnum("priority", ["low", "medium", "high", "urgent"])
    .notNull().default("medium"),
  project: varchar("project", { length: 128 }).default("general"),
  dueAt: timestamp("dueAt"),
  // If Solomon created or is responsible for the task autonomously.
  autonomous: boolean("autonomous").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  completedAt: timestamp("completedAt"),
}, (t) => ({
  statusIdx: index("tasks_status_idx").on(t.status),
}));

/**
 * Finance ledger — simple income / expense tracking.
 */
export const financeEntries = mysqlTable("finance_entries", {
  id: int("id").autoincrement().primaryKey(),
  type: mysqlEnum("type", ["income", "expense"]).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  category: varchar("category", { length: 128 }).notNull().default("general"),
  description: varchar("description", { length: 500 }).default(""),
  occurredAt: timestamp("occurredAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  typeIdx: index("fin_type_idx").on(t.type),
}));

/**
 * Settings (API keys, model routing, scheduler prefs). Single-row keyed table.
 */
export const settings = mysqlTable("settings", {
  key: varchar("key", { length: 128 }).primaryKey(),
  value: text("value").notNull(),
  category: varchar("category", { length: 64 }).default("general").notNull(),
  isSecret: boolean("isSecret").default(false).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * Scheduled autonomous jobs. Examples: morning_brief, content_calendar, email_check.
 */
export const scheduledJobs = mysqlTable("scheduled_jobs", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  kind: mysqlEnum("kind", [
    "morning_brief",
    "content_calendar",
    "email_check",
    "youtube_analytics",
    "social_post",
    "custom",
  ]).notNull(),
  cron: varchar("cron", { length: 64 }).notNull().default("0 6 * * *"),
  enabled: boolean("enabled").default(true).notNull(),
  payload: json("payload"),
  lastRunAt: timestamp("lastRunAt"),
  lastResult: text("lastResult"),
  nextRunAt: timestamp("nextRunAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/**
 * Audit log of every tool invocation Solomon performs.
 */
export const toolRuns = mysqlTable("tool_runs", {
  id: int("id").autoincrement().primaryKey(),
  toolName: varchar("toolName", { length: 128 }).notNull(),
  status: mysqlEnum("status", ["success", "error", "stub"]).notNull(),
  input: json("input"),
  output: json("output"),
  errorMessage: text("errorMessage"),
  durationMs: int("durationMs").default(0),
  triggeredBy: varchar("triggeredBy", { length: 64 }).default("user"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => ({
  toolIdx: index("tool_runs_tool_idx").on(t.toolName),
}));
