/**
 * Task Recovery Patch for Solomon worker.js
 * Adds startup recovery: resets abandoned 'active' tasks and failed tasks back to 'pending'
 * so they are automatically resumed after any restart.
 */

const fs = require('fs');
const path = require('path');

const QUEUE_FILE = path.join('/root/solomon-bot', 'task-queue.json');

function recoverTasks() {
  try {
    if (!fs.existsSync(QUEUE_FILE)) return { recovered: 0, reset: 0 };
    const queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
    let recovered = 0;
    let reset = 0;

    queue.tasks = queue.tasks.map(task => {
      // Reset tasks that were mid-execution when the process died
      if (task.status === 'active') {
        console.log(`[RECOVERY] Resetting abandoned active task: ${task.title}`);
        recovered++;
        return { ...task, status: 'pending', error: 'Recovered after restart', attempts: (task.attempts || 0) };
      }
      // Reset failed tasks that haven't exceeded max retries (maxRetries defaults to 1 in old tasks, use 3 for recovery)
      const maxRetries = task.maxRetries || 3;
      if (task.status === 'failed' && (task.attempts || 0) < maxRetries) {
        console.log(`[RECOVERY] Re-queuing failed task (${task.attempts || 0}/${maxRetries} attempts): ${task.title}`);
        reset++;
        return { ...task, status: 'pending', error: null };
      }
      return task;
    });

    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
    console.log(`[RECOVERY] Done: ${recovered} active tasks recovered, ${reset} failed tasks re-queued.`);
    return { recovered, reset };
  } catch (e) {
    console.error('[RECOVERY] Error:', e.message);
    return { recovered: 0, reset: 0 };
  }
}

module.exports = { recoverTasks };
