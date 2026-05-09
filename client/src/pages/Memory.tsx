import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Hammer, Pencil, Pin, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Streamdown } from "streamdown";
import { toast } from "sonner";

type Category = "brand_voice" | "business_context" | "decision" | "project" | "performance" | "preference" | "general";

const CATEGORIES: Category[] = ["brand_voice", "business_context", "decision", "project", "performance", "preference", "general"];

const CATEGORY_LABEL: Record<Category, string> = {
  brand_voice: "Brand Voice",
  business_context: "Business Context",
  decision: "Decision",
  project: "Project",
  performance: "Performance",
  preference: "Preference",
  general: "General",
};

export default function Memory() {
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState<Category | "all">("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<any | null>(null);

  const list = trpc.memory.list.useQuery(filter === "all" ? undefined : { category: filter });
  const upsert = trpc.memory.upsert.useMutation({
    onSuccess: async () => {
      await utils.memory.list.invalidate();
      toast.success("Memory saved");
      setEditing(null);
    },
  });
  const del = trpc.memory.delete.useMutation({
    onSuccess: async () => utils.memory.list.invalidate(),
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list.data ?? [];
    return (list.data ?? []).filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.content.toLowerCase().includes(q) ||
        (m.tags ?? "").toLowerCase().includes(q)
    );
  }, [list.data, query]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Hammer className="size-5 text-primary" /> Memory
          </h1>
          <p className="text-xs text-muted-foreground mt-1 solomon-stencil">
            WHAT SOLOMON KNOWS · {list.data?.length ?? 0} ENTRIES
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search memory"
              className="pl-8 w-56"
            />
          </div>
          <Select value={filter} onValueChange={(v) => setFilter(v as Category | "all")}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{CATEGORY_LABEL[c]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <MemoryDialog
            trigger={<Button size="sm" className="gap-1.5"><Plus className="size-4" /> New</Button>}
            initial={null}
            onSave={(input) => upsert.mutate(input)}
            saving={upsert.isPending}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map((m) => (
          <Card key={m.id} className={cn("flex flex-col", m.pinned && "border-primary/40")}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="text-sm flex items-center gap-1.5 truncate">
                    {m.pinned && <Pin className="size-3 text-primary shrink-0" />}
                    {m.title}
                  </CardTitle>
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    <Badge variant="outline" className="text-[10px] border-primary/30 text-primary bg-primary/10">
                      {CATEGORY_LABEL[m.category as Category]}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      importance {m.importance}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <MemoryDialog
                    trigger={<Button size="icon" variant="ghost" className="h-7 w-7"><Pencil className="size-3.5" /></Button>}
                    initial={m}
                    onSave={(input) => upsert.mutate(input)}
                    saving={upsert.isPending}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 hover:text-destructive"
                    onClick={() => del.mutate({ id: m.id })}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="text-sm flex-1">
              <div className="prose prose-sm dark:prose-invert max-w-none line-clamp-6">
                <Streamdown>{m.content}</Streamdown>
              </div>
              {m.tags && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {m.tags.split(",").map((t) => t.trim()).filter(Boolean).map((t) => (
                    <span key={t} className="text-[10px] text-muted-foreground">#{t}</span>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {filtered.length === 0 && (
        <Card>
          <CardContent className="p-8 text-sm text-muted-foreground text-center">
            No memory entries match your filter.
          </CardContent>
        </Card>
      )}

      {/* Hidden controlled dialog for double-binding edit (kept simple; per-row dialogs above) */}
      {editing && null}
    </div>
  );
}

function MemoryDialog({
  trigger,
  initial,
  onSave,
  saving,
}: {
  trigger: React.ReactNode;
  initial: any | null;
  onSave: (input: any) => void;
  saving: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [category, setCategory] = useState<Category>((initial?.category as Category) ?? "general");
  const [tags, setTags] = useState(initial?.tags ?? "");
  const [importance, setImportance] = useState<number>(initial?.importance ?? 5);
  const [pinned, setPinned] = useState<boolean>(!!initial?.pinned);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v && initial) {
          setTitle(initial.title);
          setContent(initial.content);
          setCategory(initial.category);
          setTags(initial.tags ?? "");
          setImportance(initial.importance ?? 5);
          setPinned(!!initial.pinned);
        } else if (v && !initial) {
          setTitle(""); setContent(""); setCategory("general"); setTags(""); setImportance(5); setPinned(false);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit memory" : "New memory"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as Category)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{CATEGORY_LABEL[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Tags (comma separated)</Label>
              <Input value={tags} onChange={(e) => setTags(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Content (markdown)</Label>
            <Textarea rows={10} value={content} onChange={(e) => setContent(e.target.value)} className="font-mono text-xs" />
          </div>
          <div className="grid grid-cols-2 gap-3 items-end">
            <div className="space-y-1.5">
              <Label>Importance ({importance})</Label>
              <Input
                type="range"
                min={1}
                max={10}
                value={importance}
                onChange={(e) => setImportance(Number(e.target.value))}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={pinned} onCheckedChange={setPinned} id="pinned" />
              <Label htmlFor="pinned">Pinned (always loaded)</Label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={!title.trim() || !content.trim() || saving}
            onClick={() => {
              onSave({
                id: initial?.id,
                title: title.trim(),
                content: content.trim(),
                category,
                tags: tags.trim(),
                importance,
                pinned,
              });
              setOpen(false);
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
