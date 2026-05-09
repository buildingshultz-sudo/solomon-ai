import { describe, expect, it } from "vitest";
import { decideRoute } from "./router";

const base = {
  fastModel: "gpt-4o-mini",
  smartModel: "gpt-4o",
  threshold: 0.55,
};

describe("decideRoute", () => {
  it("respects explicit override → smart", () => {
    const r = decideRoute({ ...base, userMessage: "hi", override: "smart" });
    expect(r.tier).toBe("smart");
    expect(r.model).toBe("gpt-4o");
    expect(r.reason).toMatch(/override/);
  });

  it("respects explicit override → fast", () => {
    const r = decideRoute({ ...base, userMessage: "Compose an analysis of strategy", override: "fast" });
    expect(r.tier).toBe("fast");
    expect(r.model).toBe("gpt-4o-mini");
  });

  it("routes simple short messages to fast", () => {
    const r = decideRoute({ ...base, userMessage: "What is the time today?" });
    expect(r.tier).toBe("fast");
    expect(r.score).toBeLessThan(base.threshold);
  });

  it("routes long strategic asks to smart", () => {
    const longAsk = "Please draft a comprehensive multi-step strategy and architecture plan analyzing tradeoffs for my YouTube channel growth, ".repeat(4);
    const r = decideRoute({ ...base, userMessage: longAsk });
    expect(r.tier).toBe("smart");
    expect(r.score).toBeGreaterThanOrEqual(base.threshold);
  });

  it("biases toward smart when tools are involved", () => {
    const a = decideRoute({ ...base, userMessage: "design and architect a new pipeline", hasTools: false });
    const b = decideRoute({ ...base, userMessage: "design and architect a new pipeline", hasTools: true });
    expect(b.score).toBeGreaterThanOrEqual(a.score);
  });

  it("score is bounded between 0 and 1", () => {
    const r = decideRoute({ ...base, userMessage: "design plan strategy analyze architect investigate decision compare ".repeat(20), hasTools: true });
    expect(r.score).toBeLessThanOrEqual(1);
    expect(r.score).toBeGreaterThanOrEqual(0);
  });
});
