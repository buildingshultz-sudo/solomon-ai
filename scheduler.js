'use strict';
// scheduler.js — Cron jobs for Solomon V4.
// Runs on VPS only. NO self-patching. NO Ollama. NO local LLM.
require('dotenv').config();
const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');
const { tasks, mem, budget, db } = require('./memory');
const { executeTool } = require('./tools');
const Anthropic = require('@anthropic-ai/sdk');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
const OWNER_ID = parseInt(process.env.OWNER_CHAT_ID);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.MODEL || 'claude-sonnet-4-5-20250929';

console.log('[SCHEDULER] Starting cron jobs...');

// ══════════════════════════════════════════════════════════════════════════
// ITEM 15 — MORNING BRIEF: 4:00 AM CT daily
// Summarize pending tasks, budget, channel stats.
// ══════════════════════════════════════════════════════════════════════════
cron.schedule('0 4 * * *', async () => {
  console.log('[SCHEDULER] Morning brief running...');
  try {
    const pending = tasks.getPending();
    const budgetTotal = budget.getMonthTotal();
    const ytSubs = mem.get('business', 'youtube_subscribers') || 'unknown';
    const stale = getStaleTaskCount();

    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `Generate a concise morning brief for Jedidiah Shultz.
Pending tasks: ${pending.length} (${JSON.stringify(pending.slice(0, 3).map(t => t.title))})
Stale tasks (>24h): ${stale}
Month spend: $${budgetTotal.toFixed(2)}
YouTube subs: ${ytSubs}
Format: Short, bullet points, what needs his attention today. Keep under 300 words.`
      }]
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

  // Skip gracefully if PC relay not configured
  if (!process.env.PC_RELAY_URL || process.env.PC_RELAY_URL === 'PLACEHOLDER') {
    console.log('[SCHEDULER] Shorts check skipped — PC relay not configured');
    return;
  }

  try {
    const result = await executeTool('pc_list_files', { path: 'D:\\RawFootage\\Inbox' });

    if (!result.ok) {
      // PC relay unreachable — skip gracefully, do NOT alert every 30 min
      console.log('[SCHEDULER] Shorts check skipped — PC relay unreachable:', result.error);
      return;
    }

    const files = result.files || [];
    if (!files.length) {
      console.log('[SCHEDULER] Shorts check: no new files in Inbox');
      return;
    }

    // Filter for video files
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
    // Graceful skip — don't spam errors if PC is offline
    console.log('[SCHEDULER] Shorts check error (skipping):', err.message);
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

  // Take highest priority task
  const task = pending[0];

  // Exponential backoff: skip if not enough time has passed since last attempt
  if (task.retries > 0 && task.started_at) {
    const lastAttempt = new Date(task.started_at).getTime();
    const backoffMinutes = Math.pow(5, task.retries); // 5, 25, 125 minutes
    const waitUntil = lastAttempt + (backoffMinutes * 60 * 1000);
    if (Date.now() < waitUntil) {
      console.log(`[WORKER] Task #${task.id} backing off (retry ${task.retries}, wait ${backoffMinutes}m)`);
      return;
    }
  }

  console.log(`[WORKER] Starting task #${task.id}: ${task.title} (retry ${task.retries}/3)`);
  tasks.start(task.id);

  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: `Execute this task and report results:\n${task.description}` }]
    });

    budget.log({
      inputTokens: resp.usage.input_tokens,
      outputTokens: resp.usage.output_tokens,
      model: MODEL
    });

    const result = resp.content[0].text;
    tasks.complete(task.id, result);
    bot.sendMessage(OWNER_ID, `✅ Task #${task.id} done: ${task.title}\n${result.slice(0, 200)}`).catch(() => {});
    console.log(`[WORKER] Task #${task.id} completed`);
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
});

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

    // Mark as stale (failed with stale reason)
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
// ITEM 20 — STARTUP SELF-TEST
// Verifies all scheduler components are working on startup.
// ══════════════════════════════════════════════════════════════════════════
setTimeout(async () => {
  console.log('[SCHEDULER] Startup self-test...');
  try {
    const pending = tasks.getPending();
    const budgetTotal = budget.getMonthTotal();
    const stale = getStaleTaskCount();
    console.log(`[SCHEDULER] Self-test PASS — Pending: ${pending.length}, Budget: $${budgetTotal.toFixed(4)}, Stale: ${stale}`);
    console.log('[SCHEDULER] All cron jobs registered and active.');
  } catch (err) {
    console.error('[SCHEDULER] Self-test FAILED:', err.message);
  }
}, 3000);

console.log('[SCHEDULER] Running. Cron jobs active:');
console.log('  • Morning brief: 4:00 AM CT daily');
console.log('  • Shorts check: every 30 minutes');
console.log('  • Weekly report: Monday 6:00 AM CT');
console.log('  • Task worker (with exponential backoff): every 5 minutes');
console.log('  • Stale task cleanup: every hour');
