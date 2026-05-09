import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { Eye, EyeOff, KeyRound, Save, Settings as SettingsIcon, Sparkles, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

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

      <Tabs defaultValue="routing">
        <TabsList>
          <TabsTrigger value="routing"><Zap className="size-3.5 mr-1.5" /> Routing</TabsTrigger>
          <TabsTrigger value="keys"><KeyRound className="size-3.5 mr-1.5" /> API keys</TabsTrigger>
          <TabsTrigger value="system"><Sparkles className="size-3.5 mr-1.5" /> System</TabsTrigger>
        </TabsList>

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
                Solomon runs the brain on the platform's built-in LLM by default. If you set <code className="font-mono">apikey.openai</code> here, the self-hosted Docker build will use OpenAI directly with that key.
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
