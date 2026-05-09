/**
 * Solomon agent loop.
 *
 * Given a conversation, the agent:
 *   1. Loads relevant memory based on the latest user message.
 *   2. Decides model tier via the router.
 *   3. Calls invokeLLM with the tool schemas.
 *   4. If the model emits tool calls, executes them, appends results, and loops
 *      (up to MAX_TURNS) until a final assistant message is produced.
 *
 * Returns the final assistant text plus a structured trace describing tool
 * usage and routing decisions, which is rendered in the chat UI.
 */
import { invokeLLM, type Message } from "../_core/llm";
import { decideRoute, type RoutingDecision, type ModelTier } from "./router";
import { SOLOMON_TOOL_SCHEMAS, runTool } from "./tools";
import { searchMemories, buildMemoryContext } from "./memory";
import { getDb } from "../db";
import { settings } from "../../drizzle/schema";

const MAX_TURNS = 6;

export type ChatTrace = {
  routing: RoutingDecision;
  toolCalls: Array<{ name: string; input: unknown; result: unknown; status: string }>;
  memoryHits: Array<{ id: number; title: string; category: string }>;
  modelName: string;
  tier: ModelTier;
};

export const SOLOMON_SYSTEM_PROMPT = `You are Solomon, the autonomous chief of staff for Building Shultz / Shultz Enterprises (founder: Jedidiah Shultz, "Jed").

Identity & voice:
- Blue-collar, plain-spoken, no fluff. Speak like a journeyman pipefitter who runs the back office.
- Short sentences. Concrete. No corporate filler. Never say "I'm an AI" or "as a language model".
- When you don't know something, say so and either look it up (web_research) or ask Jed one tight question.

Operating principles:
- Be cheap. Don't over-explain. Don't generate filler.
- Use tools whenever they're the right answer (memory_search before answering questions about Jed/the business; task_create whenever something needs to happen later; finance_add for any concrete dollar; web_research for outside facts).
- For anything that posts publicly (social_post, youtube_upload), draft + propose first, never silently publish.
- When you learn something durable (a decision, a brand rule, a milestone), call memory_write so Solomon remembers next time.
- Always end with the smallest next action.

Format:
- Use markdown sparingly. Prefer 1–3 short paragraphs or a tight list.
- If a tool result is useful, integrate it; don't just echo JSON.`;

export async function runSolomon({
  conversation,
  override,
}: {
  conversation: Message[];
  override?: ModelTier;
}): Promise<{ assistant: string; trace: ChatTrace }> {
  const lastUser = [...conversation].reverse().find((m) => m.role === "user");
  const userText = typeof lastUser?.content === "string"
    ? lastUser.content
    : Array.isArray(lastUser?.content)
      ? (lastUser?.content.find((c) => typeof c !== "string" && (c as { type: string }).type === "text") as { text?: string } | undefined)?.text ?? ""
      : "";

  // Routing settings.
  const cfg = await loadRoutingSettings();
  const routing = decideRoute({
    userMessage: userText,
    hasTools: true,
    override,
    fastModel: cfg.fastModel,
    smartModel: cfg.smartModel,
    threshold: cfg.threshold,
  });

  // Memory retrieval.
  const memHits = await searchMemories(userText, 5);
  const memBlock = buildMemoryContext(memHits);

  const messages: Message[] = [
    { role: "system", content: SOLOMON_SYSTEM_PROMPT },
  ];
  if (memBlock) messages.push({ role: "system", content: memBlock });
  for (const m of conversation) messages.push(m);

  const trace: ChatTrace = {
    routing,
    toolCalls: [],
    memoryHits: memHits.map((m) => ({ id: m.id, title: m.title, category: m.category })),
    modelName: routing.model,
    tier: routing.tier,
  };

  let finalText = "";
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const resp = await invokeLLM({
      messages,
      tools: SOLOMON_TOOL_SCHEMAS,
      toolChoice: "auto",
    });
    const choice = resp.choices?.[0];
    const msg = choice?.message;
    if (!msg) break;

    const toolCalls = msg.tool_calls ?? [];
    if (toolCalls.length === 0) {
      finalText = typeof msg.content === "string" ? msg.content : extractText(msg.content);
      break;
    }

    // Append the assistant tool-call request first.
    messages.push({
      role: "assistant",
      content: typeof msg.content === "string" ? msg.content : extractText(msg.content),
      // The forge LLM normalizer collapses tool calls to text — that's fine.
    });

    // Execute each tool call sequentially.
    for (const tc of toolCalls) {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch {
        parsed = { _raw: tc.function.arguments };
      }
      const result = await runTool(tc.function.name, parsed, { triggeredBy: "user" });
      trace.toolCalls.push({
        name: tc.function.name,
        input: parsed,
        result: result.data ?? result.message ?? null,
        status: result.status,
      });
      messages.push({
        role: "tool",
        name: tc.function.name,
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      });
    }
  }

  if (!finalText) {
    finalText = "I hit my tool-call cap before producing a final answer. Try rephrasing or breaking the request into a smaller step.";
  }

  return { assistant: finalText, trace };
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === "string" ? c : (c as { text?: string }).text ?? ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

async function loadRoutingSettings(): Promise<{ fastModel: string; smartModel: string; threshold: number }> {
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
