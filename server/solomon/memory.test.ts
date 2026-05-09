import { describe, expect, it } from "vitest";
import { scoreMemory, tokenize, buildMemoryContext } from "./memory";

function row(over: Partial<any>) {
  return {
    id: 1,
    category: "general",
    title: "",
    content: "",
    tags: "",
    importance: 5,
    pinned: false,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as any;
}

describe("memory.tokenize", () => {
  it("strips stopwords and short tokens", () => {
    expect(tokenize("The quick brown a x")).toEqual(["quick", "brown"]);
  });
  it("lowercases and removes punctuation", () => {
    expect(tokenize("YouTube, growth! 2024.")).toEqual(["youtube", "growth", "2024"]);
  });
});

describe("memory.scoreMemory", () => {
  it("ranks title hits over content hits", () => {
    const titleHit = row({ title: "Brand voice rules", content: "x" });
    const contentHit = row({ title: "x", content: "Brand voice rules and stuff" });
    const tokens = tokenize("brand voice");
    expect(scoreMemory(titleHit, tokens)).toBeGreaterThan(scoreMemory(contentHit, tokens));
  });

  it("rewards pinned + high importance", () => {
    const a = row({ title: "thing", importance: 10, pinned: true });
    const b = row({ title: "thing", importance: 1, pinned: false });
    const tokens = tokenize("thing");
    expect(scoreMemory(a, tokens)).toBeGreaterThan(scoreMemory(b, tokens));
  });

  it("falls back to importance when query is empty", () => {
    const a = row({ importance: 9, pinned: false });
    const b = row({ importance: 2, pinned: false });
    expect(scoreMemory(a, [])).toBeGreaterThan(scoreMemory(b, []));
  });
});

describe("memory.buildMemoryContext", () => {
  it("returns empty string when no rows", () => {
    expect(buildMemoryContext([])).toBe("");
  });
  it("formats memory entries with category and title", () => {
    const text = buildMemoryContext([
      row({ category: "brand_voice", title: "Tone", content: "Plain spoken." }),
    ]);
    expect(text).toMatch(/brand_voice/);
    expect(text).toMatch(/Tone/);
    expect(text).toMatch(/Plain spoken\./);
  });
});
