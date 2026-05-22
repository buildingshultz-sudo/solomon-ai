'use strict';

const fs = require('fs');
const path = require('path');

let cron = null;
const SCHEDULES_FILE = path.join(__dirname, 'schedules.json');
const activeJobs = new Map();
let botInstance = null;
let ownerChatId = null;

// Lazy-load node-cron
function getCron() {
  if (!cron) {
    try {
      cron = require('node-cron');
    } catch (err) {
      throw new Error('node-cron not installed. Run: npm install node-cron');
    }
  }
  return cron;
}

// Load schedules from disk
function loadSchedules() {
  if (fs.existsSync(SCHEDULES_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8'));
    } catch (e) {
      return { schedules: [] };
    }
  }
  return { schedules: [] };
}

// Save schedules to disk
function saveSchedules(data) {
  fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(data, null, 2));
}

// Initialize the scheduler and restart saved schedules
function initScheduler(bot, chatId) {
  botInstance = bot;
  ownerChatId = chatId;
  const nodeCron = getCron();
  const data = loadSchedules();

  for (const schedule of data.schedules) {
    if (schedule.active && nodeCron.validate(schedule.cronExpression)) {
      const job = nodeCron.schedule(schedule.cronExpression, () => {
        executeScheduledTask(schedule);
      });
      activeJobs.set(schedule.id, job);
    }
  }

  console.log(`[SCHEDULER] Initialized with ${activeJobs.size} active schedules`);
  return { activeCount: activeJobs.size };
}

// Execute a scheduled task
function executeScheduledTask(schedule) {
  if (botInstance && ownerChatId) {
    botInstance.sendMessage(ownerChatId, `⏰ Scheduled: ${schedule.description}`);
  }
  // Update lastRun
  const data = loadSchedules();
  const entry = data.schedules.find(s => s.id === schedule.id);
  if (entry) {
    entry.lastRun = new Date().toISOString();
    entry.runCount = (entry.runCount || 0) + 1;
    saveSchedules(data);
  }
}

// Add a new schedule
function addSchedule(id, cronExpression, description, callback) {
  const nodeCron = getCron();

  if (!nodeCron.validate(cronExpression)) {
    return { error: `Invalid cron expression: ${cronExpression}` };
  }

  const scheduleId = id || 'sched_' + Date.now();
  const data = loadSchedules();

  // Remove existing schedule with same ID
  data.schedules = data.schedules.filter(s => s.id !== scheduleId);

  const newSchedule = {
    id: scheduleId,
    cronExpression: cronExpression,
    description: description,
    active: true,
    createdAt: new Date().toISOString(),
    lastRun: null,
    runCount: 0
  };

  data.schedules.push(newSchedule);
  saveSchedules(data);

  // Start the cron job
  const job = nodeCron.schedule(cronExpression, () => {
    if (callback) {
      callback(newSchedule);
    } else {
      executeScheduledTask(newSchedule);
    }
  });
  activeJobs.set(scheduleId, job);

  return { success: true, schedule: newSchedule };
}

// Remove a schedule
function removeSchedule(id) {
  const data = loadSchedules();
  const existing = data.schedules.find(s => s.id === id);
  if (!existing) {
    return { error: `Schedule not found: ${id}` };
  }

  data.schedules = data.schedules.filter(s => s.id !== id);
  saveSchedules(data);

  // Stop the cron job
  const job = activeJobs.get(id);
  if (job) {
    job.stop();
    activeJobs.delete(id);
  }

  return { success: true, removed: id };
}

// Pause a schedule
function pauseSchedule(id) {
  const data = loadSchedules();
  const entry = data.schedules.find(s => s.id === id);
  if (!entry) return { error: `Schedule not found: ${id}` };

  entry.active = false;
  saveSchedules(data);

  const job = activeJobs.get(id);
  if (job) {
    job.stop();
    activeJobs.delete(id);
  }

  return { success: true, paused: id };
}

// Resume a schedule
function resumeSchedule(id) {
  const nodeCron = getCron();
  const data = loadSchedules();
  const entry = data.schedules.find(s => s.id === id);
  if (!entry) return { error: `Schedule not found: ${id}` };

  entry.active = true;
  saveSchedules(data);

  const job = nodeCron.schedule(entry.cronExpression, () => {
    executeScheduledTask(entry);
  });
  activeJobs.set(id, job);

  return { success: true, resumed: id };
}

// List all schedules
function listSchedules() {
  const data = loadSchedules();
  return data.schedules.map(s => ({
    id: s.id,
    cron: s.cronExpression,
    description: s.description,
    active: s.active,
    lastRun: s.lastRun,
    runCount: s.runCount || 0
  }));
}

module.exports = {
  initScheduler,
  addSchedule,
  removeSchedule,
  pauseSchedule,
  resumeSchedule,
  listSchedules
};
