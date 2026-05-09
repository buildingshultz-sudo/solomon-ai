/**
 * Solomon's Forge — YouTube SEO (vidIQ replacement).
 *
 * Uses the official YouTube Data API v3 (free, 10k unit/day quota) plus
 * lightweight scoring formulas to give:
 *
 *   - Keyword score:        proxy "search volume" + competition + opportunity
 *   - Channel analytics:    subs, views, recent uploads, avg views/upload
 *   - Competitor analysis:  top channels for a query + what they post
 *   - SEO recommendations:  title/desc/tag suggestions for a topic
 *
 * Config:
 *   settings: youtube.api_key   (Google Cloud Console — YouTube Data API v3)
 *
 * No vidIQ scraping; everything here is on the official, supported API.
 */
import { getDb } from "../db";
import { settings as settingsTable } from "../../drizzle/schema";

const YT = "https://www.googleapis.com/youtube/v3";

async function apiKey(): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("DB not ready");
  const rows = await db.select().from(settingsTable);
  const map = new Map<string, string>(rows.map((r) => [r.key, r.value ?? ""]));
  const k = map.get("youtube.api_key") || process.env.YOUTUBE_API_KEY || "";
  if (!k) throw new Error("YouTube API key not set. Settings → Connectors → YouTube SEO.");
  return k;
}

async function ytGet(endpoint: string, params: Record<string, string>): Promise<any> {
  const key = await apiKey();
  const u = new URL(`${YT}/${endpoint}`);
  for (const [k, v] of Object.entries({ ...params, key })) u.searchParams.set(k, v);
  const r = await fetch(u.toString());
  if (!r.ok) throw new Error(`YouTube API ${endpoint} ${r.status}: ${await r.text()}`);
  return r.json();
}

// ─── Keyword score ───────────────────────────────────────────────────────────

export async function keywordScore(keyword: string) {
  // Pull top 50 results for the keyword + grab their stats.
  const search = await ytGet("search", {
    part: "snippet",
    q: keyword,
    type: "video",
    maxResults: "50",
    order: "relevance",
  });
  const ids = (search.items as any[]).map((i) => i.id.videoId).filter(Boolean);
  if (ids.length === 0) {
    return {
      keyword,
      searchVolumeProxy: 0,
      competitionScore: 0,
      opportunityScore: 0,
      sampleResults: [],
      summary: "No results — keyword may be too niche.",
    };
  }
  const stats = await ytGet("videos", { part: "statistics,snippet", id: ids.join(",") });
  const items = stats.items as any[];

  const totalViews = items.reduce((s, v) => s + Number(v.statistics?.viewCount || 0), 0);
  const avgViews = totalViews / items.length;
  const median = items
    .map((v) => Number(v.statistics?.viewCount || 0))
    .sort((a, b) => a - b)[Math.floor(items.length / 2)];

  // "Volume" proxy = log10 of total views in top 50 (capped 0–100).
  const searchVolumeProxy = Math.min(100, Math.round((Math.log10(totalViews + 1) / 9) * 100));

  // Competition = how many of the top 50 come from very large channels.
  const channelIds = Array.from(new Set(items.map((v) => v.snippet?.channelId).filter(Boolean)));
  const channels = await ytGet("channels", {
    part: "statistics",
    id: channelIds.slice(0, 50).join(","),
  });
  const subMap = new Map<string, number>();
  for (const c of channels.items as any[]) {
    subMap.set(c.id, Number(c.statistics?.subscriberCount || 0));
  }
  const bigChannelShare =
    items.filter((v) => (subMap.get(v.snippet?.channelId) || 0) > 100_000).length / items.length;
  const competitionScore = Math.round(bigChannelShare * 100);

  // Opportunity = high volume - high competition (clamped 0–100).
  const opportunityScore = Math.max(0, Math.min(100, searchVolumeProxy - competitionScore + 50));

  return {
    keyword,
    searchVolumeProxy,
    competitionScore,
    opportunityScore,
    avgViewsTop50: Math.round(avgViews),
    medianViewsTop50: median,
    sampleResults: items.slice(0, 5).map((v) => ({
      title: v.snippet?.title,
      channel: v.snippet?.channelTitle,
      views: Number(v.statistics?.viewCount || 0),
      videoId: v.id,
    })),
    summary: `${searchVolumeProxy >= 60 ? "High" : searchVolumeProxy >= 30 ? "Medium" : "Low"} search volume, ${
      competitionScore >= 60 ? "heavy" : competitionScore >= 30 ? "moderate" : "light"
    } competition. Opportunity ${opportunityScore}/100.`,
  };
}

// ─── Channel analytics ───────────────────────────────────────────────────────

export async function channelAnalytics(channelHandleOrId: string) {
  // Resolve handle → channel ID if needed.
  let channelId = channelHandleOrId;
  if (channelHandleOrId.startsWith("@") || channelHandleOrId.startsWith("http")) {
    const handle = channelHandleOrId.replace(/^@/, "").replace(/^https?:\/\/[^/]+\//, "").replace(/^@/, "");
    const r = await ytGet("search", { part: "snippet", q: handle, type: "channel", maxResults: "1" });
    channelId = (r.items as any[])?.[0]?.snippet?.channelId || channelHandleOrId;
  }

  const ch = await ytGet("channels", { part: "snippet,statistics,contentDetails", id: channelId });
  const c = (ch.items as any[])[0];
  if (!c) throw new Error(`Channel not found: ${channelHandleOrId}`);

  const uploadsPlaylist = c.contentDetails.relatedPlaylists.uploads;
  const recent = await ytGet("playlistItems", {
    part: "snippet,contentDetails",
    playlistId: uploadsPlaylist,
    maxResults: "20",
  });
  const recentVidIds = (recent.items as any[]).map((i) => i.contentDetails.videoId);
  const recentStats = recentVidIds.length
    ? await ytGet("videos", { part: "statistics,snippet", id: recentVidIds.join(",") })
    : { items: [] };
  const recentVideos = (recentStats.items as any[]).map((v) => ({
    title: v.snippet?.title,
    publishedAt: v.snippet?.publishedAt,
    views: Number(v.statistics?.viewCount || 0),
    likes: Number(v.statistics?.likeCount || 0),
    comments: Number(v.statistics?.commentCount || 0),
    videoId: v.id,
  }));
  const totalRecentViews = recentVideos.reduce((s, v) => s + v.views, 0);
  const avgRecentViews = recentVideos.length ? Math.round(totalRecentViews / recentVideos.length) : 0;

  return {
    channel: {
      id: c.id,
      title: c.snippet.title,
      description: c.snippet.description,
      thumbnail: c.snippet.thumbnails?.high?.url,
      country: c.snippet.country,
      subscribers: Number(c.statistics.subscriberCount || 0),
      totalViews: Number(c.statistics.viewCount || 0),
      videoCount: Number(c.statistics.videoCount || 0),
    },
    recentVideos,
    insights: {
      avgViewsLast20: avgRecentViews,
      bestRecent: recentVideos.slice().sort((a, b) => b.views - a.views)[0] ?? null,
      uploadCadenceDays: estimateCadence(recentVideos.map((v) => v.publishedAt)),
    },
  };
}

function estimateCadence(dates: string[]) {
  if (dates.length < 2) return null;
  const ts = dates.map((d) => new Date(d).getTime()).sort((a, b) => b - a);
  const gaps: number[] = [];
  for (let i = 1; i < ts.length; i++) gaps.push((ts[i - 1] - ts[i]) / 86_400_000);
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  return Math.round(avg * 10) / 10;
}

// ─── Competitor analysis ─────────────────────────────────────────────────────

export async function competitorAnalysis(query: string, limit = 10) {
  const r = await ytGet("search", {
    part: "snippet",
    q: query,
    type: "channel",
    maxResults: String(limit),
    order: "relevance",
  });
  const channelIds = (r.items as any[]).map((i) => i.snippet?.channelId).filter(Boolean);
  if (channelIds.length === 0) return { query, competitors: [] };
  const chs = await ytGet("channels", { part: "snippet,statistics", id: channelIds.join(",") });
  const competitors = (chs.items as any[])
    .map((c) => ({
      id: c.id,
      title: c.snippet.title,
      country: c.snippet.country,
      subscribers: Number(c.statistics.subscriberCount || 0),
      totalViews: Number(c.statistics.viewCount || 0),
      videoCount: Number(c.statistics.videoCount || 0),
      avgViewsPerVideo: Math.round(
        Number(c.statistics.viewCount || 0) / Math.max(1, Number(c.statistics.videoCount || 0)),
      ),
    }))
    .sort((a, b) => b.subscribers - a.subscribers);
  return { query, competitors };
}

// ─── Title / description / tag suggestions ───────────────────────────────────

export async function seoSuggestions(topic: string) {
  // Pull top 20 videos for the topic and mine their titles + tags.
  const search = await ytGet("search", {
    part: "snippet",
    q: topic,
    type: "video",
    maxResults: "20",
    order: "viewCount",
  });
  const ids = (search.items as any[]).map((i) => i.id.videoId).filter(Boolean);
  const stats = ids.length
    ? await ytGet("videos", { part: "snippet,statistics", id: ids.join(",") })
    : { items: [] };
  const items = stats.items as any[];

  const tagFreq = new Map<string, number>();
  for (const v of items) {
    for (const t of v.snippet?.tags || []) {
      const k = (t as string).toLowerCase();
      tagFreq.set(k, (tagFreq.get(k) || 0) + 1);
    }
  }
  const topTags = Array.from(tagFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([tag, count]) => ({ tag, count }));

  const titleHooks = items
    .filter((v) => Number(v.statistics?.viewCount || 0) > 50_000)
    .slice(0, 8)
    .map((v) => v.snippet?.title);

  return {
    topic,
    suggestedTitles: titleHooks,
    suggestedTags: topTags,
    descriptionTemplate:
      `${topic} — by Building Shultz / Irish Craftsman.\n\n` +
      `In this video: [hook in 1 sentence].\n\n` +
      `Chapters:\n00:00 Intro\n\n` +
      `Tools & gear: [links]\n\n` +
      `Subscribe: [channel URL]\n\n` +
      `Tags: ${topTags.slice(0, 10).map((t) => "#" + t.tag.replace(/\s+/g, "")).join(" ")}`,
  };
}
