'use strict';
// parallel_task_manager.js — Phase 9.0: Parallel Task Management System
// Manages a background task queue. Checks for queued tasks every 5 seconds,
// runs up to 5 concurrently, and notifies Jed on failures via Telegram API.
// NO self-patching. NO Ollama. NO local LLM.
require('dotenv').config();
const { db, batchJobs } = require('./memory');
const { executeTool } = require('./tools');
const axios = require('axios');

const MAX_CONCURRENT_TASKS = 5;
let runningTasks = 0;

// Throttle-aware pacing: ≥45s between task starts. (Off-peak time-window gate
// was reverted — it risked silently skipping every tick during business hours
// and didn't address the real dispatch-execution gap. 45s pacing was the fix.)
const INTER_TASK_DELAY_MS = 45000;

// ── TELEGRAM NOTIFICATION (direct API, no bot instance needed) ───────────
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OWNER_ID = process.env.OWNER_CHAT_ID;

async function notifyOwner(message) {
  if (!TELEGRAM_TOKEN || !OWNER_ID) return;
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: OWNER_ID,
      text: message,
      parse_mode: 'HTML'
    }, { timeout: 10000 });
  } catch (err) {
    console.error('[PARALLEL] Failed to send Telegram notification:', err.message);
  }
}

// ── TASK QUEUE PROCESSOR ─────────────────────────────────────────────────
async function processTaskQueue() {
  if (runningTasks >= MAX_CONCURRENT_TASKS) return;

  const task = db.prepare(
    `SELECT * FROM parallel_tasks WHERE status = 'queued' ORDER BY priority ASC, created_at ASC LIMIT 1`
  ).get();

  if (!task) return;

  // Mark as running
  db.prepare(`UPDATE parallel_tasks SET status = 'running', started_at = CURRENT_TIMESTAMP WHERE id = ?`).run(task.id);
  runningTasks++;
  console.log(`[PARALLEL] Starting task #${task.id}: ${task.task_name} (tool: ${task.tool_name})`);

  try {
    const args = JSON.parse(task.tool_args);
    const result = await executeTool(task.tool_name, args);

    db.prepare(`UPDATE parallel_tasks SET status = 'complete', result = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(JSON.stringify(result), task.id);

    console.log(`[PARALLEL] Task #${task.id} complete: ${task.task_name}`);
  } catch (error) {
    db.prepare(`UPDATE parallel_tasks SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(error.message, task.id);

    console.error(`[PARALLEL] Task #${task.id} failed: ${task.task_name} — ${error.message}`);

    // Notify Jed of failure
    notifyOwner(`⚠️ <b>Parallel Task Failed</b>\nTask: ${task.task_name}\nTool: ${task.tool_name}\nError: ${error.message.slice(0, 200)}`);
  } finally {
    runningTasks--;
    // Pace consecutive tasks (≥45s apart) so we never hammer the Anthropic API.
    setTimeout(() => processTaskQueue(), INTER_TASK_DELAY_MS);
  }
}

// ── BATCH JOB POLLING (Anthropic Batch API) ──────────────────────────────
async function pollBatchJobs() {
  const pending = batchJobs.getPending();
  if (!pending.length) return;

  const Anthropic = require('@anthropic-ai/sdk');
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  for (const job of pending) {
    try {
      const batch = await anthropic.beta.messages.batches.retrieve(job.batch_id);
      if (batch.status === 'ended') {
        const results = [];
        for await (const result of await anthropic.beta.messages.batches.results(job.batch_id)) {
          results.push(result);
        }
        batchJobs.updateStatus(job.batch_id, 'ended', JSON.stringify(results));
        console.log(`[BATCH] Job #${job.id} (${job.batch_id}) complete. Notify owner.`);
        notifyOwner(`✅ <b>Anthropic Batch Job Complete</b>\nID: <code>${job.batch_id}</code>\nPurpose: ${job.purpose || 'General'}\nUse <code>get_batch_results</code> to see data.`);
      } else if (batch.status !== job.status) {
        batchJobs.updateStatus(job.batch_id, batch.status);
      }
    } catch (err) {
      console.error(`[BATCH] Error polling job ${job.batch_id}:`, err.message);
    }
  }
}

// ── STARTUP RECOVERY ─────────────────────────────────────────────────────
// Bug fix: tasks left in 'running' when the process crashed/restarted were never
// marked done/failed (the queue query only selects 'queued'), so they stuck in
// 'running' forever. On boot, fail any orphaned 'running' task so it's resolved.
try {
  const orphaned = db.prepare(`UPDATE parallel_tasks SET status='failed', error_message='interrupted by process restart', completed_at=CURRENT_TIMESTAMP WHERE status='running'`).run();
  if (orphaned.changes) console.log(`[PARALLEL] startup recovery: reset ${orphaned.changes} orphaned running task(s) -> failed`);
} catch (e) { console.error('[PARALLEL] startup recovery failed:', e.message); }

// ── SAM-QUEUE DISPATCH EXECUTOR (verify/ping ONLY) ───────────────────────
// Audit finding: nothing consumed sam-queue dispatch_*.json — the "Sam watcher"
// referenced in dispatch-core was phantom and never built. This is the FIRST real
// autonomous executor for sam-queue, DELIBERATELY scoped to harmless verify/ping
// tasks so it cannot bulk-fire the real build/fix/browser backlog. It picks up a
// queued verify/ping dispatch, runs a system probe, marks it done, logs to
// activity_log — no manual invoke. (build/fix/deploy still need the Claude Code
// agent; caleb browser tasks still route via the relay->worker path.)
const fs = require('fs');
const os = require('os');
const path = require('path');
const SAM_QUEUE_DIR = '/root/solomon-v4/sam-queue';
const AUTO_EXEC_TYPES = new Set(['verify', 'ping']);
function processDispatchQueue() {
  let files = [];
  try { files = fs.readdirSync(SAM_QUEUE_DIR).filter(f => /^dispatch_.*\.json$/.test(f)); } catch (_) { return; }
  for (const f of files) {
    const fp = path.join(SAM_QUEUE_DIR, f);
    let j; try { j = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (_) { continue; }
    if (j.status !== 'queued') continue;
    const tt = String(j.task_type || '').toLowerCase();
    // SAFETY (hardened after a real-backlog false-complete): a dispatch must be a
    // harmless type AND explicitly flagged params.autoexec===true. Real tasks (even
    // task_type 'verify' like the Manus checks) lack this flag and are NEVER touched.
    if (!AUTO_EXEC_TYPES.has(tt)) continue;
    if (!(j.params && j.params.autoexec === true)) continue;
    const summary = `verify OK on ${os.hostname()} (${os.platform()}); free ${Math.round(os.freemem() / 1048576)}MB; uptime ${Math.round(os.uptime())}s`;
    j.status = 'done'; j.completed_at = new Date().toISOString(); j.result_summary = summary; j.executed_by = 'dispatch_executor';
    try { fs.writeFileSync(fp, JSON.stringify(j, null, 2)); } catch (e) { console.error('[DISPATCH-EXEC] write failed', f, e.message); continue; }
    try { db.prepare('INSERT INTO activity_log (type, status, summary) VALUES (?,?,?)').run('dispatch_executed', 'ok', `${j.id || f}: ${tt} -> done | ${summary}`); } catch (_) {}
    console.log(`[DISPATCH-EXEC] executed ${tt} dispatch ${j.id || f} -> done`);
    notifyOwner(`✅ <b>Dispatch executed</b> (autonomous)\n${j.title || j.id}\n${summary}`);
  }
}

// ── START THE PROCESSING LOOP ────────────────────────────────────────────
const POLL_INTERVAL_MS = 45000; // throttle-aware: ≥45s between auto-poll ticks
const BATCH_POLL_INTERVAL_MS = 300000; // 5 minutes
const intervalId = setInterval(processTaskQueue, POLL_INTERVAL_MS);
const batchIntervalId = setInterval(pollBatchJobs, BATCH_POLL_INTERVAL_MS);
const dispatchIntervalId = setInterval(processDispatchQueue, POLL_INTERVAL_MS);
processDispatchQueue(); // immediate first pass so a freshly-queued verify/ping runs without waiting
console.log(`[PARALLEL] Task manager started. Polling every ${POLL_INTERVAL_MS / 1000}s, max ${MAX_CONCURRENT_TASKS} concurrent. Dispatch executor (verify/ping) active.`);
console.log(`[BATCH] Polling pending batch jobs every ${BATCH_POLL_INTERVAL_MS / 60000}m.`);

// ── EXPORTED FUNCTIONS ───────────────────────────────────────────────────
function enqueueTask(taskName, toolName, args, priority = 5) {
  const info = db.prepare(
    `INSERT INTO parallel_tasks (task_name, tool_name, tool_args, priority) VALUES (?, ?, ?, ?)`
  ).run(taskName, toolName, JSON.stringify(args), priority);
  console.log(`[PARALLEL] Enqueued task #${info.lastInsertRowid}: ${taskName} (tool: ${toolName}, priority: ${priority})`);
  return info.lastInsertRowid;
}

function getTaskStatus(taskId) {
  return db.prepare(`SELECT * FROM parallel_tasks WHERE id = ?`).get(taskId);
}

function getAllTasks(status = 'all', limit = 10) {
  if (status === 'all') {
    return db.prepare(`SELECT * FROM parallel_tasks ORDER BY created_at DESC LIMIT ?`).all(limit);
  }
  return db.prepare(`SELECT * FROM parallel_tasks WHERE status = ? ORDER BY created_at DESC LIMIT ?`).all(status, limit);
}

function cancelTask(taskId) {
  const task = db.prepare(`SELECT * FROM parallel_tasks WHERE id = ?`).get(taskId);
  if (!task) {
    return { ok: false, error: 'Task not found.' };
  }
  if (task.status === 'running') {
    return { ok: false, error: 'Cannot cancel a running task. Wait for it to complete or fail.' };
  }
  if (task.status === 'complete' || task.status === 'failed') {
    return { ok: false, error: `Task already ${task.status}. Nothing to cancel.` };
  }
  db.prepare(`UPDATE parallel_tasks SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(taskId);
  return { ok: true, message: `Task #${taskId} cancelled.` };
}

module.exports = { enqueueTask, getTaskStatus, getAllTasks, cancelTask, processDispatchQueue };
