'use strict';
// scheduler.js — Cron jobs for Solomon V4.
// Runs on VPS only. NO self-patching. NO Ollama. NO local LLM.
require('dotenv').config();
const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');
const { tasks, mem, budget, db, projectQueue, lessons, featureRequests, nathanInbox } = require('./memory');
const { executeTool } = require('./tools');
const Anthropic = require('@anthropic-ai/sdk');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
const OWNER_ID = parseInt(process.env.OWNER_CHAT_ID);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.MODEL || 'claude-sonnet-4-5-20250929';

console.log('[SCHEDULER] Starting cron jobs...');

// ══════════════════════════════════════════════════════════════════════════
// ITEM 15A — MORNING BRIEF PREPARATION: 3:45 AM CT daily
// Compile all data into a structured brief and store it.
// ══════════════════════════════════════════════════════════════════════════
cron.schedule('45 3 * * *', async () => {
  console.log('[SCHEDULER] Morning brief preparation running (3:45 AM)...');
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
// ITEM 15B — MORNING BRIEF SEND: 4:00 AM CT daily
// Read the compiled brief and send a formatted summary to Jed via Claude.
// ══════════════════════════════════════════════════════════════════════════
cron.schedule('0 4 * * *', async () => {
  console.log('[SCHEDULER] Morning brief send running (4:00 AM)...');
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
console.log('  • Morning brief prep: 3:45 AM CT daily');
console.log('  • Morning brief send: 4:00 AM CT daily');
console.log('  • Shorts check: every 30 minutes');
console.log('  • Weekly report: Monday 6:00 AM CT');
console.log('  • Task worker (with exponential backoff): every 5 minutes');
console.log('  • Stale task cleanup: every hour');
console.log('  • App Factory queue check: every 30 minutes (at :15 and :45)');
