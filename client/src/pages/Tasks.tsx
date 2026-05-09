import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { CheckCircle2, Circle, Clock, ListChecks, Plus, Trash2, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type Status = "active" | "in_progress" | "completed" | "blocked";
type Priority = "low" | "medium" | "high" | "urgent";

const STATUS_ORDER: Status[] = ["active", "in_progress", "blocked", "completed"];
const STATUS_LABEL: Record<Status, string> = {
  active: "Active",
  in_progress: "In progress",
  blocked: "Blocked",
  completed: "Completed",
};

const PRIORITY_TONE: Record<Priority, string> = {
  low: "border-muted-foreground/30 text-muted-foreground bg-muted/40",
  medium: "border-blue-500/30 text-blue-300 bg-blue-500/10",
  high: "border-amber-500/30 text-amber-300 bg-amber-500/10",
  urgent: "border-destructive/40 text-destructive bg-destructive/10",
};

export default function Tasks() {
  const utils = trpc.useUtils();
  const list = trpc.tasks.list.useQuery();
  const createMut = trpc.tasks.create.useMutation({
    onSuccess: async () => {
      await utils.tasks.list.invalidate();
      toast.success("Task created");
    },
  });
  const updateMut = trpc.tasks.update.useMutation({
    onSuccess: async () => utils.tasks.list.invalidate(),
  });
  const deleteMut = trpc.tasks.delete.useMutation({
    onSuccess: async () => utils.tasks.list.invalidate(),
  });

  const grouped: Record<Status, typeof list.data> = {
    active: [], in_progress: [], blocked: [], completed: [],
  } as never;
  for (const t of list.data ?? []) (grouped[t.status as Status] as never[]).push(t as never);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <ListChecks className="size-5 text-primary" /> Job board
          </h1>
          <p className="text-xs text-muted-foreground mt-1 solomon-stencil">
            INTERNAL TASKS · {list.data?.length ?? 0} ON THE WALL
          </p>
        </div>
        <NewTaskDialog onCreate={(input) => createMut.mutate(input)} pending={createMut.isPending} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {STATUS_ORDER.map((s) => (
          <Card key={s} className="flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-sm">
                <span className="solomon-stencil">{STATUS_LABEL[s]}</span>
                <Badge variant="outline">{(grouped[s] ?? []).length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 space-y-2">
              {(grouped[s] ?? []).map((t: any) => (
                <div
                  key={t.id}
                  className="rounded-md border border-border bg-background/50 p-3 hover:bg-accent/30 transition"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0">
                      <button
                        onClick={() =>
                          updateMut.mutate({
                            id: t.id,
                            status: t.status === "completed" ? "active" : "completed",
                          })
                        }
                        className="mt-0.5 text-muted-foreground hover:text-primary"
                        title="Toggle complete"
                      >
                        {t.status === "completed" ? (
                          <CheckCircle2 className="size-4 text-primary" />
                        ) : (
                          <Circle className="size-4" />
                        )}
                      </button>
                      <div className="min-w-0">
                        <p className={cn("text-sm font-medium truncate", t.status === "completed" && "line-through text-muted-foreground")}>
                          {t.title}
                        </p>
                        {t.description && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.description}</p>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => deleteMut.mutate({ id: t.id })}
                      className="text-muted-foreground hover:text-destructive"
                      title="Delete"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    <Badge variant="outline" className={PRIORITY_TONE[t.priority as Priority]}>
                      {t.priority}
                    </Badge>
                    {t.project && t.project !== "general" && (
                      <Badge variant="outline" className="text-[10px]">
                        {t.project}
                      </Badge>
                    )}
                    {t.autonomous && (
                      <Badge variant="outline" className="text-[10px] border-primary/30 text-primary bg-primary/10">
                        autonomous
                      </Badge>
                    )}
                    {t.dueAt && (
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Clock className="size-3" />
                        {new Date(t.dueAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {STATUS_ORDER.filter((x) => x !== t.status).map((x) => (
                      <button
                        key={x}
                        onClick={() => updateMut.mutate({ id: t.id, status: x })}
                        className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:bg-accent"
                      >
                        → {STATUS_LABEL[x]}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {(grouped[s] ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground/70 italic px-1 py-3">empty</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {list.data && list.data.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
            <AlertTriangle className="size-5" />
            No tasks yet. Add one or ask Solomon to make one for you.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function NewTaskDialog({
  onCreate,
  pending,
}: {
  onCreate: (input: any) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [project, setProject] = useState("general");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="size-4" /> New task
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Wire up YouTube analytics tool" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="desc">Notes</Label>
            <Textarea id="desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project">Project</Label>
              <Input id="project" value={project} onChange={(e) => setProject(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={!title.trim() || pending}
            onClick={() => {
              onCreate({
                title: title.trim(),
                description: description.trim() || undefined,
                priority,
                project: project.trim() || "general",
              });
              setTitle("");
              setDescription("");
              setOpen(false);
            }}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
