'use strict';
// scheduler.js — Cron jobs for Solomon V4.
// Runs on VPS only. NO self-patching. NO Ollama. NO local LLM.
require('dotenv').config();
const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');
const { tasks, mem, budget, db, projectQueue, lessons, featureRequests, nathanInbox, scheduledPosts } = require('./memory');
const { executeTool, TOOL_DEFINITIONS } = require('./tools');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── PENDING-ACTION HELPERS (shared by FB-reply & campaign-preview flows) ────
// Button taps are handled inside bot.js — scheduler only CREATES the action rows
// and persists them in mem('pending_action', id) so the bot can look them up.
// A short hex id keeps callback_data well under Telegram's 64-byte limit.
function newActionId() { return crypto.randomBytes(4).toString('hex'); }

function savePendingAction(id, obj) {
  obj.status = obj.status || 'pending';
  obj.created_at = new Date().toISOString();
  mem.set('pending_action', id, JSON.stringify(obj));
}

function fbReplyKeyboard(id) {
  return { inline_keyboard: [[
    { text: '✅ Post It', callback_data: `act:${id}:post` },
    { text: '✍️ Edit',   callback_data: `act:${id}:edit` }
  ]]};
}

function campaignPreviewKeyboard(id) {
  return { inline_keyboard: [[
    { text: '✅ Post Now', callback_data: `act:${id}:post` },
    { text: '✍️ Edit',    callback_data: `act:${id}:edit` },
    { text: '⏭️ Skip',    callback_data: `act:${id}:skip` }
  ]]};
}

// Cache the YT access token across calls in a single scheduler run so we are
// not refreshing on every cron tick.
let _ytAccessToken = null;
let _ytAccessTokenExpiresAt = 0;
async function getYouTubeAccessToken() {
  const now = Date.now();
  if (_ytAccessToken && now < _ytAccessTokenExpiresAt - 60_000) return _ytAccessToken;
  if (!process.env.YOUTUBE_REFRESH_TOKEN || process.env.YOUTUBE_REFRESH_TOKEN === 'PLACEHOLDER') return null;
  try {
    const r = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: process.env.YOUTUBE_CLIENT_ID,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET,
      refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    }, { timeout: 12000 });
    _ytAccessToken = r.data.access_token;
    _ytAccessTokenExpiresAt = now + (r.data.expires_in || 3600) * 1000;
    return _ytAccessToken;
  } catch (e) {
    console.error('[SCHEDULER] YouTube token refresh failed:', e.response?.data?.error_description || e.message);
    return null;
  }
}

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
const OWNER_ID = parseInt(process.env.OWNER_CHAT_ID);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.MODEL || 'claude-sonnet-4-5-20250929';

console.log('[SCHEDULER] Starting cron jobs...');

// ══════════════════════════════════════════════════════════════════════════
// ITEM 15A — MORNING BRIEF PREPARATION: 5:45 AM CT daily
// Compile all data into a structured brief and store it.
// ══════════════════════════════════════════════════════════════════════════
cron.schedule('45 5 * * *', async () => {
  console.log('[SCHEDULER] Morning brief preparation running (5:45 AM)...');
  try {
    const result = await executeTool('prepare_morning_brief', {});
    if (result.ok) {
      console.log('[SCHEDULER] Morning brief compiled and stored.');
    } else {
      console.error('[SCHEDULER] Morning brief preparation failed:', result.error);
    }
  } catch (err) {
    console.error('[SCHEDULER] Morning brief preparation error:', err.message);
  }
}, { timezone: 'America/Chicago' });

// ══════════════════════════════════════════════════════════════════════════
// ITEM 15B — MORNING BRIEF SEND: 6:00 AM CT daily — scorecard
// A scannable single-message scorecard. Direct, no LLM prose, 30-sec read.
// Pulls live: YT subs+views, Gumroad 24h sales, Spreadshirt (note), campaign
// engagement on most-recent post, budget vs hard stop, KDP yesterday royalty.
// ══════════════════════════════════════════════════════════════════════════
async function buildMorningScorecard() {
  const lines = [];
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'long', month: 'short', day: 'numeric' });
  lines.push(`🌅 *Good Morning Jed — ${dateStr}*`);
  lines.push('');

  // ── YouTube (Building Shultz brand channel, live) ──────────────────────
  let ytLine = '📺 *YouTube*: not connected';
  const accessToken = await getYouTubeAccessToken();
  if (accessToken) {
    try {
      const r = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
        params: { part: 'snippet,statistics', mine: true },
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 12000
      });
      const ch = r.data?.items?.[0];
      if (ch) {
        const title = ch.snippet?.title || '(channel)';
        const subs = ch.statistics?.subscriberCount || '?';
        const views = ch.statistics?.viewCount || '?';
        const videos = ch.statistics?.videoCount || '?';
        ytLine = `📺 *YouTube* (${title}): *${Number(subs).toLocaleString()}* subs · ${Number(views).toLocaleString()} views · ${videos} videos`;
        mem.set('business', 'youtube_subscribers', String(subs));
        mem.set('business', 'youtube_views', String(views));
        mem.set('business', 'youtube_channel_title', title);
      }
    } catch (e) {
      ytLine = `📺 *YouTube*: fetch failed (${(e.response?.data?.error?.message || e.message).slice(0, 80)})`;
    }
  }
  lines.push(ytLine);

  // ── Gumroad (last 24h via activity_log entries written by the webhook) ─
  let gumroadLine = '💰 *Gumroad*: no sales in 24h';
  try {
    const rows = db.prepare(`SELECT summary FROM activity_log WHERE type = 'gumroad_sale' AND timestamp >= datetime('now','-24 hours')`).all();
    if (rows.length) {
      // summaries look like "Product Name USD $9.99"
      let total = 0, count = 0;
      for (const r of rows) {
        const m = (r.summary || '').match(/\$\s*([\d.]+)/);
        if (m) { total += parseFloat(m[1]); count++; }
      }
      gumroadLine = `💰 *Gumroad* (24h): ${count} sale${count === 1 ? '' : 's'} · *$${total.toFixed(2)}*`;
    }
  } catch (e) { gumroadLine = `💰 *Gumroad*: query failed (${e.message.slice(0, 60)})`; }
  lines.push(gumroadLine);

  // ── Spreadshirt — no API on Jed's plan ─────────────────────────────────
  lines.push('🧵 *Spreadshirt*: not connected (no API on current plan)');

  // ── KDP — last scrape result (cron writes mem.kdp.last) ────────────────
  let kdpLine = '📚 *KDP*: not connected — see /root/solomon-v4/PLAYWRIGHT_KDP_AUTH.md to enable';
  try {
    const raw = mem.get('kdp', 'last');
    if (raw) {
      const k = JSON.parse(raw);
      if (k.auth_missing) {
        kdpLine = '📚 *KDP*: auth setup pending (PLAYWRIGHT_KDP_AUTH.md)';
      } else if (k.auth_expired) {
        kdpLine = '📚 *KDP*: auth expired — redo PLAYWRIGHT_KDP_AUTH.md';
      } else if (k.prior_day_royalty) {
        kdpLine = `📚 *KDP* yesterday: *${k.prior_day_royalty}* (${k.currency || 'USD'}, last checked ${k.checked_at?.slice(11, 16) || 'recently'} UTC)`;
      } else if (k.error) {
        kdpLine = `📚 *KDP*: scrape error (${String(k.error).slice(0, 80)})`;
      }
    }
  } catch (_) {}
  lines.push(kdpLine);

  // ── Campaign engagement (last post in social_log) ──────────────────────
  let campaignLine = '📣 *Campaign*: idle';
  try {
    const recent = db.prepare(`SELECT key, value FROM memory WHERE category='social_log' ORDER BY key DESC LIMIT 1`).all();
    if (recent.length) {
      const entry = JSON.parse(recent[0].value || '{}');
      const ts = recent[0].key;
      const when = ts.slice(0, 10);
      const kind = entry.kind || 'post';
      // Try to pull engagement counts from the first FB post id we logged.
      let engagementBits = '';
      const firstFb = (entry.fb || []).find(s => /id (\d+)/.test(s));
      if (firstFb && process.env.FB_BUILDING_SHULTZ_TOKEN && process.env.FB_BUILDING_SHULTZ_TOKEN !== 'PLACEHOLDER') {
        const postId = firstFb.match(/id (\d+(_\d+)?)/)?.[1];
        if (postId) {
          try {
            const er = await axios.get(`https://graph.facebook.com/v19.0/${postId}`, {
              params: { fields: 'reactions.summary(true).limit(0),comments.summary(true).limit(0),shares', access_token: process.env.FB_BUILDING_SHULTZ_TOKEN },
              timeout: 8000
            });
            const reactions = er.data?.reactions?.summary?.total_count ?? '?';
            const comments = er.data?.comments?.summary?.total_count ?? '?';
            const shares = er.data?.shares?.count ?? 0;
            engagementBits = ` · 👍 ${reactions} · 💬 ${comments} · 🔁 ${shares}`;
          } catch (_) { engagementBits = ' · engagement unavailable'; }
        }
      }
      campaignLine = `📣 *Campaign* (${kind}, ${when})${engagementBits}`;
    }
  } catch (_) {}
  lines.push(campaignLine);

  // ── Budget vs $100 hard stop ───────────────────────────────────────────
  const monthSpend = budget.getMonthTotal();
  const hardStop = parseFloat(process.env.MONTHLY_BUDGET_HARD_STOP || '100');
  const pct = Math.min(100, Math.round((monthSpend / hardStop) * 100));
  const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
  const budgetWarn = pct >= 80 ? '  ⚠️' : '';
  lines.push(`💵 *Budget*: $${monthSpend.toFixed(2)} / $${hardStop.toFixed(0)} (${pct}%) ${bar}${budgetWarn}`);
  lines.push('');

  // ── What needs attention today ─────────────────────────────────────────
  const pendingCount = tasks.getPending().length;
  const stale = getStaleTaskCount();
  const unreadInbox = nathanInbox.getUnread().length;
  const queueCount = projectQueue.getQueued ? projectQueue.getQueued().length : 0;
  lines.push(`📋 *Today*: ${pendingCount} pending task${pendingCount === 1 ? '' : 's'}${stale ? ` (${stale} stale)` : ''} · ${unreadInbox} unread inbox · ${queueCount} queued project${queueCount === 1 ? '' : 's'}`);

  return lines.join('\n');
}

cron.schedule('0 6 * * *', async () => {
  console.log('[SCHEDULER] Morning brief send running (6:00 AM)...');
  try {
    const scorecard = await buildMorningScorecard();
    await bot.sendMessage(OWNER_ID, scorecard, { parse_mode: 'Markdown' })
      .catch(() => bot.sendMessage(OWNER_ID, scorecard.replace(/[*_`]/g, '')));
    console.log('[SCHEDULER] Morning brief sent');
  } catch (err) {
    console.error('[SCHEDULER] Morning brief failed:', err.message);
    bot.sendMessage(OWNER_ID, `⚠️ Morning brief failed: ${err.message.slice(0, 200)}`).catch(() => {});
  }
}, { timezone: 'America/Chicago' });

// ══════════════════════════════════════════════════════════════════════════
// ITEM 16 — SHORTS CHECK: Every 30 minutes
// Scan D:\RawFootage\Inbox for new files. Skip gracefully if PC relay not connected.
// ══════════════════════════════════════════════════════════════════════════
cron.schedule('*/30 * * * *', async () => {
  console.log('[SCHEDULER] Shorts check running...');

  if (!process.env.PC_RELAY_URL || process.env.PC_RELAY_URL === 'PLACEHOLDER') {
    console.log('[SCHEDULER] Shorts check skipped — PC relay not configured');
    return;
  }

  try {
    const result = await executeTool('pc_list_files', { path: 'D:\\RawFootage\\Inbox' });

    if (!result.ok) {
      console.log('[SCHEDULER] Shorts check skipped — PC relay unreachable:', result.error);
      return;
    }

    const files = result.files || [];
    if (!files.length) {
      console.log('[SCHEDULER] Shorts check: no new files in Inbox');
      return;
    }

    const videoExts = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
    const videoFiles = files.filter(f => {
      const name = (f.Name || '').toLowerCase();
      return videoExts.some(ext => name.endsWith(ext));
    });

    if (videoFiles.length > 0) {
      const fileList = videoFiles.map(f => f.Name).join(', ');
      await bot.sendMessage(OWNER_ID,
        `📹 *New footage detected*\n${videoFiles.length} video file(s) in D:\\RawFootage\\Inbox:\n${fileList}`,
        { parse_mode: 'Markdown' }
      );
      console.log(`[SCHEDULER] Shorts check: ${videoFiles.length} new video files found`);
    } else {
      console.log(`[SCHEDULER] Shorts check: ${files.length} files but no videos`);
    }
  } catch (err) {
    console.log('[SCHEDULER] Shorts check error (skipping):', err.message);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// ITEM 16B — FACEBOOK COMMENTS MONITOR: Every 5 minutes
// Check Building Shultz and Irish Craftsman pages for new comments.
// For each NEW comment, alert the owner on Telegram with the commenter name,
// the comment text, and a Claude-generated reply SUGGESTION. Does NOT auto-post —
// the owner reviews and can ask Solomon to post via the reply_fb_comment tool.
// ══════════════════════════════════════════════════════════════════════════
cron.schedule("*/5 * * * *", async () => {
  const pages = [
    { key: "building_shultz", label: "Building Shultz", token_env: "FB_BUILDING_SHULTZ_TOKEN" },
    { key: "irish_craftsman", label: "Irish Craftsman", token_env: "FB_IRISH_CRAFTSMAN_TOKEN" }
  ];
  for (const pageInfo of pages) {
    const token = process.env[pageInfo.token_env];
    if (!token || token === "PLACEHOLDER") continue;
    try {
      const result = await executeTool("get_fb_comments", { page: pageInfo.key, post_limit: 5 });
      if (!result.ok || !result.new_comments || result.new_comments.length === 0) continue;
      console.log(`[SCHEDULER] FB comments: ${result.new_comments.length} new on ${pageInfo.key}`);
      for (const c of result.new_comments) {
        // Generate a reply SUGGESTION only — text, never auto-posted.
        let suggestion = "(could not generate a suggestion)";
        try {
          const sugResp = await anthropic.messages.create({
            model: MODEL,
            max_tokens: 400,
            system: "You are Solomon, Jed Shultz's AI chief-of-staff, drafting a reply suggestion to a Facebook comment on one of his business pages (Building Shultz or Irish Craftsman). Write ONE warm, professional, engaging reply (1-3 sentences) that Jed could post as-is. Output only the reply text — no preamble, no quotation marks, no alternatives.",
            messages: [{ role: "user", content: `Page: ${pageInfo.label}\nPost: "${c.post_snippet}"\nCommenter: ${c.from}\nComment: "${c.text}"\n\nDraft a suggested reply.` }]
          });
          const txt = (sugResp.content.find(b => b.type === "text") || {}).text;
          if (txt && txt.trim()) suggestion = txt.trim();
        } catch (sugErr) {
          console.error(`[SCHEDULER] FB suggestion error (${pageInfo.key}):`, sugErr.message);
        }
        // Heuristic flag for sensitive comments — these still require manual review,
        // we WON'T attach a one-tap post button to those.
        const sensitive = /\b(refund|lawsuit|sue|legal|attorney|stole|scam|fraud|hate|kill|threat)\b/i.test(c.text || '');
        const alert =
          `💬 *New Facebook comment* — ${pageInfo.label}\n\n` +
          `*From:* ${c.from}\n` +
          `*Comment:* ${c.text}\n` +
          (c.post_snippet ? `*On post:* ${c.post_snippet}\n` : "") +
          `\n*Suggested reply:*\n${suggestion}` +
          (sensitive ? `\n\n⚠️ *Flagged sensitive (refund/legal/etc.) — manual reply only, no auto-post button.*` : '');
        if (sensitive) {
          await bot.sendMessage(OWNER_ID, alert, { parse_mode: "Markdown" }).catch(() =>
            bot.sendMessage(OWNER_ID, alert.replace(/[*_`]/g, "")).catch(() => {})
          );
        } else {
          const actionId = newActionId();
          savePendingAction(actionId, {
            type: 'fb_reply',
            payload: {
              page: pageInfo.key,
              page_label: pageInfo.label,
              comment_id: c.comment_id,
              commenter: c.from,
              comment_text: c.text,
              suggestion
            }
          });
          await bot.sendMessage(OWNER_ID, alert, {
            parse_mode: "Markdown",
            reply_markup: fbReplyKeyboard(actionId)
          }).catch(() =>
            bot.sendMessage(OWNER_ID, alert.replace(/[*_`]/g, ""), { reply_markup: fbReplyKeyboard(actionId) }).catch(() => {})
          );
        }
      }
    } catch (err) {
      console.error(`[SCHEDULER] FB comment monitor error (${pageInfo.key}):`, err.message);
    }
  }
});


// ══════════════════════════════════════════════════════════════════════════
// ITEM 16D — EMAIL TRIAGE: Every 5 minutes
// Poll buildingshultz@gmail.com over IMAP, classify each NEW email with Claude
// (urgent | normal | newsletter), and Telegram-alert the owner for urgent/normal
// with sender, subject, a one-sentence summary, and the classification.
// Newsletters / marketing are logged to the console only (no alert).
// ══════════════════════════════════════════════════════════════════════════
cron.schedule("*/5 * * * *", async () => {
  try {
    const result = await executeTool("check_inbox", {});
    if (!result.ok) { console.error("[SCHEDULER] Email triage:", result.error); return; }
    if (!result.new_emails || result.new_emails.length === 0) return;
    console.log(`[SCHEDULER] Email triage: ${result.new_emails.length} new email(s)`);
    for (const em of result.new_emails) {
      let classification = "normal";
      let summary = "";
      try {
        const cls = await anthropic.messages.create({
          model: MODEL,
          max_tokens: 300,
          system: "You triage incoming email for Jed Shultz, a construction business owner. Classify the email as exactly one of: urgent, normal, newsletter. urgent = needs prompt human action (client emergency, time-sensitive job/payment/legal/scheduling, upset customer). normal = real correspondence worth knowing about but not an emergency. newsletter = marketing, promotions, automated digests, receipts, or no-reply blasts. Respond with ONLY compact JSON: {\"classification\":\"urgent|normal|newsletter\",\"summary\":\"one sentence describing the email\"}.",
          messages: [{ role: "user", content: `From: ${em.from_name} <${em.from_email}>\nSubject: ${em.subject}\n\nBody:\n${em.body_snippet || "(no body)"}` }]
        });
        const txt = (cls.content.find(b => b.type === "text") || {}).text || "";
        const m = txt.match(/\{[\s\S]*\}/);
        if (m) {
          const j = JSON.parse(m[0]);
          if (j.classification) classification = String(j.classification).toLowerCase().trim();
          summary = j.summary || "";
        }
      } catch (e) {
        console.error("[SCHEDULER] Email classify error:", e.message);
      }
      // Log every email; newsletters are silently logged here (no Telegram alert).
      console.log(`[EMAIL] ${classification.toUpperCase()} | from=${em.from_name} | subj=${em.subject}`);
      // Lightweight triage stats for /status
      try {
        const bump = (k) => mem.set("email_stats", k, String((parseInt(mem.get("email_stats", k), 10) || 0) + 1));
        bump("total"); bump(classification);
        mem.set("email_stats", "last_email_at", new Date().toISOString());
      } catch (_) {}
      // Revenue / subscription detection → append (append-only) to master context REVENUE log.
      // Runs regardless of classification so a sale email is never missed.
      try {
        const hay = `${em.from_email || ""} ${em.from_name || ""} ${em.subject || ""}`.toLowerCase();
        if (/gumroad|stripe|paypal|\bpayout\b|you (made|received) a sale|new sale|payment (received|succeeded)|order confirm|subscription|invoice|receipt|renewed|cancell?ed/.test(hay)) {
          await executeTool("append_master_context", {
            section: "REVENUE",
            entry: `Revenue/billing email from ${em.from_name || em.from_email}: "${(em.subject || "").slice(0, 120)}"`
          }).catch(() => {});
        }
      } catch (_) {}
      if (classification === "newsletter") continue;
      const icon = classification === "urgent" ? "🚨" : "📧";
      const alert =
        `${icon} *${classification.toUpperCase()} email*\n\n` +
        `*From:* ${em.from_name}\n` +
        `*Subject:* ${em.subject}\n` +
        `*Summary:* ${summary || "(no summary)"}`;
      await bot.sendMessage(OWNER_ID, alert, { parse_mode: "Markdown" }).catch(() =>
        bot.sendMessage(OWNER_ID, alert.replace(/[*_`]/g, "")).catch(() => {}));
    }
  } catch (err) {
    console.error("[SCHEDULER] Email triage error:", err.message);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// ITEM 16C — SCHEDULED POSTS PUBLISHER: Every 5 minutes
// Publish any social posts whose scheduled_for time has passed.
// ══════════════════════════════════════════════════════════════════════════
cron.schedule("*/5 * * * *", async () => {
  const due = scheduledPosts.getDue();
  if (!due.length) return;
  console.log(`[SCHEDULER] Scheduled posts: ${due.length} due`);
  for (const post of due) {
    try {
      const result = await executeTool("social_post", {
        page: post.page,
        platform: post.platform || "facebook",
        message: post.message,
        link: post.link || undefined,
        image_url: post.image_url || undefined
      });
      if (result.ok) {
        scheduledPosts.markPosted(post.id, result.post_id);
        await bot.sendMessage(OWNER_ID,
          `✅ *Scheduled post published* (${post.page} / ${post.platform})\n"${post.message.slice(0, 100)}..."`,
          { parse_mode: "Markdown" }
        ).catch(() => {});
        console.log(`[SCHEDULER] Scheduled post ${post.id} published: ${result.post_id}`);
      } else {
        scheduledPosts.markFailed(post.id, result.error);
        await bot.sendMessage(OWNER_ID,
          `❌ *Scheduled post failed* (${post.page}): ${result.error}`,
          { parse_mode: "Markdown" }
        ).catch(() => {});
        console.error(`[SCHEDULER] Scheduled post ${post.id} failed: ${result.error}`);
      }
    } catch (err) {
      scheduledPosts.markFailed(post.id, err.message);
      console.error(`[SCHEDULER] Scheduled post ${post.id} error: ${err.message}`);
    }
  }
});


// ══════════════════════════════════════════════════════════════════════════
// ITEM 21 — WEEKLY REVENUE REPORT: Monday 6 AM CT
// Gumroad + Spreadshirt + Amazon Associates P&L to Telegram. Streams without
// configured credentials are reported as "not connected".
// ══════════════════════════════════════════════════════════════════════════
cron.schedule('0 6 * * 1', async () => {
  console.log('[SCHEDULER] Monday 6 AM — weekly revenue report running...');
  try {
    const r = await executeTool('weekly_revenue_report', {});
    if (r && r.report) {
      await bot.sendMessage(OWNER_ID, r.report, { parse_mode: 'Markdown' })
        .catch(() => bot.sendMessage(OWNER_ID, r.report.replace(/[*_`]/g, '')).catch(() => {}));
      console.log('[SCHEDULER] Weekly revenue report sent (total $' + (r.total || 0) + ')');
    } else {
      console.error('[SCHEDULER] Weekly revenue report: no report returned', r && r.error);
    }
  } catch (err) {
    console.error('[SCHEDULER] Weekly revenue report error:', err.message);
  }
}, { timezone: 'America/Chicago' });

// ══════════════════════════════════════════════════════════════════════════
// ITEM 17 — WEEKLY REPORT: Monday 6 AM CT
// Tasks completed, failed, budget, growth metrics.
// ══════════════════════════════════════════════════════════════════════════
cron.schedule('0 6 * * 1', async () => {
  console.log('[SCHEDULER] Weekly report running...');
  try {
    const budgetTotal = budget.getMonthTotal();
    const allTasks = tasks.getAll();
    const completed = allTasks.filter(t => t.status === 'complete').length;
    const failed = allTasks.filter(t => t.status === 'failed').length;
    const pending = allTasks.filter(t => t.status === 'pending').length;
    const ytSubs = mem.get('business', 'youtube_subscribers') || 'unknown';

    const report = [
      `📊 *Weekly Report — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}*`,
      ``,
      `*Tasks:*`,
      `  ✅ Completed: ${completed}`,
      `  ❌ Failed: ${failed}`,
      `  ⏳ Pending: ${pending}`,
      ``,
      `*Budget:*`,
      `  💰 Month spend: $${budgetTotal.toFixed(2)}`,
      ``,
      `*Growth:*`,
      `  📺 YouTube subs: ${ytSubs}`,
    ].join('\n');

    await bot.sendMessage(OWNER_ID, report, { parse_mode: 'Markdown' });
    console.log('[SCHEDULER] Weekly report sent');
  } catch (err) {
    console.error('[SCHEDULER] Weekly report failed:', err.message);
    bot.sendMessage(OWNER_ID, `⚠️ Weekly report failed: ${err.message.slice(0, 200)}`).catch(() => {});
  }
}, { timezone: 'America/Chicago' });

// ══════════════════════════════════════════════════════════════════════════
// ITEM 18 — AUTO-RETRY FAILED TASKS: Every 5 minutes
// Exponential backoff: retry after 5m, 25m, 125m (5^n minutes).
// Max 3 retries enforced by tasks.getPending() which filters retries < 3.
// ══════════════════════════════════════════════════════════════════════════
cron.schedule('*/5 * * * *', async () => {
  const pending = tasks.getPending();
  if (!pending.length) return;
  const task = pending[0];
  if (task.retries > 0 && task.started_at) {
    const lastAttempt = new Date(task.started_at).getTime();
    const backoffMinutes = Math.pow(5, task.retries);
    const waitUntil = lastAttempt + (backoffMinutes * 60 * 1000);
    if (Date.now() < waitUntil) {
      console.log(`[WORKER] Task #${task.id} backing off (retry ${task.retries}, wait ${backoffMinutes}m)`);
      return;
    }
  }
  console.log(`[WORKER] Starting task #${task.id}: ${task.title} (retry ${task.retries}/3)`);
  tasks.start(task.id);
  try {
    // Worker system prompt — gives Solomon context for background task execution
    const workerSystem = `You are Solomon, an autonomous AI agent executing a background task for Jedidiah Shultz (Shultz Enterprises).
You have full tool access. Use your tools to ACTUALLY complete the task — do not just describe what you would do.
Rules:
1. You MUST call tools to complete work. Text-only responses = failure.
2. After completing, provide a brief summary of what you actually did.
3. If a task requires PC access, use the pc_* tools. If it requires VPS work, use vps_execute or file_write/file_edit.
4. Budget awareness: keep costs minimal. Do not make unnecessary API calls.
5. If you cannot complete the task, explain exactly why and what's blocking you.`;

    // Agentic tool-use loop (same pattern as bot.js)
    let messages = [{ role: 'user', content: `Execute this task:\n\nTitle: ${task.title}\nDescription: ${task.description}\nType: ${task.type || 'general'}\nPriority: ${task.priority || 5}` }];
    let totalInput = 0;
    let totalOutput = 0;
    let iterations = 0;
    const MAX_ITERATIONS = 10;

    while (iterations < MAX_ITERATIONS) {
      iterations++;
      const resp = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: workerSystem,
        tools: TOOL_DEFINITIONS,
        messages: messages
      });
      totalInput += resp.usage.input_tokens;
      totalOutput += resp.usage.output_tokens;

      // If no tool use, we're done
      if (resp.stop_reason !== 'tool_use') {
        const textBlock = resp.content.find(b => b.type === 'text');
        const result = textBlock ? textBlock.text : 'Task completed (no text response)';
        budget.log({ inputTokens: totalInput, outputTokens: totalOutput, model: MODEL });
        tasks.complete(task.id, result);
        bot.sendMessage(OWNER_ID, `✅ Task #${task.id} done: ${task.title}\n${result.slice(0, 300)}`).catch(() => {});
        console.log(`[WORKER] Task #${task.id} completed in ${iterations} iteration(s)`);
        return;
      }

      // Process tool calls
      messages.push({ role: 'assistant', content: resp.content });
      const toolResults = [];
      for (const block of resp.content) {
        if (block.type === 'tool_use') {
          console.log(`[WORKER] Tool call: ${block.name} ${JSON.stringify(block.input).slice(0, 100)}`);
          try {
            const toolResult = await executeTool(block.name, block.input);
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(toolResult).slice(0, 4000) });
          } catch (toolErr) {
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ ok: false, error: toolErr.message }), is_error: true });
          }
        }
      }
      messages.push({ role: 'user', content: toolResults });
    }

    // If we hit max iterations, mark as done with warning
    budget.log({ inputTokens: totalInput, outputTokens: totalOutput, model: MODEL });
    tasks.complete(task.id, `Completed after ${MAX_ITERATIONS} iterations (may be partial)`);
    bot.sendMessage(OWNER_ID, `⚠️ Task #${task.id} hit iteration limit: ${task.title}`).catch(() => {});
    console.log(`[WORKER] Task #${task.id} hit max iterations`);
  } catch (err) {
    console.error(`[WORKER] Task #${task.id} failed:`, err.message);
    const retries = tasks.incrementRetry(task.id);
    if (retries >= 3) {
      tasks.fail(task.id, `Max retries reached: ${err.message}`);
      bot.sendMessage(OWNER_ID, `❌ Task #${task.id} failed after 3 retries: ${task.title}\n${err.message.slice(0, 150)}`).catch(() => {});
    } else {
      const nextBackoff = Math.pow(5, retries);
      bot.sendMessage(OWNER_ID, `⚠️ Task #${task.id} retry ${retries}/3 (next attempt in ${nextBackoff}m): ${task.title}`).catch(() => {});
    }
  }
})

// ══════════════════════════════════════════════════════════════════════════
// ITEM 19 — STALE TASK CLEANUP: Every hour
// Mark tasks pending > 24 hours as stale, notify Jed.
// ══════════════════════════════════════════════════════════════════════════
function getStaleTaskCount() {
  const stale = db.prepare(
    "SELECT COUNT(*) as count FROM tasks WHERE status='pending' AND created_at < datetime('now', '-24 hours')"
  ).get();
  return stale ? stale.count : 0;
}

cron.schedule('0 * * * *', async () => {
  console.log('[SCHEDULER] Stale task cleanup running...');
  try {
    const staleTasks = db.prepare(
      "SELECT * FROM tasks WHERE status='pending' AND created_at < datetime('now', '-24 hours')"
    ).all();

    if (!staleTasks.length) {
      console.log('[SCHEDULER] No stale tasks');
      return;
    }

    for (const task of staleTasks) {
      tasks.fail(task.id, 'Marked stale: pending > 24 hours without completion');
    }

    const staleList = staleTasks.map(t => `  • #${t.id}: ${t.title}`).join('\n');
    await bot.sendMessage(OWNER_ID,
      `⏰ *Stale Tasks Cleaned*\n${staleTasks.length} task(s) pending > 24h marked as stale:\n${staleList}`,
      { parse_mode: 'Markdown' }
    );
    console.log(`[SCHEDULER] Marked ${staleTasks.length} tasks as stale`);
  } catch (err) {
    console.error('[SCHEDULER] Stale cleanup failed:', err.message);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// PHASE 8 — APP FACTORY SCHEDULER (every 30 minutes, offset by 15 min)
// Checks project_queue for next queued app, starts building if none active.
// ══════════════════════════════════════════════════════════════════════════
cron.schedule('15,45 * * * *', async () => {
  console.log('[APP-FACTORY] Queue check running...');
  try {
    const active = projectQueue.getActive();
    if (active) {
      console.log(`[APP-FACTORY] Project "${active.app_name}" is active (phase ${active.phases_complete}/${active.phases_total}). Skipping.`);
      return;
    }

    const next = projectQueue.getNext();
    if (!next) {
      console.log('[APP-FACTORY] No queued projects. Idle.');
      return;
    }

    console.log(`[APP-FACTORY] Starting project: ${next.app_name} (type: ${next.app_type}, budget: $${next.budget_usd})`);

    const monthTotal = budget.getMonthTotal();
    if (monthTotal >= parseFloat(process.env.MONTHLY_BUDGET_HARD_STOP || '100')) {
      console.log('[APP-FACTORY] Monthly budget exceeded. Cannot start new project.');
      await bot.sendMessage(OWNER_ID, `⚠️ App Factory: Cannot start "${next.app_name}" — monthly budget exceeded ($${monthTotal.toFixed(2)})`);
      return;
    }

    const pastLessons = lessons.getTop(5);
    console.log(`[APP-FACTORY] Loaded ${pastLessons.length} past lessons for context.`);

    projectQueue.start(next.app_name);

    await bot.sendMessage(OWNER_ID,
      `🏭 *App Factory Started*\nProject: ${next.app_name}\nType: ${next.app_type}\nBudget: $${next.budget_usd}\nBrief: ${next.brief.slice(0, 200)}`,
      { parse_mode: 'Markdown' }
    );

    const templateResult = await executeTool('select_template', {
      app_type: next.app_type,
      app_name: next.app_name
    });

    if (!templateResult.ok) {
      console.error(`[APP-FACTORY] Template selection failed for ${next.app_name}:`, templateResult.error);
      projectQueue.block(next.app_name);
      await bot.sendMessage(OWNER_ID, `❌ App Factory: Template copy failed for "${next.app_name}": ${templateResult.error}`);
      return;
    }

    projectQueue.updateProgress(next.app_name, 1, 0);
    console.log(`[APP-FACTORY] Template copied for ${next.app_name}. Phase 1/6 complete.`);

    tasks.add({
      title: `Build app: ${next.app_name}`,
      description: `Continue building "${next.app_name}" (${next.app_type}).
Brief: ${next.brief}
Template has been copied to D:\\Projects\\${next.app_name}.
Past lessons: ${pastLessons.map(l => l.what_worked).filter(Boolean).join('; ').slice(0, 500)}

Steps remaining:
1. npm install in project directory
2. Implement the app according to the brief
3. Run tests (vitest/jest based on type)
4. Git commit and push
5. Deploy (${next.app_type === 'react-web' ? 'Vercel' : next.app_type === 'electron-react' ? 'npm run dist' : next.app_type === 'node-api' ? 'DigitalOcean App' : 'eas build'})
6. Mark complete

Per-project budget: $${next.budget_usd}. Alert at $${(next.budget_usd * 0.8).toFixed(0)} (80%). Hard stop at $${next.budget_usd}.
ALWAYS call write_lesson after completing.`,
      type: 'pc_task',
      priority: 2
    });

  } catch (err) {
    console.error('[APP-FACTORY] Error:', err.message);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// ITEM 20 — STARTUP SELF-TEST
// Verifies all scheduler components are working on startup.
// ══════════════════════════════════════════════════════════════════════════
setTimeout(async () => {
  console.log('[SCHEDULER] Startup self-test...');
  try {
    const pending = tasks.getPending();
    const budgetTotal = budget.getMonthTotal();
    const stale = getStaleTaskCount();
    const queuedApps = projectQueue.getByStatus('queued');
    const activeApp = projectQueue.getActive();
    const pendingFeatures = featureRequests.getPending();
    const nathanUnread = nathanInbox.getUnread();
    console.log(`[SCHEDULER] Self-test PASS — Pending: ${pending.length}, Budget: $${budgetTotal.toFixed(4)}, Stale: ${stale}`);
    console.log(`[SCHEDULER] App Factory — Queued: ${queuedApps.length}, Active: ${activeApp ? activeApp.app_name : 'none'}`);
    console.log(`[SCHEDULER] Phase 8B — Feature requests: ${pendingFeatures.length}, Nathan inbox: ${nathanUnread.length}`);
    console.log('[SCHEDULER] All cron jobs registered and active.');
  } catch (err) {
    console.error('[SCHEDULER] Self-test FAILED:', err.message);
  }
}, 3000);

// ══════════════════════════════════════════════════════════════════════════
// ITEM 17 — 30-DAY BOOK & MERCH CAMPAIGN: Facebook auto-post at 7 AM & 6 PM CT
// Reads campaign_30day_book_merch.md. Gated behind /launch (mem campaign.active).
// Facebook posts auto; Instagram + YouTube community versions go to Telegram.
// ══════════════════════════════════════════════════════════════════════════
function loadCampaignDays() {
  try {
    const fp = path.join(__dirname, 'campaign_30day_book_merch.md');
    if (!fs.existsSync(fp)) return [];
    const lines = fs.readFileSync(fp, 'utf8').split(/\r?\n/);
    const days = []; let cur = null;
    for (const line of lines) {
      const m = line.match(/^###\s*DAY\s*(\d+)\s*[—\-:]\s*(.*)$/i);
      if (m) { if (cur) days.push(cur); cur = { day: parseInt(m[1], 10), title: m[2].trim(), morning: '', evening: '' }; continue; }
      if (!cur) continue;
      const mm = line.match(/^MORNING:\s*(.*)$/i); if (mm) { cur.morning = mm[1].trim(); continue; }
      const me = line.match(/^EVENING:\s*(.*)$/i); if (me) { cur.evening = me[1].trim(); continue; }
    }
    if (cur) days.push(cur);
    return days;
  } catch (_) { return []; }
}

// Campaign preview + auto-post flow:
//   • At T-30min  → previewCampaignSlot(slot) generates variants, sends Telegram
//                   preview with ✅/✍️/⏭️ buttons, persists action with deadline
//                   = T-5min so the post fires at the original slot time (within
//                   25 min of preview, per spec).
//   • Button taps are handled in bot.js (callback_query).
//   • If status is still 'pending' past deadline_ts, the watcher cron below
//     auto-fires the post so the schedule never breaks.
async function previewCampaignSlot(slot) {
  try {
    if (mem.get('campaign', 'active') !== 'true') return;
    const startStr = mem.get('campaign', 'start_date');
    if (!startStr) return;
    const start = new Date(startStr + 'T00:00:00');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dayIndex = Math.round((today - start) / 86400000) + 1;
    if (dayIndex < 1) return;
    const days = loadCampaignDays();
    if (dayIndex > 30 || dayIndex > days.length) {
      mem.set('campaign', 'active', 'false');
      await bot.sendMessage(OWNER_ID, '🏁 30-day book & merch campaign complete. Auto-posting stopped.').catch(() => {});
      return;
    }
    const plan = days.find(d => d.day === dayIndex);
    if (!plan) return;
    const brief = slot === 'morning' ? plan.morning : plan.evening;
    if (!brief) return;
    console.log(`[SCHEDULER] Campaign day ${dayIndex}/30 (${slot}) PREVIEW...`);

    let variants;
    try {
      const resp = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1500,
        system: "You are Solomon, social media manager for Jed Shultz's brand Building Shultz, running a launch campaign for his book 'Motivation for Tough Guys' and the Building Shultz Gear merch line. Voice: direct, practical, no fluff, grounded in real jobsite experience; blue-collar and motivational, never corporate. Use a 'link in bio' style CTA (no fake URLs). Return ONLY compact JSON with keys \"facebook\" (1-2 short paragraphs + a clear CTA), \"instagram_caption\" (punchy, scannable, a few tasteful emoji), \"instagram_hashtags\" (8-15 relevant hashtags, space-separated), \"youtube_community\" (short community post ending with a question). No preamble, no code fences.",
        messages: [{ role: 'user', content: `Day ${dayIndex} of 30 — ${plan.title}\nSlot: ${slot}\nPost brief: ${brief}` }]
      });
      budget.log({ inputTokens: resp.usage.input_tokens, outputTokens: resp.usage.output_tokens, model: MODEL });
      const txt = (resp.content.find(b => b.type === 'text') || {}).text || '';
      const mt = txt.match(/\{[\s\S]*\}/);
      variants = mt ? JSON.parse(mt[0]) : null;
    } catch (e) {
      console.error('[SCHEDULER] Campaign generate error:', e.message);
      await bot.sendMessage(OWNER_ID, `⚠️ Campaign day ${dayIndex} (${slot}) preview generation failed: ${e.message.slice(0, 120)}`).catch(() => {});
      return;
    }
    if (!variants || !variants.facebook) {
      await bot.sendMessage(OWNER_ID, `⚠️ Campaign day ${dayIndex} (${slot}): could not parse post content.`).catch(() => {});
      return;
    }

    // Build the pending action — auto-fires 25 min from now if Jed doesn't tap.
    const actionId = newActionId();
    const deadlineTs = Date.now() + 25 * 60 * 1000;
    savePendingAction(actionId, {
      type: 'campaign_preview',
      deadline_ts: deadlineTs,
      payload: {
        dayIndex, slot, title: plan.title,
        facebook: variants.facebook,
        instagram_caption: variants.instagram_caption || '',
        instagram_hashtags: variants.instagram_hashtags || '',
        youtube_community: variants.youtube_community || '',
        label: `Campaign Day ${dayIndex} (${slot})`
      }
    });

    const previewMsg =
      `📅 *Campaign Day ${dayIndex}/30 — ${slot}* preview\n_${plan.title}_\n\n` +
      `📘 *Facebook (will auto-post to BOTH pages in 25 min unless you tap):*\n${variants.facebook}\n\n` +
      `📸 *Instagram caption (handback — paste manually):*\n${variants.instagram_caption || ''}\n${variants.instagram_hashtags || ''}\n\n` +
      `▶️ *YouTube community (handback):*\n${variants.youtube_community || ''}`;
    await bot.sendMessage(OWNER_ID, previewMsg, {
      parse_mode: 'Markdown',
      reply_markup: campaignPreviewKeyboard(actionId)
    }).catch(() => bot.sendMessage(OWNER_ID, previewMsg.replace(/[*_`]/g, ''), { reply_markup: campaignPreviewKeyboard(actionId) }));

    console.log(`[SCHEDULER] Campaign day ${dayIndex} (${slot}) preview sent — action ${actionId}, deadline ${new Date(deadlineTs).toISOString()}`);
  } catch (err) {
    console.error('[SCHEDULER] Campaign preview error:', err.message);
  }
}

// Executes the actual FB auto-post for a campaign action and writes the
// social_log. Used by both the auto-post watcher (timeout fallback) and the
// callback handler in bot.js (Jed tapped ✅). Idempotent via status flag.
async function executeCampaignActionFromScheduler(actionId, action, reason) {
  const p = action.payload;
  const fbResults = [];
  for (const [pageKey, label] of [['building_shultz', 'Building Shultz'], ['irish_craftsman', 'Irish Craftsman']]) {
    try {
      const r = await executeTool('social_post', { page: pageKey, platform: 'facebook', message: p.facebook });
      fbResults.push(`${r.ok ? '✅' : '❌'} ${label}${r.ok ? ` (id ${r.post_id})` : `: ${r.error || 'failed'}`}`);
    } catch (e) { fbResults.push(`❌ ${label}: ${e.message.slice(0, 80)}`); }
  }
  action.status = 'posted';
  action.posted_at = new Date().toISOString();
  action.posted_reason = reason;
  mem.set('pending_action', actionId, JSON.stringify(action));
  try { mem.set('social_log', new Date().toISOString(), JSON.stringify({ kind: `campaign d${p.dayIndex} ${p.slot}`, fb: fbResults })); } catch (_) {}
  const summary = `📅 *Day ${p.dayIndex}/30 — ${p.slot}* auto-posted (${reason}):\n${fbResults.join('\n')}`;
  await bot.sendMessage(OWNER_ID, summary, { parse_mode: 'Markdown' })
    .catch(() => bot.sendMessage(OWNER_ID, summary.replace(/[*_`]/g, '')));
  console.log(`[SCHEDULER] Campaign action ${actionId} auto-posted (${reason}): ${fbResults.join('; ')}`);
}

// 30 min EARLIER than the prior 7:00 AM / 6:00 PM CT slots → preview at 6:30 AM
// and 5:30 PM CT. Auto-post fires 25 min later via the watcher = 6:55 AM / 5:55 PM
// CT, ~5 min before the original schedule.
cron.schedule('30 6 * * *', () => previewCampaignSlot('morning'), { timezone: 'America/Chicago' });
cron.schedule('30 17 * * *', () => previewCampaignSlot('evening'), { timezone: 'America/Chicago' });

// Watcher — every minute, look for pending campaign_preview actions past
// deadline_ts and auto-post them. Survives bot restarts because state is in mem.
cron.schedule('* * * * *', async () => {
  try {
    const rows = db.prepare(`SELECT key, value FROM memory WHERE category='pending_action'`).all();
    const now = Date.now();
    for (const r of rows) {
      let a; try { a = JSON.parse(r.value); } catch (_) { continue; }
      if (a.type !== 'campaign_preview') continue;
      if (a.status !== 'pending') continue;
      if (!a.deadline_ts || a.deadline_ts > now) continue;
      try { await executeCampaignActionFromScheduler(r.key, a, 'no response in 25 min'); }
      catch (e) { console.error('[SCHEDULER] auto-post failed for', r.key, e.message); }
    }
  } catch (err) {
    console.error('[SCHEDULER] campaign watcher error:', err.message);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// ITEM 18 — CONTEXT BRIEF: regenerate context.md at 5:00 AM CT daily.
// (Major events also regenerate it on the fly via the update_context tool.)
// ══════════════════════════════════════════════════════════════════════════
cron.schedule('0 5 * * *', async () => {
  console.log('[SCHEDULER] 5 AM — regenerating context.md + master context heartbeat...');
  try {
    const r = await executeTool('update_context', {});
    console.log('[SCHEDULER] context.md:', r.ok ? (r.bytes + ' bytes') : r.error);
  } catch (err) {
    console.error('[SCHEDULER] context.md update error:', err.message);
  }
  // Daily heartbeat into the permanent master context (append-only).
  await executeTool('append_master_context', { section: 'GENERAL', entry: 'Daily 5 AM check-in — context refreshed; Solomon online.' }).catch(() => {});
}, { timezone: 'America/Chicago' });

// ══════════════════════════════════════════════════════════════════════════
// ITEM 19 — COMMIT WATCHER: every 15 min, log new GitHub commits to master context.
// Detects "a new feature built and committed" by watching the HEAD commit hash.
// ══════════════════════════════════════════════════════════════════════════
cron.schedule('*/15 * * * *', () => {
  try {
    const head = execSync('git -C /root/solomon-v4 rev-parse --short HEAD', { timeout: 8000 }).toString().trim();
    if (!head) return;
    const last = mem.get('context', 'last_seen_commit');
    if (head !== last) {
      if (last) { // skip first run — just record the baseline so we don't log existing HEAD as "new"
        let subj = '';
        try { subj = execSync('git -C /root/solomon-v4 log -1 --pretty=%s', { timeout: 8000 }).toString().trim(); } catch (_) {}
        executeTool('append_master_context', { section: 'PROJECTS', entry: `Feature shipped — commit ${head}: ${subj.slice(0, 140)}` }).catch(() => {});
      }
      mem.set('context', 'last_seen_commit', head);
    }
  } catch (_) {}
});

// Generate context.md shortly after startup so the file always exists and is fresh.
setTimeout(() => {
  executeTool('update_context', {})
    .then(r => console.log('[SCHEDULER] context.md ready:', r.ok ? (r.bytes + ' bytes') : r.error))
    .catch(e => console.error('[SCHEDULER] context.md startup gen error:', e.message));
}, 6000);

// ══════════════════════════════════════════════════════════════════════════
// ITEM 20 — PC QUEUE DRAIN: every 1 min. When Cowork is idle, drain queued
// pc_* tool calls (queued in tools.js while Cowork was busy) and notify Jed
// of each result on Telegram. The queue lives in mem(category='pc_queue').
// ══════════════════════════════════════════════════════════════════════════
function _coworkBusyNow() {
  try {
    const u = mem.get('pc_lock', 'cowork_busy_until');
    return !!(u && new Date(u).getTime() > Date.now());
  } catch (_) { return false; }
}
cron.schedule('* * * * *', async () => {
  try {
    if (_coworkBusyNow()) return; // still busy — try again next minute
    const entries = mem.getCategory('pc_queue').sort((a, b) => a.key.localeCompare(b.key));
    if (!entries.length) return;
    for (const e of entries.slice(0, 5)) { // cap at 5 per minute to be gentle
      let req; try { req = JSON.parse(e.value); } catch (_) { mem.delete('pc_queue', e.key); continue; }
      console.log(`[SCHEDULER] Draining queued PC action: ${req.tool}`);
      const r = await executeTool(req.tool, req.input || {}).catch(err => ({ ok: false, error: err.message }));
      mem.delete('pc_queue', e.key);
      const head = r.ok ? '✅' : '❌';
      const body = r.ok
        ? `(queued at ${String(req.queued_at).slice(0,16).replace('T',' ')})`
        : `${(r.error || 'failed').slice(0, 160)}`;
      bot.sendMessage(OWNER_ID, `${head} *Queued PC action ran:* ${req.tool}\n${body}`, { parse_mode: 'Markdown' })
        .catch(() => bot.sendMessage(OWNER_ID, `${head} Queued PC action ran: ${req.tool}\n${body}`).catch(() => {}));
    }
  } catch (err) {
    console.error('[SCHEDULER] PC queue drain error:', err.message);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// ITEM 22 — YOUTUBE MILESTONE MONITOR: every 6 hours. Alerts at 500/750/1000
// subs and 2000/4000 watch hours, each fires once. First run after deploy
// silently baselines so already-crossed thresholds don't fire retroactively.
// ══════════════════════════════════════════════════════════════════════════
cron.schedule('0 */6 * * *', async () => {
  try {
    const r = await executeTool('youtube_milestones', {});
    if (r && r.baseline_set) console.log('[SCHEDULER] YT milestones baseline set (no retroactive alerts).');
    for (const f of ((r && r.fired) || [])) {
      const label = f.metric === 'subs' ? `${f.threshold.toLocaleString()} subscribers` : `${f.threshold.toLocaleString()} watch hours`;
      const cur = Math.round(f.current);
      const msg = `🎉 *YouTube milestone — ${label}!*\nBuilding Shultz crossed ${label} (current: ${cur.toLocaleString()} ${f.metric === 'subs' ? 'subs' : 'hours'}).`;
      await bot.sendMessage(OWNER_ID, msg, { parse_mode: 'Markdown' })
        .catch(() => bot.sendMessage(OWNER_ID, msg.replace(/[*_`]/g, '')).catch(() => {}));
      try { await executeTool('append_master_context', { section: 'GENERAL', entry: `YT milestone crossed: ${label}` }); } catch (_) {}
    }
    if (r && r.hours_error) console.log('[SCHEDULER] YT watch hours unavailable:', String(r.hours_error).slice(0, 120));
  } catch (err) {
    console.error('[SCHEDULER] YT milestone check error:', err.message);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// KDP DAILY SCRAPE: 5:50 AM CT — runs just before the 6 AM brief reads it.
// ══════════════════════════════════════════════════════════════════════════
cron.schedule('50 5 * * *', async () => {
  console.log('[SCHEDULER] KDP daily scrape running...');
  try {
    const r = await executeTool('kdp_check_royalties', { save_to_mem: true });
    if (r.ok) console.log('[SCHEDULER] KDP yesterday royalty:', r.prior_day_royalty || '(none parsed)');
    else console.log('[SCHEDULER] KDP scrape returned:', r.error);
  } catch (e) {
    console.error('[SCHEDULER] KDP scrape exception:', e.message);
    try { mem.set('kdp', 'last', JSON.stringify({ ok: false, error: e.message, checked_at: new Date().toISOString() })); } catch (_) {}
  }
}, { timezone: 'America/Chicago' });

// ══════════════════════════════════════════════════════════════════════════
// WEEKLY CONTENT REPURPOSING: Monday 7 AM CT
// Pick the top-viewed Building Shultz YouTube video from the past 7 days,
// pull its auto-caption transcript, and have Claude produce three repurposed
// outputs in Jed's voice. Delivers all three to Telegram for him to approve.
// ══════════════════════════════════════════════════════════════════════════
async function runWeeklyRepurpose() {
  console.log('[SCHEDULER] Weekly content repurpose running...');
  const accessToken = await getYouTubeAccessToken();
  if (!accessToken) {
    await bot.sendMessage(OWNER_ID, '⚠️ Weekly repurpose skipped — YouTube OAuth not connected. Visit /oauth/start to authorize.').catch(() => {});
    return;
  }
  try {
    // 1. Find my uploads playlist
    const chResp = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
      params: { part: 'contentDetails', mine: true },
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 12000
    });
    const uploadsPl = chResp.data?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPl) throw new Error('Could not find uploads playlist');

    // 2. List most recent uploads, filter to last 7 days, get IDs
    const plResp = await axios.get('https://www.googleapis.com/youtube/v3/playlistItems', {
      params: { part: 'snippet,contentDetails', playlistId: uploadsPl, maxResults: 25 },
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 12000
    });
    const cutoff = Date.now() - 7 * 86400000;
    const recent = (plResp.data?.items || []).filter(it => new Date(it.snippet?.publishedAt || 0).getTime() >= cutoff);
    if (recent.length === 0) {
      await bot.sendMessage(OWNER_ID, '📭 Weekly repurpose: no Building Shultz videos uploaded in the past 7 days. Skipped.').catch(() => {});
      return;
    }
    const videoIds = recent.map(it => it.contentDetails?.videoId).filter(Boolean);

    // 3. Pull view counts for those videos, pick top
    const vidsResp = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: { part: 'snippet,statistics', id: videoIds.join(',') },
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 12000
    });
    const ranked = (vidsResp.data?.items || []).sort((a, b) => (parseInt(b.statistics?.viewCount || 0) - parseInt(a.statistics?.viewCount || 0)));
    const top = ranked[0];
    if (!top) throw new Error('No videos returned');
    const topId = top.id, topTitle = top.snippet?.title || '(untitled)', topViews = top.statistics?.viewCount || '0';

    // 4. Fetch caption track list, pick first available (auto-generated usually first)
    let transcript = '';
    try {
      const capResp = await axios.get('https://www.googleapis.com/youtube/v3/captions', {
        params: { part: 'snippet', videoId: topId },
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 12000
      });
      const tracks = capResp.data?.items || [];
      const track = tracks.find(t => t.snippet?.trackKind === 'asr') || tracks[0];
      if (track) {
        // captions.download returns SRT/text; we ask for raw SBV-style text via tfmt
        const dl = await axios.get(`https://www.googleapis.com/youtube/v3/captions/${track.id}`, {
          params: { tfmt: 'srt' },
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: 15000,
          responseType: 'text'
        });
        transcript = String(dl.data || '')
          .replace(/^\d+\s*$/gm, '')
          .replace(/\d{2}:\d{2}:\d{2}[,.]\d{3} --> \d{2}:\d{2}:\d{2}[,.]\d{3}/g, '')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
      }
    } catch (capErr) {
      console.error('[SCHEDULER] caption fetch failed:', capErr.response?.data?.error?.message || capErr.message);
    }
    if (!transcript) {
      await bot.sendMessage(OWNER_ID, `📭 Weekly repurpose: could not fetch a transcript for "${topTitle}" (auto-captions may not be ready). Skipped this week.`).catch(() => {});
      return;
    }
    // Trim transcript so we stay well under token limits
    const transcriptClipped = transcript.length > 18000 ? transcript.slice(0, 18000) + '\n[...transcript truncated]' : transcript;

    // 5. One Claude call → three outputs
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2400,
      system: "You are Solomon, content repurposing engine for Jedidiah Shultz / Building Shultz. Voice rules: direct, blue-collar, no fluff, plainspoken, motivational, never corporate. Always end pieces with the tag line 'Be Inspired. Stay Humble. And Build.' Output ONLY compact JSON with these three keys, no preamble, no code fences: \"shorts_script\" (60-second YouTube Shorts script with [HOOK], [BEATS] bullet timeline, [CTA] — tight, actionable, written for camera), \"facebook_post\" (1-2 short paragraphs that stand alone on FB), \"newsletter_snippet\" (a 3-5 line snippet that opens an email update — first-person, conversational).",
      messages: [{ role: 'user', content: `Source: Building Shultz YouTube video\nTitle: ${topTitle}\nViews (7-day): ${topViews}\n\nTRANSCRIPT:\n${transcriptClipped}` }]
    });
    budget.log({ inputTokens: resp.usage.input_tokens, outputTokens: resp.usage.output_tokens, model: MODEL });
    const txt = (resp.content.find(b => b.type === 'text') || {}).text || '';
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Claude did not return parseable JSON');
    const outputs = JSON.parse(m[0]);

    const header = `♻️ *Weekly repurpose — top video of last 7 days*\n_${topTitle}_ (${Number(topViews).toLocaleString()} views)\nReview each below, edit if needed, then post manually.`;
    await bot.sendMessage(OWNER_ID, header, { parse_mode: 'Markdown' }).catch(() => bot.sendMessage(OWNER_ID, header.replace(/[*_`]/g, '')));
    const send = (m) => bot.sendMessage(OWNER_ID, m, { parse_mode: 'Markdown' }).catch(() => bot.sendMessage(OWNER_ID, m.replace(/[*_`]/g, '')));
    await send(`🎬 *Shorts script (60 sec):*\n\n${outputs.shorts_script || '(empty)'}`);
    await send(`📘 *Facebook post:*\n\n${outputs.facebook_post || '(empty)'}`);
    await send(`📧 *Newsletter snippet:*\n\n${outputs.newsletter_snippet || '(empty)'}`);
    console.log('[SCHEDULER] Weekly repurpose sent for:', topTitle);
  } catch (err) {
    console.error('[SCHEDULER] Weekly repurpose failed:', err.message);
    await bot.sendMessage(OWNER_ID, `⚠️ Weekly repurpose failed: ${err.message.slice(0, 200)}`).catch(() => {});
  }
}
cron.schedule('0 7 * * 1', runWeeklyRepurpose, { timezone: 'America/Chicago' });

console.log('[SCHEDULER] Running. Cron jobs active:');
console.log('  • Morning brief prep: 5:45 AM CT daily');
console.log('  • Morning brief send: 6:00 AM CT daily (now a live scorecard: YT/Gumroad/KDP/campaign/budget)');
console.log('  • KDP daily royalty scrape: 5:50 AM CT (just before the brief)');
console.log('  • Shorts check: every 30 minutes');
console.log('  • FB comment monitor: every 5 minutes (✅/✍️ inline buttons; sensitive comments stay manual)');
console.log('  • Email triage (IMAP): every 5 minutes');
console.log('  • Book & merch campaign PREVIEW: 6:30 AM + 5:30 PM CT (✅/✍️/⏭️ buttons; auto-posts at +25 min if no tap)');
console.log('  • Campaign auto-post watcher: every minute (deadline-driven)');
console.log('  • Weekly content repurpose: Monday 7 AM CT (top YT video → Shorts/FB/newsletter)');
console.log('  • Context brief (context.md): 5 AM CT daily + on major events');
console.log('  • Master context (shultz_master_context.md): append-only; 5 AM + sales/commits/events');
console.log('  • Commit watcher: every 15 min (logs new commits to master context)');
console.log('  • PC queue drain: every 1 min (when Cowork is idle)');
console.log('  • YouTube milestone monitor: every 6 hours (alerts at 500/750/1000 subs, 2000/4000 watch hrs)');
console.log('  • Scheduled posts publisher: every 5 minutes');
console.log('  • Weekly report (tasks/budget): Monday 6:00 AM CT');
console.log('  • Weekly revenue report (Gumroad/Spreadshirt/Amazon): Monday 6:00 AM CT');
console.log('  • Task worker (with exponential backoff): every 5 minutes');
console.log('  • Stale task cleanup: every hour');
console.log('  • App Factory queue check: every 30 minutes (at :15 and :45)');
