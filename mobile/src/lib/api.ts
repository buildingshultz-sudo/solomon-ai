/**
 * Solomon's Forge mobile — thin tRPC-over-HTTP client.
 *
 * The desktop server's tRPC procedures are exposed at /trpc/<procedure>.
 * For the mobile app we don't pull in @trpc/client (heavy); we just call
 * the JSON endpoints directly. Auth is bypassed in local mode (the server
 * sets x-solomon-local-mode automatically).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "solomon.serverUrl";

export async function getServerUrl(): Promise<string> {
  const v = await AsyncStorage.getItem(KEY);
  return v ?? "http://100.64.0.1:3737";
}

export async function setServerUrl(url: string): Promise<void> {
  await AsyncStorage.setItem(KEY, url.replace(/\/$/, ""));
}

async function rpc<T = any>(procedure: string, kind: "query" | "mutation", input?: any): Promise<T> {
  const base = await getServerUrl();
  const url = `${base}/trpc/${procedure}`;
  const init: RequestInit = {
    method: kind === "query" ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
  };
  let final = url;
  if (kind === "query" && input !== undefined) {
    final += `?input=${encodeURIComponent(JSON.stringify(input))}`;
  } else if (kind === "mutation") {
    init.body = JSON.stringify(input ?? {});
  }
  const r = await fetch(final, init);
  if (!r.ok) throw new Error(`${procedure} → ${r.status}`);
  const j = await r.json();
  // tRPC v10 wraps results as { result: { data } }
  return (j?.result?.data ?? j) as T;
}

export const api = {
  health: () => rpc("health", "query").catch(() => ({ ok: false })),
  // ─ Chat ─
  chatSend: (message: string) => rpc("chat.send", "mutation", { message }),
  // ─ Tasks ─
  tasksList: () => rpc("tasks.list", "query"),
  taskCreate: (input: { title: string; priority?: string; project?: string }) =>
    rpc("tasks.create", "mutation", input),
  taskComplete: (id: number) => rpc("tasks.complete", "mutation", { id }),
  // ─ Memory ─
  memoryList: () => rpc("memory.list", "query"),
  // ─ Tools ─
  toolsList: () => rpc("tools.list", "query"),
  toolRunsRecent: () => rpc("tools.recentRuns", "query", { limit: 25 }),
  // ─ Finance ─
  financeSummary: () => rpc("finance.summary", "query"),
  // ─ Scheduler ─
  schedulerList: () => rpc("scheduler.list", "query"),
  // ─ Kill switch ─
  killStatus: () => rpc("killSwitch.status", "query"),
  killAll: () => rpc("killSwitch.killAll", "mutation"),
  // ─ Push notification token registration ─
  registerPushToken: (token: string) =>
    rpc("notifications.registerDevice", "mutation", { token, platform: "ios" }).catch(() => null),
};
