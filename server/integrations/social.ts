/**
 * Solomon's Forge — social auto-posting.
 *
 * Three providers, all kill-switch aware:
 *   - facebook.postToPage(pageId, message, imageUrl?)        — Meta Graph API
 *   - instagram.postPhoto(igUserId, imageUrl, caption?)      — Meta Graph API
 *   - tiktok.postVideo(videoUrl, caption?)                   — TikTok Content
 *                                                              Posting API
 *
 * Tokens come from the SQLite settings table:
 *   social.facebook.page_id           e.g. "111122223333"  ("Irish Craftsman")
 *   social.facebook.page_id_2         e.g. "444455556666"  ("Building Shultz")
 *   social.facebook.page_token        long-lived Page Access Token
 *   social.instagram.user_id          IG Business Account ID (numeric)
 *   social.instagram.access_token     long-lived Page Access Token
 *   social.tiktok.access_token        TikTok Content Posting access token
 *   social.tiktok.open_id             TikTok open_id (per-user)
 *
 * For TikTok the user must request access in the TikTok for Developers
 * portal under "Content Posting API" — typically 1–2 weeks. Until granted,
 * postVideo returns a clear "request access" error.
 */
import { getDb } from "../db";
import { settings as settingsTable } from "../../drizzle/schema";
import { registerOperation } from "../solomon/killSwitch";

async function readSettings(): Promise<Map<string, string>> {
  const db = await getDb();
  if (!db) return new Map();
  const rows = await db.select().from(settingsTable);
  return new Map(rows.map((r) => [r.key, r.value ?? ""]));
}

async function abortableFetch(label: string, url: string, init?: RequestInit) {
  const ac = new AbortController();
  const handle = registerOperation({ label, kind: "background", controller: ac });
  try {
    const r = await fetch(url, { ...init, signal: ac.signal });
    return r;
  } finally {
    handle.complete();
  }
}

// ─── Facebook Pages (Meta Graph v21) ─────────────────────────────────────────

export const facebook = {
  async postToPage(opts: { pageKey?: "page_id" | "page_id_2"; message: string; imageUrl?: string }) {
    const s = await readSettings();
    const pageKey = opts.pageKey ?? "page_id";
    const pageId = s.get(`social.facebook.${pageKey}`);
    const token = s.get("social.facebook.page_token");
    if (!pageId || !token) throw new Error("Facebook not configured (page_id + page_token).");

    const base = `https://graph.facebook.com/v21.0/${pageId}`;
    if (opts.imageUrl) {
      const url = `${base}/photos`;
      const params = new URLSearchParams({ url: opts.imageUrl, caption: opts.message, access_token: token });
      const r = await abortableFetch("Facebook page photo", `${url}?${params}`, { method: "POST" });
      if (!r.ok) throw new Error(`FB photo failed: ${r.status} ${await r.text()}`);
      return r.json();
    } else {
      const url = `${base}/feed`;
      const params = new URLSearchParams({ message: opts.message, access_token: token });
      const r = await abortableFetch("Facebook page post", `${url}?${params}`, { method: "POST" });
      if (!r.ok) throw new Error(`FB post failed: ${r.status} ${await r.text()}`);
      return r.json();
    }
  },
};

// ─── Instagram (Meta Graph v21) ──────────────────────────────────────────────
// Two-step publish: create container → publish container.

export const instagram = {
  async postPhoto(opts: { imageUrl: string; caption?: string }) {
    const s = await readSettings();
    const igId = s.get("social.instagram.user_id");
    const token = s.get("social.instagram.access_token");
    if (!igId || !token) throw new Error("Instagram not configured (user_id + access_token).");

    const base = `https://graph.facebook.com/v21.0/${igId}`;
    const containerParams = new URLSearchParams({
      image_url: opts.imageUrl,
      caption: opts.caption ?? "",
      access_token: token,
    });
    const c = await abortableFetch("IG create container", `${base}/media?${containerParams}`, { method: "POST" });
    if (!c.ok) throw new Error(`IG container failed: ${c.status} ${await c.text()}`);
    const { id: containerId } = (await c.json()) as { id: string };

    const publishParams = new URLSearchParams({ creation_id: containerId, access_token: token });
    const p = await abortableFetch(
      "IG publish container",
      `${base}/media_publish?${publishParams}`,
      { method: "POST" },
    );
    if (!p.ok) throw new Error(`IG publish failed: ${p.status} ${await p.text()}`);
    return p.json();
  },

  async postReel(opts: { videoUrl: string; caption?: string }) {
    const s = await readSettings();
    const igId = s.get("social.instagram.user_id");
    const token = s.get("social.instagram.access_token");
    if (!igId || !token) throw new Error("Instagram not configured.");
    const base = `https://graph.facebook.com/v21.0/${igId}`;
    const containerParams = new URLSearchParams({
      media_type: "REELS",
      video_url: opts.videoUrl,
      caption: opts.caption ?? "",
      access_token: token,
    });
    const c = await abortableFetch("IG create reel container", `${base}/media?${containerParams}`, { method: "POST" });
    if (!c.ok) throw new Error(`IG reel container failed: ${c.status} ${await c.text()}`);
    const { id: containerId } = (await c.json()) as { id: string };
    // Reels need a few seconds to encode; poll status until FINISHED (max 60s).
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const st = await abortableFetch(
        "IG reel status",
        `https://graph.facebook.com/v21.0/${containerId}?fields=status_code&access_token=${token}`,
      );
      const j = (await st.json()) as any;
      if (j.status_code === "FINISHED") break;
      if (j.status_code === "ERROR") throw new Error(`IG reel encode error: ${JSON.stringify(j)}`);
    }
    const publishParams = new URLSearchParams({ creation_id: containerId, access_token: token });
    const p = await abortableFetch(
      "IG publish reel",
      `${base}/media_publish?${publishParams}`,
      { method: "POST" },
    );
    if (!p.ok) throw new Error(`IG reel publish failed: ${p.status} ${await p.text()}`);
    return p.json();
  },
};

// ─── TikTok Content Posting API ──────────────────────────────────────────────

export const tiktok = {
  /**
   * Post a video to TikTok via the Content Posting API.
   * Requires "video.publish" scope, granted per-user via TikTok OAuth + an
   * approved sandbox/prod app in the TikTok for Developers portal.
   */
  async postVideo(opts: { videoUrl: string; title?: string; privacyLevel?: "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "SELF_ONLY" }) {
    const s = await readSettings();
    const token = s.get("social.tiktok.access_token");
    if (!token) {
      throw new Error(
        "TikTok not configured. Request access at https://developers.tiktok.com → Content Posting API, " +
          "then paste your access_token in Settings → Connectors → TikTok.",
      );
    }
    const init = await abortableFetch("TikTok init publish", "https://open.tiktokapis.com/v2/post/publish/video/init/", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        post_info: {
          title: opts.title ?? "",
          privacy_level: opts.privacyLevel ?? "SELF_ONLY",
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: "PULL_FROM_URL",
          video_url: opts.videoUrl,
        },
      }),
    });
    if (!init.ok) throw new Error(`TikTok init failed: ${init.status} ${await init.text()}`);
    return init.json();
  },
};
