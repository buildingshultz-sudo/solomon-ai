/**
 * Solomon's Forge — Task Master Kill Switch.
 *
 * A prominent red button fixed in the top-right of every page. One click +
 * confirm and every running operation (LLM stream, tool call, scheduler tick,
 * import) is aborted via the server's killSwitch router.
 *
 * Designed to be unmissable but not in the way of normal workflow:
 *   - Resting state: outlined red button, top-right, ~36px tall.
 *   - Active state: shows count of running operations inside the button.
 *   - Hover: solid red.
 *   - Click: opens a confirm dialog with the live list of running ops.
 *   - On confirm: calls /killSwitch.killAll, shows toast with summary, refetches.
 */
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { ShieldAlert, X } from "lucide-react";

export function KillSwitch() {
  const utils = trpc.useUtils();
  const status = trpc.killSwitch.status.useQuery(undefined, {
    refetchInterval: 4000,
    retry: false,
  });
  const killAll = trpc.killSwitch.killAll.useMutation({
    onSuccess: (data) => {
      utils.killSwitch.status.invalidate();
      const count = (data as any)?.count ?? 0;
      setLastResult(
        count > 0
          ? `All processes terminated. (${count} operation${count === 1 ? "" : "s"} killed.)`
          : "All processes terminated. Nothing was running."
      );
      setOpen(false);
    },
  });

  const [open, setOpen] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const running = status.data?.running ?? [];
  const history = status.data?.history ?? [];
  const count = running.length;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Task Master — kill every running process"
        className={[
          "fixed top-3 right-4 z-50",
          "flex items-center gap-2 rounded-md border-2 px-3 py-1.5 text-xs font-semibold",
          "transition-all shadow-lg shadow-red-900/30",
          "border-red-600 text-red-400 bg-background/85 backdrop-blur",
          "hover:bg-red-600 hover:text-white",
          count > 0 ? "animate-pulse" : "",
        ].join(" ")}
        aria-label="Task Master Kill Switch"
      >
        <ShieldAlert className="h-3.5 w-3.5" />
        <span className="tracking-wider uppercase">Kill Switch</span>
        {count > 0 && (
          <span className="ml-1 rounded bg-red-600 px-1.5 py-0.5 text-[10px] text-white">
            {count}
          </span>
        )}
      </button>

      {lastResult && (
        <div className="fixed top-14 right-4 z-50 max-w-sm rounded-md border border-red-700/60 bg-red-950/90 p-3 text-xs text-red-100 shadow-lg backdrop-blur">
          <div className="flex items-start justify-between gap-2">
            <span>{lastResult}</span>
            <button onClick={() => setLastResult(null)} aria-label="dismiss">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-lg border-2 border-red-700 bg-background p-5 shadow-2xl">
            <div className="flex items-center gap-2 text-red-500">
              <ShieldAlert className="h-5 w-5" />
              <h2 className="text-lg font-semibold tracking-tight">Task Master — Kill All</h2>
            </div>

            <p className="mt-3 text-sm text-foreground/80">
              This will <strong>immediately abort every running operation</strong> on
              this Solomon's Forge instance: live AI generation, tool calls,
              scheduler jobs, imports — anything Solomon is currently doing.
            </p>

            <div className="mt-3 rounded-md border border-border bg-muted/30 p-3 text-xs">
              <div className="font-semibold mb-1">Currently running ({count}):</div>
              {count === 0 ? (
                <div className="text-muted-foreground italic">Nothing is running right now.</div>
              ) : (
                <ul className="space-y-1">
                  {running.map((op: any) => (
                    <li key={op.id} className="flex justify-between gap-2 font-mono">
                      <span className="truncate">{op.label}</span>
                      <span className="text-muted-foreground shrink-0">[{op.kind}]</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {history.length > 0 && (
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  Recent kill events ({history.length})
                </summary>
                <ul className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                  {history.map((h: any, i: number) => (
                    <li key={i} className="font-mono text-[11px] text-muted-foreground">
                      {new Date(h.killedAt).toLocaleTimeString()} — killed {h.count}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={() => killAll.mutate({ reason: "manual kill switch from UI" })}
                disabled={killAll.isPending}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {killAll.isPending ? "Terminating…" : "KILL ALL"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
