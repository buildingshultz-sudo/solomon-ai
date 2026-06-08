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

// Pacing + off-peak scheduling (throttle-aware): ≥45s between task starts, and
// the queue only auto-runs off-peak (before 7 AM or after 6 PM CT) unless a task
// is urgent (urgent:true in tool_args, or priority 0) or it's a manualForce run.
const INTER_TASK_DELAY_MS = 45000;
function isOffPeakCT() {
  let h = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', hour12: false }).format(new Date()), 10);
  h = ((h % 24) + 24) % 24;
  return h < 7 || h >= 18; // before 7 AM CT, or 6 PM CT and later
}

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
async function processTaskQueue(opts = {}) {
  if (runningTasks >= MAX_CONCURRENT_TASKS) return;

  const task = db.prepare(
    `SELECT * FROM parallel_tasks WHERE status = 'queued' ORDER BY priority ASC, created_at ASC LIMIT 1`
  ).get();

  if (!task) return;

  // OFF-PEAK GATE: during peak hours (7 AM–6 PM CT) the queue only auto-runs
  // urgent tasks (urgent:true in tool_args, or priority 0) or a manualForce run.
  let _urgent = false;
  try { _urgent = JSON.parse(task.tool_args || '{}').urgent === true; } catch (_) {}
  if (task.priority === 0) _urgent = true;
  if (!isOffPeakCT() && !_urgent && !opts.manualForce) {
    return; // skip during peak; an off-peak tick (or urgent/force) picks it up
  }

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

// ── START THE PROCESSING LOOP ────────────────────────────────────────────
const POLL_INTERVAL_MS = 45000; // throttle-aware: ≥45s between auto-poll ticks
const BATCH_POLL_INTERVAL_MS = 300000; // 5 minutes
const intervalId = setInterval(processTaskQueue, POLL_INTERVAL_MS);
const batchIntervalId = setInterval(pollBatchJobs, BATCH_POLL_INTERVAL_MS);
console.log(`[PARALLEL] Task manager started. Polling every ${POLL_INTERVAL_MS / 1000}s, max ${MAX_CONCURRENT_TASKS} concurrent.`);
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

// manualForce run (bypasses the off-peak gate) — for an on-demand drain.
function runQueueNow() { return processTaskQueue({ manualForce: true }); }

module.exports = { enqueueTask, getTaskStatus, getAllTasks, cancelTask, runQueueNow, isOffPeakCT };
