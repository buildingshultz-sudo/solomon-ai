import { describe, expect, it } from "vitest";
import { parseCron, nextRun } from "./scheduler";

describe("parseCron", () => {
  it("expands wildcards", () => {
    const c = parseCron("* * * * *");
    expect(c.minute.length).toBe(60);
    expect(c.hour.length).toBe(24);
  });

  it("handles step intervals", () => {
    const c = parseCron("*/15 * * * *");
    expect(c.minute).toEqual([0, 15, 30, 45]);
  });

  it("handles ranges and lists", () => {
    const c = parseCron("0 9-11,14 * * 1-5");
    expect(c.hour).toEqual([9, 10, 11, 14]);
    expect(c.dow).toEqual([1, 2, 3, 4, 5]);
  });

  it("rejects malformed expressions", () => {
    expect(() => parseCron("* * *")).toThrow();
  });
});

describe("nextRun", () => {
  it("computes next 06:00 from a given clock", () => {
    const after = new Date("2026-01-01T05:30:00Z");
    const n = nextRun("0 6 * * *", new Date("2026-01-01T05:30:00Z"));
    // We don't assert exact UTC because cron is interpreted in server local time.
    // Instead: nextRun should be > 'after' and minutes should be 0.
    expect(n.getTime()).toBeGreaterThan(after.getTime());
    expect(n.getMinutes()).toBe(0);
    expect(n.getHours()).toBe(6);
  });

  it("rolls forward when current minute already passed", () => {
    const start = new Date();
    start.setSeconds(0, 0);
    const n = nextRun("* * * * *", start);
    expect(n.getTime()).toBeGreaterThan(start.getTime());
  });
});
