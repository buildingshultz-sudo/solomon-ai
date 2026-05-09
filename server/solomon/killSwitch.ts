/**
 * Solomon's Forge — Task Master Kill Switch.
 *
 * A single global registry of "cancellable operations" — any long-running
 * job (LLM stream, tool execution, scheduler tick, Manus import, etc.) can
 * register an AbortController + descriptive label here. Hitting the kill
 * switch aborts every controller, clears the registry, and emits an audit
 * record so the UI can show what was killed.
 *
 * Usage:
 *
 *   const ac = new AbortController();
 *   const handle = registerOperation({ label: "Solomon chat", kind: "llm", controller: ac });
 *   try {
 *     await fetch(url, { signal: ac.signal });
 *   } finally {
 *     handle.complete();
 *   }
 */

export type OperationKind =
  | "llm"
  | "tool"
  | "scheduler"
  | "import"
  | "background"
  | "other";

export type Operation = {
  id: number;
  label: string;
  kind: OperationKind;
  startedAt: Date;
  controller: AbortController;
};

export type KillRecord = {
  killedAt: Date;
  count: number;
  operations: Array<{ id: number; label: string; kind: OperationKind; ranForMs: number }>;
};

let _seq = 1;
const _ops = new Map<number, Operation>();
const _history: KillRecord[] = [];

export function listOperations(): Array<Omit<Operation, "controller">> {
  return Array.from(_ops.values()).map((o) => ({
    id: o.id,
    label: o.label,
    kind: o.kind,
    startedAt: o.startedAt,
  }));
}

export function registerOperation(input: {
  label: string;
  kind?: OperationKind;
  controller: AbortController;
}): { id: number; complete: () => void } {
  const id = _seq++;
  const op: Operation = {
    id,
    label: input.label,
    kind: input.kind ?? "other",
    startedAt: new Date(),
    controller: input.controller,
  };
  _ops.set(id, op);
  return {
    id,
    complete() {
      _ops.delete(id);
    },
  };
}

export function killAll(reason = "manual kill switch"): KillRecord {
  const now = new Date();
  const ops = Array.from(_ops.values());
  const summary: KillRecord = {
    killedAt: now,
    count: ops.length,
    operations: ops.map((o) => ({
      id: o.id,
      label: o.label,
      kind: o.kind,
      ranForMs: now.getTime() - o.startedAt.getTime(),
    })),
  };
  for (const o of ops) {
    try {
      o.controller.abort(new Error(`Killed: ${reason}`));
    } catch {
      /* ignore */
    }
  }
  _ops.clear();
  _history.unshift(summary);
  if (_history.length > 50) _history.pop();
  // eslint-disable-next-line no-console
  console.warn(`[KillSwitch] terminated ${summary.count} operation(s): ${reason}`);
  return summary;
}

export function killHistory(): KillRecord[] {
  return _history.slice(0, 20);
}
