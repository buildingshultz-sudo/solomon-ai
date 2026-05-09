import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { Bell, CalendarClock, Loader2, Play, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export default function Scheduler() {
  const utils = trpc.useUtils();
  const list = trpc.scheduler.list.useQuery();
  const tickMut = trpc.scheduler.tickNow.useMutation({
    onSuccess: async (r) => {
      toast.success(`Tick ran (${r?.ran ?? 0} jobs)`);
      await utils.scheduler.list.invalidate();
    },
  });
  const runMut = trpc.scheduler.runNow.useMutation({
    onSuccess: async () => {
      toast.success("Job triggered");
      await utils.scheduler.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const notifyMut = trpc.scheduler.notifyTest.useMutation({
    onSuccess: (r) => (r.ok ? toast.success("Notification sent") : toast.warning("Notification not delivered")),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <CalendarClock className="size-5 text-primary" /> Autonomous schedule
          </h1>
          <p className="text-xs text-muted-foreground mt-1 solomon-stencil">
            BACKGROUND JOBS · {list.data?.length ?? 0} REGISTERED
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-1.5 bg-background" onClick={() => notifyMut.mutate()} disabled={notifyMut.isPending}>
            <Bell className="size-4" /> Test notify
          </Button>
          <Button className="gap-1.5" onClick={() => tickMut.mutate()} disabled={tickMut.isPending}>
            {tickMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Tick now
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(list.data ?? []).map((j) => (
          <Card key={j.id}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                <span>{j.name}</span>
                <Badge variant="outline" className={j.enabled ? "border-green-500/30 text-green-400 bg-green-500/10" : "border-muted text-muted-foreground"}>
                  {j.enabled ? "enabled" : "disabled"}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1.5">
              <p className="text-xs text-muted-foreground">
                Kind: <span className="font-mono">{j.kind}</span> · Cron: <span className="font-mono">{j.cron}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                Last run: {j.lastRunAt ? new Date(j.lastRunAt).toLocaleString() : "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                Next run: {j.nextRunAt ? new Date(j.nextRunAt).toLocaleString() : "—"}
              </p>
              {j.lastResult && (
                <pre className="bg-background/50 border border-border rounded p-2 text-[11px] mt-2 overflow-auto max-h-32 font-mono">
{j.lastResult.slice(0, 600)}
                </pre>
              )}
              <div className="pt-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 bg-background"
                  onClick={() => runMut.mutate({ id: j.id })}
                  disabled={runMut.isPending}
                >
                  <Play className="size-3.5" /> Run now
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {(list.data ?? []).length === 0 && (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground text-center">
              No jobs configured yet.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
