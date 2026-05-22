/**
 * Solomon Autonomous Task Queue v2
 * Adds 'blocked' status support and loadQueue export for parallel worker.
 */
const fs = require('fs');
const path = require('path');

const QUEUE_FILE = path.join(__dirname, 'task-queue.json');
const ACTIONS_LOG = path.join(__dirname, 'actions-log.json');

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
  const queue = loadQueue();
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
  queue.stats.total++;
  saveQueue(queue);
  return newTask;
}

function getNextTask() {
  const queue = loadQueue();
  const pending = queue.tasks
    .filter(t => t.status === 'pending')
    .sort((a, b) => (a.priority || 5) - (b.priority || 5) || a.createdAt - b.createdAt);
  return pending[0] || null;
}

function getActiveTask() {
  const queue = loadQueue();
  return queue.tasks.find(t => t.status === 'active') || null;
}

function updateTask(taskId, updates) {
  const queue = loadQueue();
  const task = queue.tasks.find(t => t.id === taskId);
  if (!task) return null;
  Object.assign(task, updates);
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
  saveQueue(queue);
  return task;
}

function advanceStep(taskId, stepResult) {
  const queue = loadQueue();
  const task = queue.tasks.find(t => t.id === taskId);
  if (!task) return null;
  task.currentStep++;
  task.progress = Math.round((task.currentStep / task.totalSteps) * 100);
  if (!task.stepResults) task.stepResults = [];
  task.stepResults.push({ step: task.currentStep, result: stepResult, timestamp: Date.now() });
  saveQueue(queue);
  return task;
}

function getQueueSummary() {
  const queue = loadQueue();
  const active  = queue.tasks.filter(t => t.status === 'active');
  const pending = queue.tasks.filter(t => t.status === 'pending').sort((a, b) => (a.priority||5) - (b.priority||5));
  const blocked = queue.tasks.filter(t => t.status === 'blocked');
  const completed = queue.tasks.filter(t => t.status === 'completed').slice(-5);
  const failed  = queue.tasks.filter(t => t.status === 'failed').slice(-3);
  return { active, pending, blocked, completed, failed, stats: queue.stats };
}

function clearCompleted() {
  const queue = loadQueue();
  queue.tasks = queue.tasks.filter(t => t.status !== 'completed' || Date.now() - t.completedAt < 86400000);
  saveQueue(queue);
}

// ─── ACTIONS LOG ─────────────────────────────────────────────────────────────
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
  logAction, loadActionsLog
};
