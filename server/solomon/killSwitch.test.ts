import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { killAll, killHistory, listOperations, registerOperation } from "./killSwitch";

// Reset module state between tests by killing all ops before each test.
beforeEach(() => killAll("test setup"));
afterEach(() => killAll("test teardown"));

describe("killSwitch.registerOperation", () => {
  it("appears in listOperations after registration", () => {
    const ac = new AbortController();
    const handle = registerOperation({ label: "test-op", kind: "llm", controller: ac });
    const ops = listOperations();
    expect(ops.some((o) => o.id === handle.id && o.label === "test-op")).toBe(true);
    handle.complete();
  });

  it("is removed from list after complete()", () => {
    const ac = new AbortController();
    const handle = registerOperation({ label: "done-op", controller: ac });
    handle.complete();
    expect(listOperations().some((o) => o.id === handle.id)).toBe(false);
  });

  it("defaults kind to 'other' when not provided", () => {
    const ac = new AbortController();
    const handle = registerOperation({ label: "no-kind", controller: ac });
    const op = listOperations().find((o) => o.id === handle.id);
    expect(op?.kind).toBe("other");
    handle.complete();
  });

  it("assigns unique sequential ids", () => {
    const ac1 = new AbortController();
    const ac2 = new AbortController();
    const h1 = registerOperation({ label: "a", controller: ac1 });
    const h2 = registerOperation({ label: "b", controller: ac2 });
    expect(h2.id).toBeGreaterThan(h1.id);
    h1.complete();
    h2.complete();
  });
});

describe("killSwitch.killAll", () => {
  it("aborts registered controllers", () => {
    const ac = new AbortController();
    registerOperation({ label: "killable", kind: "tool", controller: ac });
    expect(ac.signal.aborted).toBe(false);
    killAll("unit test");
    expect(ac.signal.aborted).toBe(true);
  });

  it("returns a summary with correct count", () => {
    const controllers = [new AbortController(), new AbortController(), new AbortController()];
    controllers.forEach((ac, i) => registerOperation({ label: `op-${i}`, controller: ac }));
    const summary = killAll("batch test");
    expect(summary.count).toBe(3);
    expect(summary.operations).toHaveLength(3);
  });

  it("clears the registry after killing", () => {
    registerOperation({ label: "gone", controller: new AbortController() });
    killAll("clear test");
    expect(listOperations()).toHaveLength(0);
  });

  it("records ranForMs >= 0 for each killed op", () => {
    registerOperation({ label: "timed", controller: new AbortController() });
    const summary = killAll("timing test");
    expect(summary.operations[0]?.ranForMs).toBeGreaterThanOrEqual(0);
  });

  it("returns count 0 when nothing is registered", () => {
    const summary = killAll("empty");
    expect(summary.count).toBe(0);
  });
});

describe("killSwitch.killHistory", () => {
  it("records killAll calls in history", () => {
    killAll("history test 1");
    const history = killHistory();
    expect(history.length).toBeGreaterThan(0);
    expect(history[0]).toMatchObject({ count: 0 });
  });

  it("returns most recent record first", () => {
    killAll("first");
    const t1 = Date.now();
    killAll("second");
    const history = killHistory();
    expect(history[0]?.killedAt.getTime()).toBeGreaterThanOrEqual(t1);
  });

  it("caps history at 20 entries", () => {
    for (let i = 0; i < 25; i++) killAll(`flood-${i}`);
    expect(killHistory().length).toBeLessThanOrEqual(20);
  });
});
