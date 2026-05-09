import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Play, Wrench, History } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type ToolDescriptor = {
  name: string;
  description: string;
  parameters: any;
};

export default function Tools() {
  const list = trpc.tools.list.useQuery();
  const runs = trpc.tools.recentRuns.useQuery();
  const utils = trpc.useUtils();
  const runMut = trpc.tools.run.useMutation({
    onSuccess: async (res) => {
      toast.success(`Ran with status: ${res.status}`);
      await utils.tools.recentRuns.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Wrench className="size-5 text-primary" /> Tools
        </h1>
        <p className="text-xs text-muted-foreground mt-1 solomon-stencil">
          BUILT-IN INTEGRATIONS · {list.data?.length ?? 0} REGISTERED
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(list.data ?? []).map((t) => (
          <Card key={t.name}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span className="font-mono">{t.name}</span>
                <RunToolDialog
                  tool={t}
                  pending={runMut.isPending}
                  onRun={(input) => runMut.mutate({ name: t.name, input })}
                />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-foreground/80 leading-relaxed">{t.description}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {Object.keys(t.parameters?.properties ?? {}).map((p) => (
                  <span key={p} className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
                    {p}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <History className="size-4 text-primary" />
            <span className="solomon-stencil">RECENT TOOL RUNS</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
            {(runs.data ?? []).map((r) => (
              <div key={r.id} className="rounded border border-border bg-background/40 p-2 text-xs flex items-start gap-3">
                <Badge
                  variant="outline"
                  className={cn(
                    r.status === "success" ? "border-green-500/30 text-green-400 bg-green-500/10" :
                    r.status === "stub" ? "border-amber-500/30 text-amber-400 bg-amber-500/10" :
                                          "border-destructive/30 text-destructive bg-destructive/10"
                  )}
                >
                  {r.status}
                </Badge>
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-xs">{r.toolName}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {new Date(r.createdAt).toLocaleString()} · {r.durationMs ?? 0}ms · by {r.triggeredBy}
                  </p>
                  {r.errorMessage && <p className="text-destructive text-[11px] mt-1">{r.errorMessage}</p>}
                </div>
              </div>
            ))}
            {(runs.data ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground italic">No tool runs yet.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RunToolDialog({
  tool,
  onRun,
  pending,
}: {
  tool: ToolDescriptor;
  onRun: (input: Record<string, unknown>) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const props: Record<string, any> = tool.parameters?.properties ?? {};
  const required: string[] = tool.parameters?.required ?? [];
  const [vals, setVals] = useState<Record<string, string>>({});

  const setVal = (k: string, v: string) => setVals((p) => ({ ...p, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5 bg-background">
          <Play className="size-3.5" /> Run
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">{tool.name}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{tool.description}</p>
        <div className="space-y-2">
          {Object.keys(props).length === 0 && (
            <p className="text-xs text-muted-foreground italic">This tool takes no parameters.</p>
          )}
          {Object.entries(props).map(([key, schema]) => {
            const isLong = schema?.type === "string" && key.toLowerCase().includes("content") || key === "body" || key === "description";
            return (
              <div key={key} className="space-y-1.5">
                <Label className="text-xs">
                  {key}
                  {required.includes(key) && <span className="text-destructive ml-1">*</span>}
                  {schema?.enum && (
                    <span className="text-muted-foreground ml-2">[{schema.enum.join("|")}]</span>
                  )}
                </Label>
                {isLong ? (
                  <Textarea rows={3} value={vals[key] ?? ""} onChange={(e) => setVal(key, e.target.value)} />
                ) : (
                  <Input value={vals[key] ?? ""} onChange={(e) => setVal(key, e.target.value)} placeholder={schema?.description ?? ""} />
                )}
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button
            disabled={pending}
            onClick={() => {
              const parsed: Record<string, unknown> = {};
              for (const [k, v] of Object.entries(vals)) {
                if (v === "") continue;
                const t = props[k]?.type;
                if (t === "number" || t === "integer") parsed[k] = Number(v);
                else if (t === "boolean") parsed[k] = v === "true";
                else if (t === "array") parsed[k] = v.split(",").map((s) => s.trim()).filter(Boolean);
                else parsed[k] = v;
              }
              onRun(parsed);
              setOpen(false);
            }}
          >
            Run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
