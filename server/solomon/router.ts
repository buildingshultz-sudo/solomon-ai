/**
 * Model routing for Solomon.
 *
 * Solomon must stay cheap. The router scores how complex an incoming task is
 * and chooses one of two tiers:
 *   - "fast"  → cheap/quick model (default: gpt-4o-mini)
 *   - "smart" → expensive/capable model (default: gpt-4o or gpt-5)
 *
 * Routing inputs:
 *   - explicit override on the request ("force": "fast"|"smart")
 *   - whether the conversation involves tool use
 *   - heuristic complexity score from the latest user message
 *   - configurable threshold from the settings table
 */

export type ModelTier = "fast" | "smart";

export type RoutingDecision = {
  tier: ModelTier;
  model: string;
  score: number;
  reason: string;
};

const SMART_KEYWORDS = [
  "plan",
  "strategy",
  "draft",
  "long",
  "outline",
  "analyze",
  "analysis",
  "compare",
  "design",
  "architect",
  "research",
  "deep",
  "code review",
  "rewrite",
  "novel",
  "essay",
  "investigate",
  "decision",
  "trade-off",
  "tradeoff",
  "negotiat",
  "complex",
  "multi-step",
];

const FAST_KEYWORDS = [
  "summarize",
  "tldr",
  "list",
  "format",
  "translate",
  "rephrase",
  "shorten",
  "fix typo",
  "lookup",
  "what is",
  "quick",
  "yes/no",
  "remind",
  "schedule",
  "post",
];

export type RouteInput = {
  userMessage: string;
  hasTools?: boolean;
  override?: ModelTier;
  fastModel: string;
  smartModel: string;
  threshold: number; // 0..1
};

export function decideRoute(input: RouteInput): RoutingDecision {
  const { userMessage, hasTools, override, fastModel, smartModel, threshold } = input;

  if (override) {
    return {
      tier: override,
      model: override === "smart" ? smartModel : fastModel,
      score: override === "smart" ? 1 : 0,
      reason: `explicit override: ${override}`,
    };
  }

  const text = userMessage.toLowerCase();
  let score = 0;

  // Length-based component (longer asks usually = more complex).
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words > 200) score += 0.5;
  else if (words > 80) score += 0.3;
  else if (words > 30) score += 0.15;

  // Keyword nudges.
  const smartHits = SMART_KEYWORDS.filter((kw) => text.includes(kw)).length;
  const fastHits = FAST_KEYWORDS.filter((kw) => text.includes(kw)).length;
  score += Math.min(smartHits * 0.18, 0.6);
  score -= Math.min(fastHits * 0.12, 0.4);

  // Tool use multi-step → bias smart.
  if (hasTools) score += 0.15;

  // Explicit code blocks or bullet plans → smart.
  if (/```/.test(userMessage)) score += 0.1;
  if (/\n\s*[-*]/.test(userMessage)) score += 0.05;

  score = Math.max(0, Math.min(1, score));

  const tier: ModelTier = score >= threshold ? "smart" : "fast";
  return {
    tier,
    model: tier === "smart" ? smartModel : fastModel,
    score: Number(score.toFixed(3)),
    reason: `heuristic score ${score.toFixed(2)} vs threshold ${threshold} (smart hits=${smartHits}, fast hits=${fastHits}, words=${words}, hasTools=${!!hasTools})`,
  };
}
