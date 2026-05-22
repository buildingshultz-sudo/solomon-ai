/**
 * Solomon Task Queue v3.0 (Thread-Safe Edition)
 *
 * File-based task persistence with:
 * - File locking to prevent race conditions during parallel execution
 * - Status transition tracking (stats only increment on actual transitions)
 * - Task deduplication (same title within 5 minutes = rejected)
 * - Bounded queue size (max 100 tasks, auto-archive completed)
 * - Action logging with verification metadata
 */

const fs = require('fs');
const path = require('path');

const QUEUE_FILE = path.join(__dirname, 'task-queue.json');
const ARCHIVE_FILE = path.join(__dirname, 'task-archive.json');
const ACTIONS_LOG = path.join(__dirname, 'actions-log.json');
const LOCK_FILE = path.join(__dirname, '.queue.lock');
const MAX_QUEUE_SIZE = 100;
const DEDUP_WINDOW_MS = 300000;  // 5 minutes

// ── FILE LOCKING ───────────────────────────────────────────────────────────
function acquireLock(maxWaitMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
      return true;
    } catch (e) {
      try {
        const stat = fs.statSync(LOCK_FILE);
        if (Date.now() - stat.mtimeMs > 30000) {
          fs.unlinkSync(LOCK_FILE);
          continue;
        }
      } catch {}
      const waitUntil = Date.now() + 50;
      while (Date.now() < waitUntil) {}
    }
  }
  return false;
}

function releaseLock() {
  try { fs.unlinkSync(LOCK_FILE); } catch {}
}

// ── CORE OPERATIONS ────────────────────────────────────────────────────────
function loadQueue() {
  try {
    if (fs.existsSync(QUEUE_FILE)) return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
  } catch {}
  return { tasks: [], lastProcessed: null, stats: { completed: 0, failed: 0, blocked: 0, total: 0 } };
}

function saveQueue(queue) {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
}

function addTask(task) {
  if (!acquireLock()) throw new Error('Could not acquire queue lock');
  try {
    const queue = loadQueue();
    
    // Deduplication check
    const recentDup = queue.tasks.find(t =>
      t.title === task.title &&
      t.status !== 'completed' && t.status !== 'failed' &&
      Date.now() - (t.createdAt || 0) < DEDUP_WINDOW_MS
    );
    if (recentDup) {
      return { duplicate: true, existingId: recentDup.id, message: `Task "${task.title}" already queued` };
    }

    // Auto-archive if queue is too large
    if (queue.tasks.length >= MAX_QUEUE_SIZE) {
      const completed = queue.tasks.filter(t => t.status === 'completed' || t.status === 'failed');
      if (completed.length > 0) {
        archiveTasks(completed);
        queue.tasks = queue.tasks.filter(t => t.status !== 'completed' && t.status !== 'failed');
      }
    }

    const newTask = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: task.title,
      description: task.description || '',
      type: task.type || 'general',
      priority: task.priority || 5,
      status: 'pending',
      steps: task.steps || [],
      currentStep: 0,
      totalSteps: (task.steps || []).length || 1,
      progress: 0,
      result: null,
      artifact: null,
      error: null,
      blockReason: null,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      deadline: task.deadline || null,
      attempts: 0,
      maxRetries: task.maxRetries || 3,
      requiresPCAgent: task.requiresPCAgent || false,
      url: task.url || null,
      command: task.command || null,
      commandType: task.commandType || null
    };
    queue.tasks.push(newTask);
    queue.stats.total = (queue.stats.total || 0) + 1;
    saveQueue(queue);
    return newTask;
  } finally {
    releaseLock();
  }
}

function getNextTask() {
  if (!acquireLock()) return null;
  try {
    const queue = loadQueue();
    return queue.tasks
      .filter(t => t.status === 'pending')
      .sort((a, b) => (a.priority || 5) - (b.priority || 5) || a.createdAt - b.createdAt)[0] || null;
  } finally {
    releaseLock();
  }
}

function getActiveTask() {
  const queue = loadQueue();  // Read-only, no lock needed
  return queue.tasks.find(t => t.status === 'active') || null;
}

function updateTask(taskId, updates) {
  if (!acquireLock()) return null;
  try {
    const queue = loadQueue();
    const task = queue.tasks.find(t => t.id === taskId);
    if (!task) return null;

    const oldStatus = task.status;
    Object.assign(task, updates);

    // Only increment stats on ACTUAL status transitions
    if (updates.status && updates.status !== oldStatus) {
      if (updates.status === 'completed') {
        task.completedAt = Date.now();
        task.progress = 100;
        queue.stats.completed = (queue.stats.completed || 0) + 1;
        queue.lastProcessed = taskId;
      }
      if (updates.status === 'failed') {
        queue.stats.failed = (queue.stats.failed || 0) + 1;
        queue.lastProcessed = taskId;
      }
      if (updates.status === 'blocked') {
        queue.stats.blocked = (queue.stats.blocked || 0) + 1;
      }
    }

    saveQueue(queue);
    return task;
  } finally {
    releaseLock();
  }
}

function advanceStep(taskId, stepResult) {
  if (!acquireLock()) return null;
  try {
    const queue = loadQueue();
    const task = queue.tasks.find(t => t.id === taskId);
    if (!task) return null;
    task.currentStep++;
    task.progress = Math.round((task.currentStep / task.totalSteps) * 100);
    if (!task.stepResults) task.stepResults = [];
    task.stepResults.push({ step: task.currentStep, result: stepResult, timestamp: Date.now() });
    saveQueue(queue);
    return task;
  } finally {
    releaseLock();
  }
}

function getQueueSummary() {
  const queue = loadQueue();  // Read-only
  const active = queue.tasks.filter(t => t.status === 'active');
  const pending = queue.tasks.filter(t => t.status === 'pending').sort((a, b) => (a.priority || 5) - (b.priority || 5));
  const blocked = queue.tasks.filter(t => t.status === 'blocked');
  const completed = queue.tasks.filter(t => t.status === 'completed').slice(-5);
  const failed = queue.tasks.filter(t => t.status === 'failed').slice(-3);
  return { active, pending, blocked, completed, failed, stats: queue.stats };
}

function clearCompleted() {
  if (!acquireLock()) return;
  try {
    const queue = loadQueue();
    const toArchive = queue.tasks.filter(t => t.status === 'completed' && Date.now() - t.completedAt > 86400000);
    if (toArchive.length > 0) {
      archiveTasks(toArchive);
      queue.tasks = queue.tasks.filter(t => !(t.status === 'completed' && Date.now() - t.completedAt > 86400000));
      saveQueue(queue);
    }
  } finally {
    releaseLock();
  }
}

// ── ARCHIVE ────────────────────────────────────────────────────────────────
function archiveTasks(tasks) {
  let archive = { tasks: [] };
  try {
    if (fs.existsSync(ARCHIVE_FILE)) {
      archive = JSON.parse(fs.readFileSync(ARCHIVE_FILE, 'utf8'));
    }
  } catch {}
  archive.tasks.push(...tasks);
  // Keep only last 500 archived tasks
  if (archive.tasks.length > 500) {
    archive.tasks = archive.tasks.slice(-500);
  }
  fs.writeFileSync(ARCHIVE_FILE, JSON.stringify(archive, null, 2));
}

// ── ACTIONS LOG ────────────────────────────────────────────────────────────
function loadActionsLog() {
  try {
    if (fs.existsSync(ACTIONS_LOG)) return JSON.parse(fs.readFileSync(ACTIONS_LOG, 'utf8'));
  } catch {}
  return { actions: [] };
}

function logAction(action) {
  const log = loadActionsLog();
  log.actions.push({
    id: `act_${Date.now()}`,
    taskId: action.taskId || null,
    type: action.type,
    description: action.description,
    input: action.input || null,
    output: action.output || null,
    verified: action.verified || false,
    verificationMethod: action.verificationMethod || null,
    success: action.success,
    timestamp: Date.now()
  });
  if (log.actions.length > 200) log.actions = log.actions.slice(-200);
  fs.writeFileSync(ACTIONS_LOG, JSON.stringify(log, null, 2));
  return log.actions[log.actions.length - 1];
}

module.exports = {
  loadQueue, saveQueue, addTask, getNextTask, getActiveTask,
  updateTask, advanceStep, getQueueSummary, clearCompleted,
  logAction, loadActionsLog, archiveTasks
};
