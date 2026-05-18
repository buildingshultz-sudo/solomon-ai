import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { Cloud, Cpu, Eye, EyeOff, KeyRound, Save, Settings as SettingsIcon, Sparkles, Zap, Send, Plug, Globe, Power, PowerOff, Loader2, Network } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const PROVIDER_FIELDS_OPENAI = [
  { key: "provider.openai_base", label: "OpenAI base URL", placeholder: "https://api.openai.com", help: "Override for OpenAI-compatible gateways." },
  { key: "provider.openai_model", label: "OpenAI model", placeholder: "gpt-4o-mini", help: "e.g. gpt-4o-mini, gpt-4o, gpt-5" },
];

const PROVIDER_FIELDS_OLLAMA = [
  { key: "provider.ollama_base", label: "Ollama base URL", placeholder: "http://127.0.0.1:11434", help: "Where Ollama is listening on this PC." },
  { key: "provider.ollama_model", label: "Ollama model", placeholder: "llama3.1:8b", help: "Pull with `ollama pull llama3.1:8b` first." },
];

const PROVIDER_FIELDS_OPENROUTER = [
  { key: "provider.openrouter_base", label: "OpenRouter base URL", placeholder: "https://openrouter.ai/api", help: "Leave blank to use the default." },
  { key: "provider.openrouter_model", label: "Model", placeholder: "anthropic/claude-3.5-sonnet", help: "Any model on openrouter.ai/models — e.g. google/gemini-2.0-flash-001, deepseek/deepseek-chat-v3-0324:free" },
];

const ROUTING_KEYS = [
  { key: "routing.fast_model", label: "Fast model", placeholder: "gpt-4o-mini", help: "Used for cheap / quick tasks." },
  { key: "routing.smart_model", label: "Smart model", placeholder: "gpt-4o or gpt-5", help: "Used for complex reasoning." },
  { key: "routing.complexity_threshold", label: "Threshold (0–1)", placeholder: "0.55", help: "Score above this routes to smart." },
];

const API_KEYS = [
  { key: "apikey.openrouter", label: "OpenRouter API key" },
  { key: "apikey.openai", label: "OpenAI API key" },
  { key: "apikey.youtube", label: "YouTube Data API key" },
  { key: "apikey.gmail_oauth", label: "Gmail OAuth refresh token" },
  { key: "apikey.gdrive_oauth", label: "Google Drive OAuth refresh token" },
  { key: "apikey.facebook", label: "Facebook Graph access token" },
  { key: "apikey.instagram", label: "Instagram Graph access token" },
  { key: "apikey.tiktok", label: "TikTok Content Posting access token" },
];

export default function Settings() {
  const utils = trpc.useUtils();
  const list = trpc.settings.list.useQuery();
  const upsert = trpc.settings.upsert.useMutation({
    onSuccess: async () => {
      await utils.settings.list.invalidate();
      toast.success("Saved");
    },
  });

  const map = useMemo(() => {
    const m = new Map<string, any>();
    for (const r of list.data ?? []) m.set(r.key, r);
    return m;
  }, [list.data]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <SettingsIcon className="size-5 text-primary" /> Settings
        </h1>
        <p className="text-xs text-muted-foreground mt-1 solomon-stencil">
          API KEYS · MODEL ROUTING · SYSTEM
        </p>
      </div>

      <Tabs defaultValue="provider">
        <TabsList className="flex flex-wrap h-auto justify-start gap-1">
          <TabsTrigger value="provider"><Cpu className="size-3.5 mr-1.5" /> Model</TabsTrigger>
          <TabsTrigger value="routing"><Zap className="size-3.5 mr-1.5" /> Routing</TabsTrigger>
          <TabsTrigger value="keys"><KeyRound className="size-3.5 mr-1.5" /> API keys</TabsTrigger>
          <TabsTrigger value="connectors"><Plug className="size-3.5 mr-1.5" /> Connectors</TabsTrigger>
          <TabsTrigger value="telegram"><Send className="size-3.5 mr-1.5" /> Telegram</TabsTrigger>
          <TabsTrigger value="remote"><Globe className="size-3.5 mr-1.5" /> Remote</TabsTrigger>
          <TabsTrigger value="system"><Sparkles className="size-3.5 mr-1.5" /> System</TabsTrigger>
        </TabsList>

        <TabsContent value="provider" className="space-y-4">
          <ProviderTab map={map} upsert={upsert} />
        </TabsContent>

        <TabsContent value="routing" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm solomon-stencil">MODEL ROUTING</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {ROUTING_KEYS.map((k) => {
                const cur = map.get(k.key);
                return (
                  <SettingRow
                    key={k.key}
                    label={k.label}
                    help={k.help}
                    placeholder={k.placeholder}
                    initial={cur?.value ?? ""}
                    onSave={(value) =>
                      upsert.mutate({
                        key: k.key,
                        value,
                        category: "routing",
                        isSecret: false,
                      })
                    }
                  />
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="keys" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm solomon-stencil">API KEYS</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {API_KEYS.map((k) => {
                const cur = map.get(k.key);
                return (
                  <SettingRow
                    key={k.key}
                    label={k.label}
                    isSecret
                    initial={cur?.hasValue ? "" : ""}
                    placeholder={cur?.hasValue ? "stored — enter a new value to overwrite" : "not set"}
                    badge={cur?.hasValue ? "stored" : "not set"}
                    onSave={(value) =>
                      upsert.mutate({
                        key: k.key,
                        value,
                        category: "apikey",
                        isSecret: true,
                      })
                    }
                  />
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="connectors" className="space-y-4">
          <ConnectorsTab map={map} upsert={upsert} />
        </TabsContent>

        <TabsContent value="telegram" className="space-y-4">
          <TelegramTab map={map} upsert={upsert} />
        </TabsContent>

        <TabsContent value="remote" className="space-y-4">
          <RemoteAccessTab />
        </TabsContent>

        <TabsContent value="system" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm solomon-stencil">SYSTEM</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-muted-foreground text-xs">
                Solomon's Forge runs locally on this PC. Pick your <strong>Model Provider</strong> on the first tab — Ollama for free/offline, OpenAI for cloud quality. Database is an embedded SQLite file under <code className="font-mono">.solomon-data/</code>.
              </p>
              <ul className="text-sm space-y-1 pt-2 list-disc list-inside text-foreground/80">
                <li>Memory uses the database (no external vector store required).</li>
                <li>Scheduler ticks every 60 seconds inside the running server process.</li>
                <li>Tool stubs return drafts when API keys are missing — never silent failures.</li>
                <li>Owner notifications use the platform notification API.</li>
              </ul>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProviderTab({ map, upsert }: { map: Map<string, any>; upsert: any }) {
  const current = (map.get("provider.kind")?.value || "openai") as "openai" | "ollama" | "openrouter";
  const [provider, setProvider] = useState<"openai" | "ollama" | "openrouter">(current);
  useEffect(() => setProvider(current), [current]);

  function selectProvider(p: "openai" | "ollama" | "openrouter") {
    setProvider(p);
    upsert.mutate({ key: "provider.kind", value: p, category: "provider", isSecret: false });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm solomon-stencil">MODEL PROVIDER</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Choose where Solomon does its thinking. <strong>OpenRouter</strong> is the easiest cloud option — one API key, access to Claude, GPT-4o, Gemini, and more.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => selectProvider("openrouter")}
              className={`flex items-start gap-3 rounded-md border p-4 text-left transition-colors ${provider === "openrouter" ? "border-primary bg-primary/10" : "border-border hover:bg-accent/40"}`}
            >
              <Network className="size-5 text-primary shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-sm">OpenRouter ✦ recommended</div>
                <div className="text-xs text-muted-foreground mt-0.5">One key, 300+ models. Claude, GPT-4o, Gemini, DeepSeek.</div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => selectProvider("ollama")}
              className={`flex items-start gap-3 rounded-md border p-4 text-left transition-colors ${provider === "ollama" ? "border-primary bg-primary/10" : "border-border hover:bg-accent/40"}`}
            >
              <Cpu className="size-5 text-primary shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-sm">Ollama (local, free)</div>
                <div className="text-xs text-muted-foreground mt-0.5">Runs on this PC. Zero cost. Works offline.</div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => selectProvider("openai")}
              className={`flex items-start gap-3 rounded-md border p-4 text-left transition-colors ${provider === "openai" ? "border-primary bg-primary/10" : "border-border hover:bg-accent/40"}`}
            >
              <Cloud className="size-5 text-primary shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-sm">OpenAI (cloud, paid)</div>
                <div className="text-xs text-muted-foreground mt-0.5">Direct OpenAI or compatible gateway.</div>
              </div>
            </button>
          </div>

          {provider === "openrouter" && (
            <div className="space-y-3 pt-3 border-t">
              {PROVIDER_FIELDS_OPENROUTER.map((k) => (
                <SettingRow
                  key={k.key}
                  label={k.label}
                  help={k.help}
                  placeholder={k.placeholder}
                  initial={map.get(k.key)?.value ?? ""}
                  onSave={(value) =>
                    upsert.mutate({ key: k.key, value, category: "provider", isSecret: false })
                  }
                />
              ))}
              <div className="rounded-md bg-muted/50 p-3 text-xs leading-relaxed space-y-1">
                <p className="font-semibold">Setup (2 steps):</p>
                <ol className="list-decimal list-inside space-y-0.5 text-muted-foreground">
                  <li>Go to <strong>openrouter.ai</strong> → sign up → Keys → Create key → copy it.</li>
                  <li>Paste it into <strong>Settings → API Keys → OpenRouter API key</strong> and hit Save.</li>
                </ol>
                <p className="text-muted-foreground pt-1">Default model: <code>anthropic/claude-3.5-sonnet</code>. Change the model above to any ID from openrouter.ai/models.</p>
              </div>
            </div>
          )}

          {provider === "ollama" && (
            <div className="space-y-3 pt-3 border-t">
              {PROVIDER_FIELDS_OLLAMA.map((k) => (
                <SettingRow
                  key={k.key}
                  label={k.label}
                  help={k.help}
                  placeholder={k.placeholder}
                  initial={map.get(k.key)?.value ?? ""}
                  onSave={(value) =>
                    upsert.mutate({ key: k.key, value, category: "provider", isSecret: false })
                  }
                />
              ))}
              <div className="rounded-md bg-muted/50 p-3 text-xs leading-relaxed">
                <p className="font-semibold mb-1">Setup (Windows):</p>
                <ol className="list-decimal list-inside space-y-0.5 text-muted-foreground">
                  <li>Download Ollama from <code>https://ollama.com/download/windows</code> and install.</li>
                  <li>Open PowerShell and run <code>ollama pull llama3.1:8b</code> (one-time, ~5GB).</li>
                  <li>Ollama runs as a background service automatically. Solomon will use it as soon as it's reachable.</li>
                </ol>
              </div>
            </div>
          )}

          {provider === "openai" && (
            <div className="space-y-3 pt-3 border-t">
              {PROVIDER_FIELDS_OPENAI.map((k) => (
                <SettingRow
                  key={k.key}
                  label={k.label}
                  help={k.help}
                  placeholder={k.placeholder}
                  initial={map.get(k.key)?.value ?? ""}
                  onSave={(value) =>
                    upsert.mutate({ key: k.key, value, category: "provider", isSecret: false })
                  }
                />
              ))}
              <p className="text-xs text-muted-foreground">
                Set your API key on the <strong>API Keys</strong> tab.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SettingRow({
  label,
  help,
  placeholder,
  initial,
  onSave,
  isSecret,
  badge,
}: {
  label: string;
  help?: string;
  placeholder?: string;
  initial: string;
  onSave: (value: string) => void;
  isSecret?: boolean;
  badge?: string;
}) {
  const [value, setValue] = useState(initial);
  const [show, setShow] = useState(false);
  useEffect(() => setValue(initial), [initial]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-[200px_1fr_auto] items-center gap-3">
      <div className="space-y-0.5">
        <Label className="text-sm">{label}</Label>
        {help && <p className="text-[11px] text-muted-foreground">{help}</p>}
        {badge && (
          <Badge variant="outline" className="text-[10px]">{badge}</Badge>
        )}
      </div>
      <div className="relative">
        <Input
          value={value}
          type={isSecret && !show ? "password" : "text"}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
        />
        {isSecret && (
          <button
            onClick={() => setShow((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            type="button"
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        )}
      </div>
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5 bg-background"
        disabled={!value || value === initial}
        onClick={() => onSave(value)}
      >
        <Save className="size-3.5" /> Save
      </Button>
    </div>
  );
}

// ─── Connectors tab (MCP) ────────────────────────────────────────────────────
function ConnectorsTab({ map, upsert }: { map: Map<string, any>; upsert: any }) {
  const utils = trpc.useUtils();
  const list = trpc.connectors.list.useQuery(undefined, { refetchInterval: 5000 });
  const start = trpc.connectors.start.useMutation({
    onSuccess: (r) => {
      toast(r.message ?? "started");
      utils.connectors.list.invalidate();
    },
  });
  const stop = trpc.connectors.stop.useMutation({
    onSuccess: (r) => {
      toast(r.message ?? "stopped");
      utils.connectors.list.invalidate();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm solomon-stencil">MCP CONNECTORS</CardTitle>
        <p className="text-xs text-muted-foreground">
          Connect Solomon to Slack, Stripe, Gmail, HubSpot, and more via the
          Model Context Protocol. Each connector spawns a local MCP server
          process when started; stop it to release credentials. Credentials
          live only in your local SQLite — nothing is sent off this PC.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {(list.data ?? []).map((c: any) => (
          <div key={c.id} className="rounded-md border border-border p-3 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold text-sm">{c.title}</div>
                <p className="text-xs text-muted-foreground">{c.description}</p>
                <p className="text-[10px] font-mono text-muted-foreground/70 mt-1">{c.npmPackage}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant={c.configured ? "default" : "outline"} className="text-[10px]">
                  {c.configured ? "configured" : "needs config"}
                </Badge>
                <Badge variant={c.running ? "default" : "outline"} className="text-[10px]">
                  {c.running ? "running" : "stopped"}
                </Badge>
                {c.running ? (
                  <Button size="sm" variant="outline" onClick={() => stop.mutate({ id: c.id })}>
                    <PowerOff className="size-3.5" />
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={!c.configured || start.isPending}
                    onClick={() => start.mutate({ id: c.id })}
                  >
                    {start.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Power className="size-3.5" />}
                  </Button>
                )}
              </div>
            </div>
            <div className="grid gap-2">
              {c.envKeys.map((k: any) => {
                const storeKey = `mcp.${c.id}.${k.key}`;
                const cur = map.get(storeKey);
                return (
                  <SettingRow
                    key={storeKey}
                    label={k.label}
                    isSecret={!!k.secret}
                    initial=""
                    placeholder={cur?.hasValue ? "stored — enter to overwrite" : "not set"}
                    badge={cur?.hasValue ? "stored" : "not set"}
                    onSave={(value) =>
                      upsert.mutate({
                        key: storeKey,
                        value,
                        category: "mcp",
                        isSecret: !!k.secret,
                      })
                    }
                  />
                );
              })}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ─── Telegram tab ────────────────────────────────────────────────────────────
function TelegramTab({ map, upsert }: { map: Map<string, any>; upsert: any }) {
  const utils = trpc.useUtils();
  const status = trpc.telegram.status.useQuery(undefined, { refetchInterval: 5000 });
  const start = trpc.telegram.start.useMutation({
    onSuccess: (r) => {
      toast(r.message);
      utils.telegram.status.invalidate();
    },
  });
  const stop = trpc.telegram.stop.useMutation({
    onSuccess: (r) => {
      toast(r.message);
      utils.telegram.status.invalidate();
    },
  });
  const enabled = (map.get("telegram.enabled")?.value || "0") === "1";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm solomon-stencil flex items-center justify-between">
          <span>TELEGRAM BOT</span>
          <Badge variant={status.data?.running ? "default" : "outline"} className="text-[10px]">
            {status.data?.running ? "live" : "stopped"}
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Talk to Solomon from anywhere via Telegram. Create a bot with{" "}
          <code className="font-mono">@BotFather</code>, paste the token below, optionally
          restrict to your Telegram user IDs, then hit "Start bot".
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <SettingRow
          label="Enabled"
          help="Set to 1 to allow bot to start. 0 = off."
          initial={map.get("telegram.enabled")?.value ?? "0"}
          placeholder="0 or 1"
          onSave={(v) =>
            upsert.mutate({ key: "telegram.enabled", value: v, category: "telegram", isSecret: false })
          }
        />
        <SettingRow
          label="Bot token"
          isSecret
          initial=""
          placeholder={map.get("telegram.bot_token")?.hasValue ? "stored — enter to overwrite" : "from @BotFather"}
          badge={map.get("telegram.bot_token")?.hasValue ? "stored" : "not set"}
          onSave={(v) =>
            upsert.mutate({ key: "telegram.bot_token", value: v, category: "telegram", isSecret: true })
          }
        />
        <SettingRow
          label="Allowed user IDs"
          help="Comma-separated. Empty = anyone with the bot link can chat."
          initial={map.get("telegram.allowed_user_ids")?.value ?? ""}
          placeholder="12345678,87654321"
          onSave={(v) =>
            upsert.mutate({
              key: "telegram.allowed_user_ids",
              value: v,
              category: "telegram",
              isSecret: false,
            })
          }
        />
        <div className="flex gap-2 pt-1">
          <Button onClick={() => start.mutate()} disabled={start.isPending || !enabled}>
            {start.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Power className="size-3.5" />}
            <span className="ml-1.5">Start bot</span>
          </Button>
          <Button variant="outline" onClick={() => stop.mutate()} disabled={stop.isPending}>
            <PowerOff className="size-3.5" />
            <span className="ml-1.5">Stop</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Remote Access tab (Tailscale + Cloudflare Tunnel) ───────────────────────
function RemoteAccessTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm solomon-stencil">REMOTE ACCESS — phone & off-site</CardTitle>
        <p className="text-xs text-muted-foreground">
          Two ways to reach Solomon's Forge from your phone or another machine.
          Both are free. <strong>Tailscale is recommended</strong> — it's private (only
          devices on your tailnet can connect) and dead simple.
        </p>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <section>
          <h3 className="font-semibold mb-1">Option A: Tailscale (recommended)</h3>
          <ol className="list-decimal list-inside space-y-1 text-foreground/80 text-xs">
            <li>Run <code className="font-mono">Setup Remote Access (Tailscale).bat</code> from your desktop folder.</li>
            <li>Sign in with Google / Microsoft / GitHub when the browser pops.</li>
            <li>The script prints your <strong>Tailscale IP</strong> (looks like <code>100.x.y.z</code>).</li>
            <li>Install <strong>Tailscale</strong> on your phone (App Store / Play Store) and sign in with the same account.</li>
            <li>From your phone, open <code>http://100.x.y.z:3737</code>. Done.</li>
          </ol>
        </section>

        <section>
          <h3 className="font-semibold mb-1">Option B: Cloudflare Tunnel (public URL)</h3>
          <ol className="list-decimal list-inside space-y-1 text-foreground/80 text-xs">
            <li>Run <code className="font-mono">Setup Remote Access (Cloudflare Tunnel).bat</code>.</li>
            <li>Browse to the URL it prints (e.g. <code>https://abcd1234.trycloudflare.com</code>).</li>
            <li>For private access, attach a Cloudflare Access policy in the Zero Trust dashboard.</li>
          </ol>
        </section>

        <section>
          <h3 className="font-semibold mb-1">Add to Home Screen (PWA)</h3>
          <p className="text-xs text-muted-foreground">
            On your phone, after Solomon's Forge loads, tap the browser menu →
            "Add to Home Screen". You'll get a Solomon's Forge icon that launches
            the dashboard full-screen — same as a native app.
          </p>
        </section>
      </CardContent>
    </Card>
  );
}
