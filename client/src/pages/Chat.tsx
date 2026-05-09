import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Flame, Loader2, MessageSquarePlus, Send, Sparkles, Trash2, User, Wrench, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { toast } from "sonner";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  modelTier?: "fast" | "smart" | null;
  modelName?: string | null;
  toolPayload?: any;
};

export default function Chat() {
  const utils = trpc.useUtils();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [override, setOverride] = useState<"fast" | "smart" | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);

  const conversations = trpc.chat.listConversations.useQuery();
  const messagesQ = trpc.chat.getMessages.useQuery(
    { conversationId: activeId ?? -1 },
    { enabled: !!activeId }
  );

  useEffect(() => {
    if (!activeId && conversations.data && conversations.data.length > 0) {
      setActiveId(conversations.data[0].id);
    }
  }, [conversations.data, activeId]);

  const send = trpc.chat.send.useMutation({
    onSuccess: async (res) => {
      setActiveId(res.conversationId);
      await utils.chat.listConversations.invalidate();
      await utils.chat.getMessages.invalidate({ conversationId: res.conversationId });
    },
    onError: (e) => toast.error(e.message),
  });

  const newConv = trpc.chat.createConversation.useMutation({
    onSuccess: async (row) => {
      setActiveId(row.id);
      await utils.chat.listConversations.invalidate();
    },
  });

  const delConv = trpc.chat.deleteConversation.useMutation({
    onSuccess: async () => {
      setActiveId(null);
      await utils.chat.listConversations.invalidate();
    },
  });

  const messages: ChatMessage[] = useMemo(() => {
    return (messagesQ.data ?? []).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
      modelTier: m.modelTier,
      modelName: m.modelName,
      toolPayload: m.toolPayload,
    }));
  }, [messagesQ.data]);

  useEffect(() => {
    const el = scrollRef.current?.querySelector("[data-radix-scroll-area-viewport]") as HTMLDivElement | null;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, send.isPending]);

  const handleSend = () => {
    const content = draft.trim();
    if (!content || send.isPending) return;
    setDraft("");
    send.mutate({ conversationId: activeId ?? undefined, content, override });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 min-h-[calc(100vh-3rem)]">
      {/* Conversation rail */}
      <Card className="hidden lg:flex flex-col h-[calc(100vh-3rem)]">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm solomon-stencil text-muted-foreground">CONVERSATIONS</CardTitle>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => newConv.mutate({})}
            title="New conversation"
          >
            <MessageSquarePlus className="size-4" />
          </Button>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden p-0">
          <ScrollArea className="h-full">
            <div className="px-3 pb-3 space-y-1">
              {(conversations.data ?? []).map((c) => (
                <button
                  key={c.id}
                  onClick={() => setActiveId(c.id)}
                  className={cn(
                    "w-full text-left rounded-md px-3 py-2 text-sm border border-transparent transition-colors",
                    activeId === c.id ? "bg-accent border-border" : "hover:bg-accent/50"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{c.title}</span>
                    <Trash2
                      className="size-3 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        delConv.mutate({ id: c.id });
                      }}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {new Date(c.updatedAt).toLocaleString()}
                  </div>
                </button>
              ))}
              {conversations.data && conversations.data.length === 0 && (
                <p className="text-xs text-muted-foreground px-2 py-3">
                  No conversations yet. Start one on the right.
                </p>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Chat surface */}
      <Card className="flex flex-col h-[calc(100vh-3rem)]">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center">
              <Flame className="size-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">Solomon</CardTitle>
              <p className="text-xs text-muted-foreground">Chief of staff for Shultz Enterprises</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ModelOverrideToggle value={override} onChange={setOverride} />
          </div>
        </CardHeader>

        <CardContent className="flex-1 overflow-hidden p-0">
          <div ref={scrollRef} className="h-full">
            {messages.length === 0 && !send.isPending ? (
              <EmptyState
                disabled={send.isPending}
                onPick={(p) => {
                  setDraft(p);
                }}
              />
            ) : (
              <ScrollArea className="h-full">
                <div className="flex flex-col space-y-4 p-4 md:p-6">
                  {messages.map((m, idx) => (
                    <MessageBubble key={idx} m={m} />
                  ))}
                  {send.isPending && (
                    <div className="flex items-start gap-3">
                      <div className="size-8 shrink-0 mt-1 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center">
                        <Sparkles className="size-4 text-primary" />
                      </div>
                      <div className="rounded-md bg-muted px-4 py-2.5 border border-border">
                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
            )}
          </div>
        </CardContent>

        <div className="p-3 border-t bg-background/40">
          <div className="flex items-end gap-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Ask Solomon to plan, draft, schedule, or run a tool..."
              className="flex-1 min-h-9 max-h-40 resize-none"
            />
            <Button
              onClick={handleSend}
              disabled={!draft.trim() || send.isPending}
              size="icon"
              className="h-[38px] w-[38px] shrink-0"
            >
              {send.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2 px-1">
            Enter to send. Shift+Enter for newline.
          </p>
        </div>
      </Card>
    </div>
  );
}

function ModelOverrideToggle({
  value,
  onChange,
}: {
  value: "fast" | "smart" | undefined;
  onChange: (v: "fast" | "smart" | undefined) => void;
}) {
  return (
    <div className="flex items-center rounded-md border border-border overflow-hidden text-xs">
      {(["auto", "fast", "smart"] as const).map((opt) => {
        const active = (opt === "auto" && value === undefined) || opt === value;
        return (
          <button
            key={opt}
            onClick={() => onChange(opt === "auto" ? undefined : (opt as "fast" | "smart"))}
            className={cn(
              "px-2.5 py-1 solomon-stencil tracking-wider",
              active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent"
            )}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function MessageBubble({ m }: { m: ChatMessage }) {
  const isUser = m.role === "user";
  return (
    <div className={cn("flex gap-3", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="size-8 shrink-0 mt-1 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center">
          <Sparkles className="size-4 text-primary" />
        </div>
      )}
      <div className={cn("max-w-[80%] flex flex-col gap-2", isUser ? "items-end" : "items-start")}>
        <div
          className={cn(
            "rounded-md px-4 py-2.5 border",
            isUser
              ? "bg-primary/15 text-foreground border-primary/30"
              : "bg-card text-card-foreground border-border"
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap text-sm">{m.content}</p>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <Streamdown>{m.content}</Streamdown>
            </div>
          )}
        </div>
        {!isUser && m.toolPayload && <TraceCard payload={m.toolPayload} />}
      </div>
      {isUser && (
        <div className="size-8 shrink-0 mt-1 rounded-full bg-secondary border border-border flex items-center justify-center">
          <User className="size-4 text-secondary-foreground" />
        </div>
      )}
    </div>
  );
}

function TraceCard({ payload }: { payload: any }) {
  if (!payload) return null;
  const tier = payload.tier as "fast" | "smart" | undefined;
  const model = payload.modelName as string | undefined;
  const calls = (payload.toolCalls ?? []) as Array<{ name: string; status: string }>;
  const memHits = (payload.memoryHits ?? []) as Array<{ title: string; category: string }>;
  return (
    <div className="flex flex-wrap gap-1.5 text-[11px]">
      {tier && (
        <Badge variant="outline" className="gap-1 border-primary/30 text-primary bg-primary/10">
          {tier === "smart" ? <Zap className="size-3" /> : <Sparkles className="size-3" />}
          {tier} · {model}
        </Badge>
      )}
      {calls.map((c, i) => (
        <Badge
          key={i}
          variant="outline"
          className={cn(
            "gap-1",
            c.status === "success" ? "border-green-500/30 text-green-400 bg-green-500/10" :
            c.status === "stub"    ? "border-amber-500/30 text-amber-400 bg-amber-500/10" :
                                     "border-destructive/30 text-destructive bg-destructive/10"
          )}
        >
          <Wrench className="size-3" /> {c.name} · {c.status}
        </Badge>
      ))}
      {memHits.length > 0 && (
        <Badge variant="outline" className="gap-1">
          memory · {memHits.length} hit{memHits.length === 1 ? "" : "s"}
        </Badge>
      )}
    </div>
  );
}

function EmptyState({ onPick, disabled }: { onPick: (p: string) => void; disabled?: boolean }) {
  const prompts = [
    "Give me today's morning brief.",
    "What's on the board this week for IronEdit?",
    "Draft a YouTube title and description for a pipefitting time-lapse video.",
    "Show me a finance summary and flag anything weird.",
  ];
  return (
    <div className="h-full flex flex-col items-center justify-center p-8 text-center solomon-rivet">
      <div className="size-14 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center mb-4">
        <Flame className="size-7 text-primary" />
      </div>
      <h2 className="text-xl font-semibold mb-1">Solomon is ready.</h2>
      <p className="text-sm text-muted-foreground max-w-md mb-6">
        Plain-spoken chief of staff. Routes cheap models for routine work, escalates only when the job's complex.
      </p>
      <div className="flex flex-wrap gap-2 justify-center max-w-2xl">
        {prompts.map((p) => (
          <button
            key={p}
            disabled={disabled}
            onClick={() => onPick(p)}
            className="rounded-md border border-border bg-card px-3 py-2 text-xs text-left hover:bg-accent transition-colors disabled:opacity-50"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
