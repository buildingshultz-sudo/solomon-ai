/**
 * Solomon long-term memory layer.
 *
 * The memories table stores brand voice, business context, decisions,
 * project state and performance data. We retrieve relevant entries with a
 * lightweight keyword scoring function (no external vector DB required).
 *
 * Scoring:
 *   score = importance bonus
 *         + 1.0 * (# query tokens that appear in title)
 *         + 0.5 * (# query tokens that appear in tags)
 *         + 0.25 * (# query tokens that appear in content, capped at 6)
 *         + pinned bonus
 */
import { desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { memories } from "../../drizzle/schema";

export type MemoryRow = typeof memories.$inferSelect;

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "is", "are", "was", "were",
  "to", "of", "in", "on", "at", "for", "with", "by", "as", "be", "this", "that",
  "it", "its", "i", "me", "my", "you", "your", "we", "our", "us", "do", "does",
  "did", "have", "has", "had", "will", "would", "should", "could", "can",
  "should", "what", "when", "where", "why", "how",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export function scoreMemory(row: MemoryRow, queryTokens: string[]): number {
  if (queryTokens.length === 0) {
    return (row.importance ?? 0) + (row.pinned ? 5 : 0);
  }

  const titleTokens = tokenize(row.title);
  const tagTokens = (row.tags ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const contentTokens = tokenize(row.content);

  const titleSet = new Set(titleTokens);
  const tagSet = new Set(tagTokens);
  const contentSet = new Set(contentTokens);

  let score = 0;
  let contentMatches = 0;
  for (const tok of queryTokens) {
    if (titleSet.has(tok)) score += 1.0;
    if (tagSet.has(tok)) score += 0.5;
    if (contentSet.has(tok) && contentMatches < 6) {
      score += 0.25;
      contentMatches++;
    }
  }

  score += (row.importance ?? 5) * 0.1;
  if (row.pinned) score += 0.75;

  return score;
}

export async function searchMemories(query: string, limit = 6): Promise<MemoryRow[]> {
  const db = await getDb();
  if (!db) return [];

  const tokens = tokenize(query);
  const all = await db.select().from(memories).limit(500);

  if (tokens.length === 0) {
    // No tokens — fall back to pinned + most-important rows.
    return all
      .sort((a, b) => {
        const ap = a.pinned ? 1 : 0;
        const bp = b.pinned ? 1 : 0;
        if (ap !== bp) return bp - ap;
        return (b.importance ?? 0) - (a.importance ?? 0);
      })
      .slice(0, limit);
  }

  const ranked = all
    .map((m) => ({ row: m, score: scoreMemory(m, tokens) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.row);

  return ranked;
}

export function buildMemoryContext(rows: MemoryRow[]): string {
  if (rows.length === 0) return "";
  const lines = rows.map((r) => {
    const tags = r.tags ? ` [${r.tags}]` : "";
    return `### ${r.category} — ${r.title}${tags}\n${r.content}`;
  });
  return [
    "## Solomon long-term memory (most relevant entries)",
    ...lines,
  ].join("\n\n");
}

export async function listMemories(category?: string): Promise<MemoryRow[]> {
  const db = await getDb();
  if (!db) return [];
  if (category) {
    return await db
      .select()
      .from(memories)
      .where(eq(memories.category, category as MemoryRow["category"]))
      .orderBy(desc(memories.updatedAt));
  }
  return await db.select().from(memories).orderBy(desc(memories.updatedAt));
}

export async function upsertMemory(input: {
  id?: number;
  category: MemoryRow["category"];
  title: string;
  content: string;
  tags?: string;
  importance?: number;
  pinned?: boolean;
  metadata?: unknown;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const tags = input.tags ?? "";
  const importance = input.importance ?? 5;
  const pinned = input.pinned ?? false;
  const metadata = (input.metadata ?? null) as MemoryRow["metadata"];

  if (input.id) {
    await db
      .update(memories)
      .set({
        category: input.category,
        title: input.title,
        content: input.content,
        tags,
        importance,
        pinned,
        metadata,
      })
      .where(eq(memories.id, input.id));
    const [row] = await db.select().from(memories).where(eq(memories.id, input.id)).limit(1);
    return row;
  }

  await db.insert(memories).values({
    category: input.category,
    title: input.title,
    content: input.content,
    tags,
    importance,
    pinned,
    metadata,
  });

  // Return latest row for this title (no insertId in this driver wrapper).
  const all = await db.select().from(memories).orderBy(desc(memories.id)).limit(1);
  return all[0];
}

export async function deleteMemory(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(memories).where(eq(memories.id, id));
}
