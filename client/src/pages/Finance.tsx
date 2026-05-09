import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { ArrowDownRight, ArrowUpRight, Coins, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

export default function Finance() {
  const utils = trpc.useUtils();
  const list = trpc.finance.list.useQuery();
  const summary = trpc.finance.summary.useQuery();
  const add = trpc.finance.add.useMutation({
    onSuccess: async () => {
      await utils.finance.list.invalidate();
      await utils.finance.summary.invalidate();
      toast.success("Entry added");
    },
  });
  const del = trpc.finance.delete.useMutation({
    onSuccess: async () => {
      await utils.finance.list.invalidate();
      await utils.finance.summary.invalidate();
    },
  });

  const summaryData: any = summary.data ?? { income: "0", expense: "0", balance: "0", byCategory: {}, entries: 0 };
  const byCat: Record<string, number> = summaryData.byCategory ?? {};
  const sortedCats = useMemo(() => Object.entries(byCat).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])), [byCat]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Coins className="size-5 text-primary" /> Finance ledger
          </h1>
          <p className="text-xs text-muted-foreground mt-1 solomon-stencil">
            INCOME & EXPENSES · {list.data?.length ?? 0} ENTRIES
          </p>
        </div>
        <NewEntryDialog onAdd={(input) => add.mutate(input)} pending={add.isPending} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard label="Income" value={summaryData.income} accent="text-green-400" icon={<ArrowUpRight className="size-4" />} />
        <SummaryCard label="Expense" value={summaryData.expense} accent="text-destructive" icon={<ArrowDownRight className="size-4" />} />
        <SummaryCard label="Balance" value={summaryData.balance} accent="text-primary" icon={<Coins className="size-4" />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm solomon-stencil">LEDGER</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-2">Date</th>
                  <th className="text-left px-4 py-2">Type</th>
                  <th className="text-left px-4 py-2">Category</th>
                  <th className="text-left px-4 py-2">Description</th>
                  <th className="text-right px-4 py-2">Amount</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {(list.data ?? []).map((e) => (
                  <tr key={e.id} className="border-b border-border/50 last:border-0 hover:bg-accent/30">
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {new Date(e.occurredAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2">
                      <Badge
                        variant="outline"
                        className={
                          e.type === "income"
                            ? "border-green-500/30 text-green-400 bg-green-500/10"
                            : "border-destructive/30 text-destructive bg-destructive/10"
                        }
                      >
                        {e.type}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">{e.category}</td>
                    <td className="px-4 py-2 text-foreground/80">{e.description}</td>
                    <td className="px-4 py-2 text-right font-mono">
                      {e.type === "income" ? "+" : "−"}${Number(e.amount).toFixed(2)}
                    </td>
                    <td className="px-2 py-2">
                      <Button size="icon" variant="ghost" className="h-7 w-7 hover:text-destructive" onClick={() => del.mutate({ id: e.id })}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {(list.data ?? []).length === 0 && (
                  <tr>
                    <td className="px-4 py-6 text-center text-muted-foreground" colSpan={6}>
                      No entries yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm solomon-stencil">BY CATEGORY</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {sortedCats.map(([cat, amt]) => {
              const positive = amt >= 0;
              return (
                <div key={cat} className="flex items-center justify-between text-sm">
                  <span className="text-foreground/80">{cat}</span>
                  <span className={positive ? "text-green-400 font-mono" : "text-destructive font-mono"}>
                    {positive ? "+" : "−"}${Math.abs(amt).toFixed(2)}
                  </span>
                </div>
              );
            })}
            {sortedCats.length === 0 && (
              <p className="text-xs text-muted-foreground italic">Nothing to show yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, accent, icon }: { label: string; value: string; accent: string; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`size-9 rounded-md bg-card border border-border flex items-center justify-center ${accent}`}>{icon}</div>
        <div>
          <p className="text-xs solomon-stencil text-muted-foreground">{label}</p>
          <p className={`text-lg font-mono font-semibold ${accent}`}>${Number(value).toFixed(2)}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function NewEntryDialog({ onAdd, pending }: { onAdd: (input: any) => void; pending: boolean }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"income" | "expense">("income");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("general");
  const [description, setDescription] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="size-4" /> New entry
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New ledger entry</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as "income" | "expense")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="income">Income</SelectItem>
                  <SelectItem value="expense">Expense</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Amount</Label>
              <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={!amount || Number.isNaN(Number(amount)) || pending}
            onClick={() => {
              onAdd({
                type,
                amount: Number(amount),
                category: category.trim() || "general",
                description: description.trim(),
              });
              setAmount(""); setDescription("");
              setOpen(false);
            }}
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
