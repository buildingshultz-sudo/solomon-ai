import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { getDb } from "./db";
import {
  conversations,
  messages,
  tasks,
  financeEntries,
  settings,
  toolRuns,
} from "../drizzle/schema";
import { runSolomon } from "./solomon/agent";
import { decideRoute } from "./solomon/router";
import { listMemories, upsertMemory, deleteMemory, searchMemories } from "./solomon/memory";
import { importManusFiles } from "./solomon/manusImport";
import { SOLOMON_TOOL_SCHEMAS, runTool, recentToolRuns } from "./solomon/tools";
import { listScheduledJobs, runJobNow, tickScheduler } from "./solomon/scheduler";
import { killAll, killHistory, listOperations } from "./solomon/killSwitch";
import { notifyOwner } from "./_core/notification";
import type { Message } from "./_core/llm";

const memoryCategoryEnum = z.enum([
  "brand_voice",
  "business_context",
  "decision",
  "project",
  "performance",
  "preference",
  "general",
]);

const taskStatusEnum = z.enum(["active", "in_progress", "completed", "blocked"]);
const taskPriorityEnum = z.enum(["low", "medium", "high", "urgent"]);
const finTypeEnum = z.enum(["income", "expense"]);

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ─── Solomon: chat ────────────────────────────────────────────────────────
  chat: router({
    listConversations: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(conversations)
        .where(eq(conversations.userId, ctx.user.id))
        .orderBy(desc(conversations.updatedAt));
    }),
    getMessages: protectedProcedure
      .input(z.object({ conversationId: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        return db
          .select()
          .from(messages)
          .where(eq(messages.conversationId, input.conversationId))
          .orderBy(messages.id);
      }),
    createConversation: protectedProcedure
      .input(z.object({ title: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB unavailable");
        await db.insert(conversations).values({
          userId: ctx.user.id,
          title: input.title || "New conversation",
        });
        const [row] = await db
          .select()
          .from(conversations)
          .where(eq(conversations.userId, ctx.user.id))
          .orderBy(desc(conversations.id))
          .limit(1);
        return row;
      }),
    deleteConversation: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB unavailable");
        await db.delete(messages).where(eq(messages.conversationId, input.id));
        await db.delete(conversations).where(eq(conversations.id, input.id));
        return { ok: true };
      }),
    send: protectedProcedure
      .input(
        z.object({
          conversationId: z.number().optional(),
          content: z.string().min(1),
          override: z.enum(["fast", "smart"]).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB unavailable");

        // Ensure conversation exists.
        let convId = input.conversationId;
        if (!convId) {
          await db.insert(conversations).values({
            userId: ctx.user.id,
            title: input.content.slice(0, 80),
          });
          const [row] = await db
            .select()
            .from(conversations)
            .where(eq(conversations.userId, ctx.user.id))
            .orderBy(desc(conversations.id))
            .limit(1);
          convId = row.id;
        }

        // Persist user message.
        await db.insert(messages).values({
          conversationId: convId,
          role: "user",
          content: input.content,
        });

        // Reconstruct the conversation history.
        const history = await db
          .select()
          .from(messages)
          .where(eq(messages.conversationId, convId))
          .orderBy(messages.id);
        const llmMessages: Message[] = history
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

        // Run Solomon.
        const { assistant, trace } = await runSolomon({
          conversation: llmMessages,
          override: input.override,
        });

        // Persist assistant message.
        await db.insert(messages).values({
          conversationId: convId,
          role: "assistant",
          content: assistant,
          modelTier: trace.tier,
          modelName: trace.modelName,
          toolPayload: trace as never,
        });

        return { conversationId: convId, assistant, trace };
      }),
    routeProbe: protectedProcedure
      .input(z.object({ message: z.string() }))
      .query(async ({ input }) => {
        const cfg = await loadRoutingCfg();
        return decideRoute({
          userMessage: input.message,
          hasTools: true,
          fastModel: cfg.fastModel,
          smartModel: cfg.smartModel,
          threshold: cfg.threshold,
        });
      }),
  }),

  // ─── Solomon: memory ──────────────────────────────────────────────────────
  memory: router({
    list: protectedProcedure
      .input(z.object({ category: memoryCategoryEnum.optional() }).optional())
      .query(async ({ input }) => listMemories(input?.category)),
    search: protectedProcedure
      .input(z.object({ query: z.string(), limit: z.number().min(1).max(20).optional() }))
      .query(({ input }) => searchMemories(input.query, input.limit ?? 6)),
    upsert: protectedProcedure
      .input(
        z.object({
          id: z.number().optional(),
          category: memoryCategoryEnum,
          title: z.string().min(1),
          content: z.string().min(1),
          tags: z.string().optional(),
          importance: z.number().min(1).max(10).optional(),
          pinned: z.boolean().optional(),
        })
      )
      .mutation(({ input }) => upsertMemory(input)),
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteMemory(input.id);
        return { ok: true };
      }),
  }),

  // ─── Solomon: tasks ───────────────────────────────────────────────────────
  tasks: router({
    list: protectedProcedure
      .input(z.object({ status: taskStatusEnum.optional() }).optional())
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        let q = db.select().from(tasks).$dynamic();
        if (input?.status) q = q.where(eq(tasks.status, input.status));
        return q.orderBy(desc(tasks.createdAt));
      }),
    create: protectedProcedure
      .input(
        z.object({
          title: z.string().min(1),
          description: z.string().optional(),
          priority: taskPriorityEnum.default("medium"),
          project: z.string().optional(),
          dueAt: z.date().optional(),
          autonomous: z.boolean().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB unavailable");
        await db.insert(tasks).values({
          title: input.title,
          description: input.description ?? null,
          priority: input.priority,
          project: input.project ?? "general",
          dueAt: input.dueAt ?? undefined,
          autonomous: input.autonomous ?? false,
        });
        const [row] = await db.select().from(tasks).orderBy(desc(tasks.id)).limit(1);
        return row;
      }),
    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          title: z.string().optional(),
          description: z.string().nullable().optional(),
          status: taskStatusEnum.optional(),
          priority: taskPriorityEnum.optional(),
          project: z.string().optional(),
          dueAt: z.date().nullable().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB unavailable");
        const patch: Record<string, unknown> = {};
        for (const k of ["title", "description", "status", "priority", "project"] as const) {
          if (input[k] !== undefined) patch[k] = input[k];
        }
        if (input.dueAt !== undefined) patch.dueAt = input.dueAt ?? null;
        if (input.status === "completed") patch.completedAt = new Date();
        await db.update(tasks).set(patch).where(eq(tasks.id, input.id));
        const [row] = await db.select().from(tasks).where(eq(tasks.id, input.id)).limit(1);
        return row;
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB unavailable");
        await db.delete(tasks).where(eq(tasks.id, input.id));
        return { ok: true };
      }),
  }),

  // ─── Solomon: finance ─────────────────────────────────────────────────────
  finance: router({
    list: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(financeEntries).orderBy(desc(financeEntries.occurredAt));
    }),
    summary: protectedProcedure.query(async () => {
      const r = await runTool("finance_summary", {}, { triggeredBy: "user" });
      return r.data ?? { income: "0", expense: "0", balance: "0", byCategory: {}, entries: 0 };
    }),
    add: protectedProcedure
      .input(
        z.object({
          type: finTypeEnum,
          amount: z.number(),
          category: z.string().optional(),
          description: z.string().optional(),
          occurredAt: z.date().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB unavailable");
        await db.insert(financeEntries).values({
          type: input.type,
          amount: String(input.amount) as never,
          category: input.category ?? "general",
          description: input.description ?? "",
          occurredAt: input.occurredAt ?? new Date(),
        });
        const [row] = await db.select().from(financeEntries).orderBy(desc(financeEntries.id)).limit(1);
        return row;
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB unavailable");
        await db.delete(financeEntries).where(eq(financeEntries.id, input.id));
        return { ok: true };
      }),
  }),

  // ─── Solomon: tools ───────────────────────────────────────────────────────
  tools: router({
    list: protectedProcedure.query(() => {
      return SOLOMON_TOOL_SCHEMAS.map((t) => ({
        name: t.function.name,
        description: t.function.description ?? "",
        parameters: t.function.parameters ?? {},
      }));
    }),
    run: protectedProcedure
      .input(z.object({ name: z.string(), input: z.record(z.string(), z.any()).optional() }))
      .mutation(async ({ input }) => runTool(input.name, input.input ?? {}, { triggeredBy: "user" })),
    recentRuns: protectedProcedure.query(() => recentToolRuns(50)),
  }),

  // ─── Solomon: Manus Import ─────────────────────────────────────
  manusImport: router({
    ingest: protectedProcedure
      .input(
        z.object({
          files: z
            .array(
              z.object({
                path: z.string(),
                name: z.string(),
                content: z.string(),
              })
            )
            .max(2000),
        })
      )
      .mutation(async ({ input }) => importManusFiles(input.files)),
  }),

  // ─── Solomon: settings ───────────────────────────────────────────────
  settings: router({
    list: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db.select().from(settings);
      // Mask secret values.
      return rows.map((r) => ({
        ...r,
        value: r.isSecret && r.value ? "•".repeat(Math.min(r.value.length, 12)) : r.value,
        hasValue: !!r.value,
      }));
    }),
    upsert: protectedProcedure
      .input(z.object({ key: z.string(), value: z.string(), category: z.string().optional(), isSecret: z.boolean().optional() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB unavailable");
        await db
          .insert(settings)
          .values({
            key: input.key,
            value: input.value,
            category: input.category ?? "general",
            isSecret: input.isSecret ?? false,
          })
          .onDuplicateKeyUpdate({
            set: {
              value: input.value,
              category: input.category ?? "general",
              isSecret: input.isSecret ?? false,
            },
          });
        return { ok: true };
      }),
  }),

  // ─── Solomon: scheduler ───────────────────────────────────────────────────
  scheduler: router({
    list: protectedProcedure.query(() => listScheduledJobs()),
    runNow: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(({ input }) => runJobNow(input.id)),
    tickNow: protectedProcedure.mutation(() => tickScheduler()),
    notifyTest: protectedProcedure.mutation(async () => {
      const ok = await notifyOwner({
        title: "Solomon test notification",
        content: "This is a test ping from the dashboard. If you see it, owner notifications work.",
      });
      return { ok };
    }),
  }),

  // ─── Solomon: tool runs (audit) ───────────────────────────────────────────
  toolRuns: router({
    list: protectedProcedure
      .input(z.object({ limit: z.number().min(1).max(200).optional() }).optional())
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        return db.select().from(toolRuns).orderBy(desc(toolRuns.id)).limit(input?.limit ?? 50);
      }),
  }),

  // ─── Task Master Kill Switch ─────────────────────────────────────────────
  // One-click stop for every running operation: LLM streams, tool calls,
  // scheduler ticks, imports. Used by the red kill button in the UI.
  killSwitch: router({
    status: protectedProcedure.query(() => ({
      running: listOperations(),
      history: killHistory(),
    })),
    killAll: protectedProcedure
      .input(z.object({ reason: z.string().max(200).optional() }).optional())
      .mutation(({ input }) => {
        const summary = killAll(input?.reason ?? "manual kill switch");
        return summary;
      }),
  }),
});

export type AppRouter = typeof appRouter;

async function loadRoutingCfg() {
  const db = await getDb();
  const fallback = { fastModel: "gpt-4o-mini", smartModel: "gpt-4o", threshold: 0.55 };
  if (!db) return fallback;
  const rows = await db.select().from(settings);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    fastModel: map.get("routing.fast_model") || fallback.fastModel,
    smartModel: map.get("routing.smart_model") || fallback.smartModel,
    threshold: Number(map.get("routing.complexity_threshold") || fallback.threshold),
  };
}
