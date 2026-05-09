import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { Cloud, Cpu, Eye, EyeOff, KeyRound, Save, Settings as SettingsIcon, Sparkles, Zap } from "lucide-react";
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

const ROUTING_KEYS = [
  { key: "routing.fast_model", label: "Fast model", placeholder: "gpt-4o-mini", help: "Used for cheap / quick tasks." },
  { key: "routing.smart_model", label: "Smart model", placeholder: "gpt-4o or gpt-5", help: "Used for complex reasoning." },
  { key: "routing.complexity_threshold", label: "Threshold (0–1)", placeholder: "0.55", help: "Score above this routes to smart." },
];

const API_KEYS = [
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
        <TabsList>
          <TabsTrigger value="provider"><Cpu className="size-3.5 mr-1.5" /> Model Provider</TabsTrigger>
          <TabsTrigger value="routing"><Zap className="size-3.5 mr-1.5" /> Routing</TabsTrigger>
          <TabsTrigger value="keys"><KeyRound className="size-3.5 mr-1.5" /> API keys</TabsTrigger>
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
  const current = (map.get("provider.kind")?.value || "openai") as "openai" | "ollama";
  const [provider, setProvider] = useState<"openai" | "ollama">(current);
  useEffect(() => setProvider(current), [current]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm solomon-stencil">MODEL PROVIDER</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Choose where Solomon does its thinking. <strong>Ollama</strong> runs Llama 3 / Mistral / Qwen locally on this PC — free, offline, zero API cost. <strong>OpenAI</strong> uses the cloud API and charges per token.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                setProvider("ollama");
                upsert.mutate({ key: "provider.kind", value: "ollama", category: "provider", isSecret: false });
              }}
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
              onClick={() => {
                setProvider("openai");
                upsert.mutate({ key: "provider.kind", value: "openai", category: "provider", isSecret: false });
              }}
              className={`flex items-start gap-3 rounded-md border p-4 text-left transition-colors ${provider === "openai" ? "border-primary bg-primary/10" : "border-border hover:bg-accent/40"}`}
            >
              <Cloud className="size-5 text-primary shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-sm">OpenAI (cloud, paid)</div>
                <div className="text-xs text-muted-foreground mt-0.5">Best quality. Requires API key. Costs per request.</div>
              </div>
            </button>
          </div>

          {provider === "ollama" ? (
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
          ) : (
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
                Set your <code>apikey.openai</code> on the <strong>API keys</strong> tab.
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
