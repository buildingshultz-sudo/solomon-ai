'use strict';
// scheduler.js — Cron jobs for Solomon V4.
// Runs on VPS only. NO self-patching. NO Ollama. NO local LLM.
require('dotenv').config();
const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');
const { tasks, mem, budget, db, projectQueue, lessons, featureRequests, nathanInbox, scheduledPosts } = require('./memory');
const { executeTool, TOOL_DEFINITIONS } = require('./tools');
const Anthropic = require('@anthropic-ai/sdk');

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
// ITEM 15B — MORNING BRIEF SEND: 6:00 AM CT daily
// Read the compiled brief and send a formatted summary to Jed via Claude.
// ══════════════════════════════════════════════════════════════════════════
cron.schedule('0 6 * * *', async () => {
  console.log('[SCHEDULER] Morning brief send running (6:00 AM)...');
  try {
    const compiledRaw = mem.get('system', 'morning_brief_compiled');
    const stale = getStaleTaskCount();
    const ytSubs = mem.get('business', 'youtube_subscribers') || 'unknown';

    let briefData;
    if (compiledRaw) {
      try { briefData = JSON.parse(compiledRaw); } catch (_) { briefData = null; }
    }

    let context;
    if (briefData) {
      const activeDesc = briefData.project_status.active
        ? `${briefData.project_status.active.name} (progress: ${briefData.project_status.active.progress}, spent: $${briefData.project_status.active.spent})`
        : 'None';
      const completedDesc = briefData.project_status.completed_last_24h > 0
        ? `${briefData.project_status.completed_last_24h} (${briefData.project_status.completed_names.join(', ')})`
        : '0';
      const featureDesc = briefData.feature_requests.items.map(f => `  - [${f.priority}] ${f.desc}`).join('\n') || '  None';
      const nathanDesc = briefData.nathan_inbox.items.map(m => `  - [${m.priority}] ${m.subject}`).join('\n') || '  None';
      const errorDesc = briefData.errors_24h.length
        ? briefData.errors_24h.map(e => `${e.signature} (x${e.times})`).join(', ')
        : 'None';

      context = `Generate a concise morning brief for Jedidiah Shultz based on this compiled data:

PROJECT STATUS:
- Active project: ${activeDesc}
- Queued apps: ${briefData.project_status.queued_count}
- Completed last 24h: ${completedDesc}

FEATURE REQUESTS (${briefData.feature_requests.pending_count} pending):
${featureDesc}

NATHAN INBOX (${briefData.nathan_inbox.unread_count} unread):
${nathanDesc}

BUDGET: $${briefData.budget.month_total} / $${briefData.budget.hard_stop} this month
ERRORS (24h): ${errorDesc}
PENDING TASKS: ${briefData.pending_tasks}
STALE TASKS (>24h): ${stale}
YouTube subs: ${ytSubs}

Format: Short, bullet points, what needs his attention today. Highlight any urgent items. Keep under 400 words.`;
    } else {
      const pending = tasks.getPending();
      const budgetTotal = budget.getMonthTotal();
      context = `Generate a concise morning brief for Jedidiah Shultz.
Pending tasks: ${pending.length} (${JSON.stringify(pending.slice(0, 3).map(t => t.title))})
Stale tasks (>24h): ${stale}
Month spend: $${budgetTotal.toFixed(2)}
YouTube subs: ${ytSubs}
Format: Short, bullet points, what needs his attention today. Keep under 300 words.`;
    }

    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 600,
      messages: [{ role: 'user', content: context }]
    });

    budget.log({
      inputTokens: resp.usage.input_tokens,
      outputTokens: resp.usage.output_tokens,
      model: MODEL
    });

    const brief = `🌅 *Good Morning Jed*\n${resp.content[0].text}`;
    await bot.sendMessage(OWNER_ID, brief, { parse_mode: 'Markdown' });
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
        const alert =
          `💬 *New Facebook comment* — ${pageInfo.label}\n\n` +
          `*From:* ${c.from}\n` +
          `*Comment:* ${c.text}\n` +
          (c.post_snippet ? `*On post:* ${c.post_snippet}\n` : "") +
          `\n*Suggested reply:*\n${suggestion}\n\n` +
          `_Not posted. To post it, tell me: "reply to FB comment ${c.comment_id} on ${pageInfo.key}: <your text>"._`;
        await bot.sendMessage(OWNER_ID, alert, { parse_mode: "Markdown" }).catch(() =>
          bot.sendMessage(OWNER_ID, alert.replace(/[*_`]/g, "")).catch(() => {})
        );
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

console.log('[SCHEDULER] Running. Cron jobs active:');
console.log('  • Morning brief prep: 5:45 AM CT daily');
console.log('  • Morning brief send: 6:00 AM CT daily');
console.log('  • Shorts check: every 30 minutes');
console.log('  • FB comment monitor: every 5 minutes (suggestion alerts, no auto-post)');
console.log('  • Email triage (IMAP): every 5 minutes');
console.log('  • Scheduled posts publisher: every 5 minutes');
console.log('  • Weekly report: Monday 6:00 AM CT');
console.log('  • Task worker (with exponential backoff): every 5 minutes');
console.log('  • Stale task cleanup: every hour');
console.log('  • App Factory queue check: every 30 minutes (at :15 and :45)');
