/**
 * Solomon tool registry.
 *
 * Each tool exposes:
 *   - an OpenAI-compatible schema (used in function calling)
 *   - an `execute(input, ctx)` handler that performs the action
 *
 * Where a real third-party API requires OAuth secrets we cannot ship by default
 * (Gmail, Drive, YouTube upload, Facebook/Instagram/TikTok), the tool runs as a
 * STUB: it logs a tool_run row with status="stub", returns a structured plan,
 * and surfaces a clear "needs API key" message instead of failing silently.
 *
 * This makes Solomon usable end-to-end today and trivially extensible: drop the
 * relevant key into Settings and replace the stub body with a real call.
 */
import type { Tool } from "../_core/llm";
import { getDb } from "../db";
import { tasks, financeEntries, toolRuns, settings } from "../../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import { upsertMemory, listMemories } from "./memory";

export type ToolContext = {
  triggeredBy?: "user" | "scheduler" | "system";
};

export type ToolResult = {
  ok: boolean;
  status: "success" | "error" | "stub";
  data?: unknown;
  message?: string;
};

export type ToolHandler = (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;

export type SolomonTool = {
  schema: Tool;
  execute: ToolHandler;
};

async function getSecret(key: string): Promise<string> {
  const db = await getDb();
  if (!db) return "";
  const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return row?.value ?? "";
}

function stub(message: string, hint?: string): ToolResult {
  return {
    ok: true,
    status: "stub",
    message,
    data: hint ? { needsConfiguration: hint } : undefined,
  };
}

// ─── 1. memory.search ──────────────────────────────────────────────────────────
const memorySearchTool: SolomonTool = {
  schema: {
    type: "function",
    function: {
      name: "memory_search",
      description:
        "Search Solomon's long-term memory (brand voice, business context, decisions, projects, performance). Returns the most relevant entries.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Topic, keyword, or question to search for." },
          limit: { type: "integer", description: "Max entries to return (default 6).", minimum: 1, maximum: 20 },
        },
        required: ["query"],
      },
    },
  },
  async execute(input) {
    const { searchMemories } = await import("./memory");
    const query = String(input.query ?? "");
    const limit = Number(input.limit ?? 6);
    const rows = await searchMemories(query, limit);
    return {
      ok: true,
      status: "success",
      data: rows.map((r) => ({
        id: r.id,
        category: r.category,
        title: r.title,
        tags: r.tags,
        importance: r.importance,
        pinned: r.pinned,
        content: r.content,
      })),
    };
  },
};

// ─── 2. memory.write ───────────────────────────────────────────────────────────
const memoryWriteTool: SolomonTool = {
  schema: {
    type: "function",
    function: {
      name: "memory_write",
      description:
        "Persist an important fact, decision, brand-voice note, or project update into Solomon's long-term memory.",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: ["brand_voice", "business_context", "decision", "project", "performance", "preference", "general"],
          },
          title: { type: "string" },
          content: { type: "string" },
          tags: { type: "string", description: "Comma-separated tags." },
          importance: { type: "integer", minimum: 1, maximum: 10 },
          pinned: { type: "boolean" },
        },
        required: ["category", "title", "content"],
      },
    },
  },
  async execute(input) {
    const row = await upsertMemory({
      category: input.category as never,
      title: String(input.title),
      content: String(input.content),
      tags: input.tags ? String(input.tags) : "",
      importance: input.importance ? Number(input.importance) : 5,
      pinned: Boolean(input.pinned),
    });
    return { ok: true, status: "success", data: row };
  },
};

// ─── 3. tasks.create ───────────────────────────────────────────────────────────
const taskCreateTool: SolomonTool = {
  schema: {
    type: "function",
    function: {
      name: "task_create",
      description:
        "Create a task on Solomon's internal project board. Use for any to-do item, follow-up, or autonomous job.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
          project: { type: "string" },
          dueAt: { type: "string", description: "ISO timestamp; optional." },
          autonomous: { type: "boolean", description: "True if Solomon will execute it autonomously." },
        },
        required: ["title"],
      },
    },
  },
  async execute(input) {
    const db = await getDb();
    if (!db) return { ok: false, status: "error", message: "Database not available" };
    const dueAt = input.dueAt ? new Date(String(input.dueAt)) : null;
    await db.insert(tasks).values({
      title: String(input.title),
      description: input.description ? String(input.description) : null,
      priority: (input.priority as never) ?? "medium",
      project: input.project ? String(input.project) : "general",
      dueAt: dueAt ?? undefined,
      autonomous: Boolean(input.autonomous),
    });
    const [row] = await db.select().from(tasks).orderBy(desc(tasks.id)).limit(1);
    return { ok: true, status: "success", data: row };
  },
};

// ─── 4. tasks.list ─────────────────────────────────────────────────────────────
const taskListTool: SolomonTool = {
  schema: {
    type: "function",
    function: {
      name: "task_list",
      description: "List tasks on Solomon's board, optionally filtered by status or project.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["active", "in_progress", "completed", "blocked"] },
          project: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 100 },
        },
      },
    },
  },
  async execute(input) {
    const db = await getDb();
    if (!db) return { ok: false, status: "error", message: "Database not available" };
    const limit = Number(input.limit ?? 25);
    let q = db.select().from(tasks).$dynamic();
    if (input.status) {
      q = q.where(eq(tasks.status, input.status as never));
    } else if (input.project) {
      q = q.where(eq(tasks.project, String(input.project)));
    }
    const rows = await q.orderBy(desc(tasks.createdAt)).limit(limit);
    return { ok: true, status: "success", data: rows };
  },
};

// ─── 5. finance.add ────────────────────────────────────────────────────────────
const financeAddTool: SolomonTool = {
  schema: {
    type: "function",
    function: {
      name: "finance_add",
      description: "Add an income or expense entry to the ledger.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["income", "expense"] },
          amount: { type: "number" },
          category: { type: "string" },
          description: { type: "string" },
          occurredAt: { type: "string", description: "ISO timestamp; optional." },
        },
        required: ["type", "amount"],
      },
    },
  },
  async execute(input) {
    const db = await getDb();
    if (!db) return { ok: false, status: "error", message: "Database not available" };
    const occurredAt = input.occurredAt ? new Date(String(input.occurredAt)) : new Date();
    await db.insert(financeEntries).values({
      type: input.type as never,
      amount: String(input.amount) as never,
      category: input.category ? String(input.category) : "general",
      description: input.description ? String(input.description) : "",
      occurredAt,
    });
    const [row] = await db.select().from(financeEntries).orderBy(desc(financeEntries.id)).limit(1);
    return { ok: true, status: "success", data: row };
  },
};

// ─── 6. finance.summary ────────────────────────────────────────────────────────
const financeSummaryTool: SolomonTool = {
  schema: {
    type: "function",
    function: {
      name: "finance_summary",
      description: "Return a balance summary: totals by type and by category.",
      parameters: { type: "object", properties: {} },
    },
  },
  async execute() {
    const db = await getDb();
    if (!db) return { ok: false, status: "error", message: "Database not available" };
    const rows = await db.select().from(financeEntries);
    let income = 0;
    let expense = 0;
    const byCategory: Record<string, number> = {};
    for (const r of rows) {
      const amount = Number(r.amount);
      if (r.type === "income") income += amount; else expense += amount;
      const sign = r.type === "income" ? 1 : -1;
      byCategory[r.category] = (byCategory[r.category] ?? 0) + sign * amount;
    }
    return {
      ok: true,
      status: "success",
      data: {
        income: income.toFixed(2),
        expense: expense.toFixed(2),
        balance: (income - expense).toFixed(2),
        byCategory,
        entries: rows.length,
      },
    };
  },
};

// ─── 7. web.research (uses fetch + simple HTML scrape) ─────────────────────────
const webResearchTool: SolomonTool = {
  schema: {
    type: "function",
    function: {
      name: "web_research",
      description:
        "Fetch a URL and return its readable text. Use for quick research, fact-checking, or pulling info Solomon does not already know.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Full https:// URL." },
          maxChars: { type: "integer", description: "Max characters to return (default 4000).", minimum: 200, maximum: 20000 },
        },
        required: ["url"],
      },
    },
  },
  async execute(input) {
    const url = String(input.url);
    const maxChars = Number(input.maxChars ?? 4000);
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, status: "error", message: "URL must start with http:// or https://" };
    }
    try {
      const r = await fetch(url, {
        headers: { "user-agent": "Mozilla/5.0 (Solomon Agent)" },
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      });
      const ct = r.headers.get("content-type") ?? "";
      const text = await r.text();
      let body = text;
      if (ct.includes("text/html") || /<html/i.test(text)) {
        body = text
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
      return {
        ok: true,
        status: "success",
        data: {
          url,
          contentType: ct,
          length: body.length,
          excerpt: body.slice(0, maxChars),
          truncated: body.length > maxChars,
        },
      };
    } catch (e) {
      return { ok: false, status: "error", message: `Fetch failed: ${(e as Error).message}` };
    }
  },
};

// ─── 8. ffmpeg.command (suggest, don't execute remotely) ───────────────────────
const ffmpegTool: SolomonTool = {
  schema: {
    type: "function",
    function: {
      name: "ffmpeg_command",
      description:
        "Generate a tested ffmpeg command for a video task (compress, trim, concat, watermark, normalize audio, convert format). Returns the command — Solomon does NOT auto-run shell on the host unless explicitly enabled.",
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "What you want done (e.g. 'compress a 4K mp4 to 1080p H.264 with good quality')." },
          input: { type: "string", description: "Path / filename of the source file." },
          output: { type: "string", description: "Desired output path / filename." },
        },
        required: ["task"],
      },
    },
  },
  async execute(input) {
    const task = String(input.task ?? "").toLowerCase();
    const inFile = String(input.input ?? "input.mp4");
    const outFile = String(input.output ?? "output.mp4");

    let cmd = "";
    if (/compress|reduce|smaller|1080p|h\.?264/.test(task)) {
      cmd = `ffmpeg -i "${inFile}" -vf "scale=-2:1080" -c:v libx264 -crf 22 -preset medium -c:a aac -b:a 160k "${outFile}"`;
    } else if (/trim|cut/.test(task)) {
      cmd = `ffmpeg -ss 00:00:00 -to 00:00:30 -i "${inFile}" -c copy "${outFile}"`;
    } else if (/concat|join/.test(task)) {
      cmd = `# create list.txt with: file 'a.mp4'\\nfile 'b.mp4'\\n then:\nffmpeg -f concat -safe 0 -i list.txt -c copy "${outFile}"`;
    } else if (/watermark|overlay/.test(task)) {
      cmd = `ffmpeg -i "${inFile}" -i logo.png -filter_complex "overlay=W-w-20:H-h-20" -c:a copy "${outFile}"`;
    } else if (/normaliz|loudnorm|audio/.test(task)) {
      cmd = `ffmpeg -i "${inFile}" -af loudnorm=I=-14:LRA=7:TP=-1 -c:v copy "${outFile}"`;
    } else if (/convert|format|mov|webm|gif/.test(task)) {
      cmd = `ffmpeg -i "${inFile}" "${outFile}"`;
    } else {
      cmd = `ffmpeg -i "${inFile}" -c:v libx264 -crf 23 -c:a aac -b:a 160k "${outFile}"`;
    }
    return {
      ok: true,
      status: "success",
      data: {
        command: cmd,
        note: "Run this on the host where the source file lives. Set settings.allow_local_shell=true to enable Solomon to execute it directly.",
      },
    };
  },
};

// ─── 9. file.read / file.list (sandbox-scoped placeholder) ─────────────────────
const fileListTool: SolomonTool = {
  schema: {
    type: "function",
    function: {
      name: "file_list",
      description:
        "List files in a working directory the operator has shared with Solomon (default: ./solomon-workspace). For safety this never escapes the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
      },
    },
  },
  async execute(input) {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const workspace = path.resolve(process.cwd(), "solomon-workspace");
    try {
      await fs.mkdir(workspace, { recursive: true });
    } catch {}
    const target = path.resolve(workspace, String(input.path ?? "."));
    if (!target.startsWith(workspace)) {
      return { ok: false, status: "error", message: "Path escapes workspace." };
    }
    try {
      const entries = await fs.readdir(target, { withFileTypes: true });
      return {
        ok: true,
        status: "success",
        data: entries.map((e) => ({ name: e.name, type: e.isDirectory() ? "dir" : "file" })),
      };
    } catch (e) {
      return { ok: false, status: "error", message: (e as Error).message };
    }
  },
};

// ─── 10. youtube.* (stubs — real OAuth required) ───────────────────────────────
const youtubeAnalyticsTool: SolomonTool = {
  schema: {
    type: "function",
    function: {
      name: "youtube_analytics",
      description:
        "Fetch recent YouTube channel analytics (views, subs, watch hours). Requires apikey.youtube to be set.",
      parameters: {
        type: "object",
        properties: {
          range: { type: "string", description: "e.g. 'last_7_days', 'last_30_days'" },
        },
      },
    },
  },
  async execute(input) {
    const key = await getSecret("apikey.youtube");
    if (!key) return stub("YouTube analytics tool ran in stub mode — no apikey.youtube configured.", "Add a YouTube Data API key in Settings.");
    // Real implementation would call:
    //   https://youtubeanalytics.googleapis.com/v2/reports?ids=channel%3D%3DMINE&...
    return {
      ok: true,
      status: "stub",
      data: {
        range: input.range ?? "last_7_days",
        note: "Stub — replace with googleapis 'youtubeAnalytics.reports.query' call once OAuth flow is set up.",
        sample: { views: 0, subscribersGained: 0, watchTimeMinutes: 0 },
      },
    };
  },
};

const youtubeUploadTool: SolomonTool = {
  schema: {
    type: "function",
    function: {
      name: "youtube_upload",
      description:
        "Upload (or schedule) a YouTube video. Requires apikey.youtube and a refresh token. Stubbed by default.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          publishAt: { type: "string", description: "ISO datetime to schedule, optional." },
          privacy: { type: "string", enum: ["public", "private", "unlisted"] },
        },
        required: ["filePath", "title"],
      },
    },
  },
  async execute(input) {
    const key = await getSecret("apikey.youtube");
    if (!key) return stub("YouTube upload ran in stub mode — would have uploaded.", "Add a YouTube Data API key + OAuth refresh token in Settings.");
    return { ok: true, status: "stub", data: { note: "Stub. Implement with googleapis 'youtube.videos.insert'.", echoed: input } };
  },
};

// ─── 11. gmail.* (stubs) ───────────────────────────────────────────────────────
const gmailReadTool: SolomonTool = {
  schema: {
    type: "function",
    function: {
      name: "gmail_inbox",
      description:
        "Read recent inbox messages. Requires apikey.gmail_oauth refresh token. Stubbed by default.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Gmail search query, e.g. 'is:unread newer_than:1d'" },
          maxResults: { type: "integer", minimum: 1, maximum: 50 },
        },
      },
    },
  },
  async execute() {
    const key = await getSecret("apikey.gmail_oauth");
    if (!key) return stub("Gmail read ran in stub mode.", "Add Gmail OAuth refresh token in Settings.");
    return { ok: true, status: "stub", data: { messages: [] } };
  },
};

const gmailSendTool: SolomonTool = {
  schema: {
    type: "function",
    function: {
      name: "gmail_send",
      description:
        "Send an email via Gmail. Requires apikey.gmail_oauth. Stubbed by default — Solomon will return the drafted email so the operator can review.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" },
        },
        required: ["to", "subject", "body"],
      },
    },
  },
  async execute(input) {
    const key = await getSecret("apikey.gmail_oauth");
    if (!key) return stub(`Gmail send ran in stub mode. Drafted email to ${input.to}.`, "Add Gmail OAuth refresh token in Settings.");
    return { ok: true, status: "stub", data: { drafted: input } };
  },
};

// ─── 12. drive.list / drive.upload (stubs) ─────────────────────────────────────
const driveListTool: SolomonTool = {
  schema: {
    type: "function",
    function: {
      name: "gdrive_list",
      description:
        "List files in Google Drive. Requires apikey.gdrive_oauth. Stubbed by default.",
      parameters: { type: "object", properties: { query: { type: "string" } } },
    },
  },
  async execute() {
    const key = await getSecret("apikey.gdrive_oauth");
    if (!key) return stub("Google Drive list ran in stub mode.", "Add Drive OAuth refresh token in Settings.");
    return { ok: true, status: "stub", data: { files: [] } };
  },
};

// ─── 13. social.post (stubs for FB / IG / TikTok) ──────────────────────────────
const socialPostTool: SolomonTool = {
  schema: {
    type: "function",
    function: {
      name: "social_post",
      description:
        "Post (or schedule) a piece of content to Facebook, Instagram or TikTok. Stubbed: Solomon will draft the post and return it for approval.",
      parameters: {
        type: "object",
        properties: {
          platform: { type: "string", enum: ["facebook", "instagram", "tiktok"] },
          caption: { type: "string" },
          mediaUrl: { type: "string" },
          scheduleAt: { type: "string", description: "ISO datetime, optional." },
        },
        required: ["platform", "caption"],
      },
    },
  },
  async execute(input) {
    const platform = String(input.platform);
    const key = await getSecret(`apikey.${platform}`);
    if (!key) {
      return stub(
        `${platform} post drafted (stub mode).`,
        `Add apikey.${platform} in Settings to enable real posting.`
      );
    }
    return { ok: true, status: "stub", data: { scheduledForReal: false, echoed: input } };
  },
};

// ─── Registry ──────────────────────────────────────────────────────────────────
export const SOLOMON_TOOLS: Record<string, SolomonTool> = {
  memory_search: memorySearchTool,
  memory_write: memoryWriteTool,
  task_create: taskCreateTool,
  task_list: taskListTool,
  finance_add: financeAddTool,
  finance_summary: financeSummaryTool,
  web_research: webResearchTool,
  ffmpeg_command: ffmpegTool,
  file_list: fileListTool,
  youtube_analytics: youtubeAnalyticsTool,
  youtube_upload: youtubeUploadTool,
  gmail_inbox: gmailReadTool,
  gmail_send: gmailSendTool,
  gdrive_list: driveListTool,
  social_post: socialPostTool,
};

export const SOLOMON_TOOL_SCHEMAS: Tool[] = Object.values(SOLOMON_TOOLS).map((t) => t.schema);

export async function runTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext = {}
): Promise<ToolResult> {
  const tool = SOLOMON_TOOLS[name];
  const started = Date.now();
  if (!tool) {
    await logToolRun(name, "error", input, null, "Unknown tool", 0, ctx);
    return { ok: false, status: "error", message: `Unknown tool: ${name}` };
  }
  try {
    const result = await tool.execute(input ?? {}, ctx);
    await logToolRun(name, result.status, input, result.data ?? null, result.message, Date.now() - started, ctx);
    return result;
  } catch (e) {
    const msg = (e as Error).message;
    await logToolRun(name, "error", input, null, msg, Date.now() - started, ctx);
    return { ok: false, status: "error", message: msg };
  }
}

async function logToolRun(
  name: string,
  status: "success" | "error" | "stub",
  input: unknown,
  output: unknown,
  errorMessage: string | undefined,
  durationMs: number,
  ctx: ToolContext
) {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(toolRuns).values({
      toolName: name,
      status,
      input: (input ?? null) as never,
      output: (output ?? null) as never,
      errorMessage: errorMessage ?? null,
      durationMs,
      triggeredBy: ctx.triggeredBy ?? "user",
    });
  } catch (e) {
    console.warn("[Solomon] failed to log tool run:", e);
  }
}

export async function recentToolRuns(limit = 25) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(toolRuns).orderBy(desc(toolRuns.id)).limit(limit);
}

// Pre-warm to avoid TS unused-import warnings on listMemories (used elsewhere).
export const _internal = { listMemories };
