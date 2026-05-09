/**
 * Solomon's Forge — MCP (Model Context Protocol) connector framework.
 *
 * Generic client that can spawn any MCP server (over stdio) and call tools
 * on it. Pre-configured connectors for Slack, Stripe, Google Calendar,
 * Instagram, Zapier, Gmail, HubSpot — each one is just a known npm package
 * name + a config schema (which env vars / OAuth tokens it needs).
 *
 * Per-connector config is stored in the SQLite settings table under keys
 * like "mcp.slack.token", "mcp.slack.enabled". The Settings → Connectors UI
 * reads/writes these and offers Install / Start / Stop buttons.
 *
 * Process lifecycle:
 *   - install   →  `pnpm add -g <package>` (or `npm i -g`) — done by the user
 *                  via the Connector page button.
 *   - start     →  spawn the MCP server as a child process; open an MCP client
 *                  on its stdio; remember it in `running`.
 *   - stop      →  kill the child + close the client.
 *   - call(...) →  forward a tool call to a running connector.
 *
 * Kill-switch aware: every running MCP child registers an AbortController so
 * the red kill button stops them all.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { getDb } from "../db";
import { settings as settingsTable } from "../../drizzle/schema";
import { registerOperation } from "../solomon/killSwitch";

export type ConnectorId =
  | "slack"
  | "stripe"
  | "google-calendar"
  | "instagram"
  | "zapier"
  | "gmail"
  | "hubspot";

export type ConnectorSpec = {
  id: ConnectorId;
  title: string;
  description: string;
  /** npm package that provides the MCP server (run via `npx -y <pkg>` so
   *  install isn't strictly required; just slower on first call). */
  npmPackage: string;
  /** Args to append after the package name. */
  args?: string[];
  /** Environment variables this connector reads. The user fills these in
   *  via the Settings → Connectors UI. */
  envKeys: Array<{ key: string; label: string; secret?: boolean; help?: string }>;
};

export const CONNECTORS: ConnectorSpec[] = [
  {
    id: "slack",
    title: "Slack",
    description: "Read channels, post messages, search workspace history.",
    npmPackage: "@modelcontextprotocol/server-slack",
    envKeys: [
      { key: "SLACK_BOT_TOKEN", label: "Bot User OAuth Token (xoxb-…)", secret: true },
      { key: "SLACK_TEAM_ID", label: "Team / Workspace ID" },
    ],
  },
  {
    id: "stripe",
    title: "Stripe",
    description: "Create customers, payments, invoices; pull balance + transactions.",
    npmPackage: "@stripe/mcp",
    args: ["--tools=all"],
    envKeys: [{ key: "STRIPE_SECRET_KEY", label: "Stripe Secret Key (sk_…)", secret: true }],
  },
  {
    id: "google-calendar",
    title: "Google Calendar",
    description: "Read events, create events, check free/busy.",
    npmPackage: "@cocal/google-calendar-mcp",
    envKeys: [
      { key: "GOOGLE_OAUTH_CLIENT_ID", label: "OAuth Client ID" },
      { key: "GOOGLE_OAUTH_CLIENT_SECRET", label: "OAuth Client Secret", secret: true },
      { key: "GOOGLE_OAUTH_REFRESH_TOKEN", label: "Refresh Token", secret: true },
    ],
  },
  {
    id: "instagram",
    title: "Instagram (Meta Graph)",
    description: "Publish posts, reels, get insights for an IG Business account.",
    npmPackage: "@modelcontextprotocol/server-instagram",
    envKeys: [
      { key: "INSTAGRAM_ACCESS_TOKEN", label: "Long-lived Page Access Token", secret: true },
      { key: "INSTAGRAM_BUSINESS_ID", label: "IG Business Account ID" },
    ],
  },
  {
    id: "zapier",
    title: "Zapier",
    description: "Run any of your Zapier-connected actions from Solomon.",
    npmPackage: "@zapier/mcp",
    envKeys: [{ key: "ZAPIER_API_KEY", label: "Zapier API Key", secret: true }],
  },
  {
    id: "gmail",
    title: "Gmail",
    description: "Read inbox, search, send mail, manage labels.",
    npmPackage: "@gongrzhe/server-gmail-autoauth-mcp",
    envKeys: [
      { key: "GOOGLE_OAUTH_CLIENT_ID", label: "OAuth Client ID" },
      { key: "GOOGLE_OAUTH_CLIENT_SECRET", label: "OAuth Client Secret", secret: true },
      { key: "GOOGLE_OAUTH_REFRESH_TOKEN", label: "Refresh Token", secret: true },
    ],
  },
  {
    id: "hubspot",
    title: "HubSpot",
    description: "Manage contacts, companies, deals, pipelines.",
    npmPackage: "@hubspot/mcp-server",
    envKeys: [{ key: "HUBSPOT_PRIVATE_APP_TOKEN", label: "Private App Token", secret: true }],
  },
];

// ─── Lifecycle ───────────────────────────────────────────────────────────────

type RunningConnector = {
  id: ConnectorId;
  child: ChildProcessWithoutNullStreams;
  startedAt: Date;
  killHandle: { complete: () => void };
};

const running = new Map<ConnectorId, RunningConnector>();

async function loadConnectorEnv(id: ConnectorId): Promise<Record<string, string>> {
  const db = await getDb();
  if (!db) return {};
  const rows = await db.select().from(settingsTable);
  const map = new Map<string, string>(rows.map((r) => [r.key, r.value ?? ""]));
  const out: Record<string, string> = {};
  const spec = CONNECTORS.find((c) => c.id === id);
  if (!spec) return out;
  for (const k of spec.envKeys) {
    const v = map.get(`mcp.${id}.${k.key}`) || "";
    if (v) out[k.key] = v;
  }
  return out;
}

export async function listConnectorStatus() {
  const db = await getDb();
  const rows = db ? await db.select().from(settingsTable) : [];
  const map = new Map<string, string>(rows.map((r) => [r.key, r.value ?? ""]));
  return CONNECTORS.map((c) => ({
    id: c.id,
    title: c.title,
    description: c.description,
    npmPackage: c.npmPackage,
    envKeys: c.envKeys,
    enabled: map.get(`mcp.${c.id}.enabled`) === "1",
    configured: c.envKeys.every((k) => (map.get(`mcp.${c.id}.${k.key}`) || "").length > 0),
    running: running.has(c.id),
  }));
}

export async function startConnector(id: ConnectorId): Promise<{ ok: boolean; message: string }> {
  const spec = CONNECTORS.find((c) => c.id === id);
  if (!spec) return { ok: false, message: `Unknown connector: ${id}` };
  if (running.has(id)) return { ok: true, message: `${spec.title} already running.` };

  const env = await loadConnectorEnv(id);
  for (const k of spec.envKeys) {
    if (!env[k.key]) {
      return { ok: false, message: `Missing config: ${k.label} for ${spec.title}` };
    }
  }

  // Spawn `npx -y <package> [args]`
  const args = ["-y", spec.npmPackage, ...(spec.args ?? [])];
  const child = spawn(process.platform === "win32" ? "npx.cmd" : "npx", args, {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const ac = new AbortController();
  const killHandle = registerOperation({
    label: `MCP connector: ${spec.title}`,
    kind: "background",
    controller: ac,
  });
  ac.signal.addEventListener("abort", () => {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  });

  child.on("exit", () => {
    running.delete(id);
    killHandle.complete();
  });
  child.stderr.on("data", (b) => {
    // eslint-disable-next-line no-console
    console.warn(`[MCP:${id}]`, b.toString().trim());
  });

  running.set(id, { id, child, startedAt: new Date(), killHandle });
  return { ok: true, message: `${spec.title} started.` };
}

export async function stopConnector(id: ConnectorId): Promise<{ ok: boolean; message: string }> {
  const r = running.get(id);
  if (!r) return { ok: true, message: `Not running.` };
  try {
    r.child.kill();
  } catch {
    /* ignore */
  }
  r.killHandle.complete();
  running.delete(id);
  return { ok: true, message: `${id} stopped.` };
}

/**
 * Generic call into a running MCP connector. Speaks the JSON-RPC framing
 * the MCP SDK uses (one JSON line per message over stdio).
 *
 * For the v1 release we expose this as a low-level escape hatch; the tool
 * registry picks specific high-value calls (e.g. slack_post_message,
 * gcal_create_event) and exposes them as Solomon tools.
 */
export async function callConnectorTool(id: ConnectorId, toolName: string, args: any): Promise<any> {
  const r = running.get(id);
  if (!r) throw new Error(`Connector ${id} is not running.`);
  const reqId = Date.now() + Math.floor(Math.random() * 1000);
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: reqId,
    method: "tools/call",
    params: { name: toolName, arguments: args },
  });

  return new Promise((resolve, reject) => {
    const onData = (buf: Buffer) => {
      const lines = buf.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.id === reqId) {
            r.child.stdout.off("data", onData);
            if (msg.error) reject(new Error(msg.error.message || "MCP error"));
            else resolve(msg.result);
          }
        } catch {
          /* not JSON, ignore */
        }
      }
    };
    r.child.stdout.on("data", onData);
    r.child.stdin.write(payload + "\n");
    setTimeout(() => {
      r.child.stdout.off("data", onData);
      reject(new Error(`MCP call timeout: ${id}.${toolName}`));
    }, 30_000);
  });
}
