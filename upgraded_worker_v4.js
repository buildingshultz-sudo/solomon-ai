/**
 * Solomon Autonomous Worker v4 (Parallel + Persistence Edition)
 * 
 * v4 additions:
 * - Startup recovery: On every restart, resets abandoned 'active' tasks and
 *   re-queues 'failed' tasks (up to maxRetries) so nothing is ever lost.
 * - Disk-based persistence: All task state lives in task-queue.json (already done
 *   by task-queue.js). This module adds the recovery layer on top.
 */

const fs = require('fs');
const path = require('path');
const { recoverTasks } = require('./task-recovery');

const WORKER_INTERVAL = 30000;
const PROGRESS_REPORT_INTERVAL = 1800000;
const MAX_TASK_ATTEMPTS = 3;
const MAX_CONCURRENT_TASKS = 5;

let lastProgressReport = Date.now();
const activeTaskIds = new Set();

function initWorker(bot, config, deps) {
  const { addTask, getNextTask, getActiveTask, updateTask, advanceStep, logAction, getQueueSummary } = deps.taskQueue;
  const { loadKB, addToKB } = deps.knowledgeBase;
  const { callLLM, webSearch, executeOnPC, safeSend, generateResultPDF: _genPDF } = deps.core;
  const generateResultPDF = _genPDF || (async () => null);

  // ── STARTUP RECOVERY ──────────────────────────────────────────────────────
  // Run immediately on init to resume any tasks that were in-flight when the
  // process last died. This is the core of disk-based persistence.
  const recovery = recoverTasks();
  if (recovery.recovered > 0 || recovery.reset > 0) {
    const msg = `[WORKER] Startup recovery complete: ${recovery.recovered} active tasks resumed, ${recovery.reset} failed tasks re-queued.`;
    console.log(msg);
    // Notify Jed that Sol auto-recovered
    setTimeout(async () => {
      try {
        await safeSend(bot, config.OWNER_CHAT_ID, `🔄 Auto-recovery complete. ${recovery.recovered + recovery.reset} tasks resumed from last session.`);
      } catch (e) {}
    }, 5000);
  }

  async function executeTask(task) {
    if (activeTaskIds.has(task.id)) return;
    activeTaskIds.add(task.id);
    
    console.log(`[WORKER] [${task.id}] Starting: ${task.title} (${task.type})`);
    
    const attempts = (task.attempts || 0) + 1;
    updateTask(task.id, { attempts, status: 'active', startedAt: Date.now() });

    const needsPC = task.requiresPCAgent || task.type === 'pc_command' || task.type === 'browser_action';
    if (needsPC) {
      try {
        const statusRes = await fetch('http://127.0.0.1:3001/agent/status');
        const statusData = await statusRes.json();
        if (!statusData.online) {
          updateTask(task.id, { status: 'pending', error: 'PC Agent offline' });
          activeTaskIds.delete(task.id);
          return;
        }
      } catch (e) {
        updateTask(task.id, { status: 'pending', error: 'Cannot verify PC agent' });
        activeTaskIds.delete(task.id);
        return;
      }
    }

    try {
      let result;
      switch (task.type) {
        case 'research':
        case 'web_search':
          result = await executeResearchTask(task);
          break;
        case 'pc_command':
          result = await executePCTask(task);
          break;
        case 'browser_action':
          result = await executeBrowserTask(task);
          break;
        case 'scrape':
          result = await executeScrapeTask(task);
          break;
        case 'file_creation':
          result = await executeFileTask(task);
          break;
        case 'report_generation':
          result = await executeReportTask(task);
          break;
        case 'self_upgrade':
        case 'code_generation':
          result = await executeSelfUpgradeTask(task);
          break;
        default:
          result = await executeGeneralTask(task);
      }

      if (result === null || result === false) {
        if (attempts >= MAX_TASK_ATTEMPTS) {
          updateTask(task.id, { status: 'failed', failReason: 'Max attempts reached' });
        } else {
          updateTask(task.id, { status: 'pending' });
        }
        activeTaskIds.delete(task.id);
        return;
      }

      updateTask(task.id, { status: 'completed', result: typeof result === 'string' ? result.slice(0, 5000) : result, completedAt: Date.now() });
      
      const summary = typeof result === 'string' ? result : JSON.stringify(result);
      if (summary && summary.length > 20) {
        const pdfPath = await generateResultPDF(task.title, summary);
        const shortSummary = summary.split('\n').filter(l => l.trim()).slice(0, 5).join('\n').slice(0, 500);
        if (pdfPath) {
          await bot.sendDocument(config.OWNER_CHAT_ID, pdfPath, { caption: `✅ ${task.title}\n\n${shortSummary}...` });
        } else {
          await safeSend(bot, config.OWNER_CHAT_ID, `✅ ${task.title}\n\n${shortSummary}`);
        }
      }

      if (task.type === 'research' || task.type === 'web_search') {
        addToKB('research_findings', { title: task.title, finding: summary.slice(0, 1000), date: new Date().toISOString() });
      }

    } catch (e) {
      console.error(`[WORKER] [${task.id}] Failed:`, e.message);
      if (attempts >= MAX_TASK_ATTEMPTS) {
        updateTask(task.id, { status: 'failed', failReason: e.message });
      } else {
        updateTask(task.id, { status: 'pending', error: e.message });
      }
    } finally {
      activeTaskIds.delete(task.id);
    }
  }

  // Stub implementations — the real ones live in the existing worker or are called via deps
  async function executeResearchTask(task) {
    const query = task.description || task.title;
    const results = await webSearch(query);
    return results ? `Research complete: ${results}` : null;
  }
  async function executePCTask(task) {
    const result = await executeOnPC(task.command || task.description, task.commandType || 'shell');
    return result ? result.output || 'PC command executed.' : null;
  }
  async function executeBrowserTask(task) {
    const result = await executeOnPC(`start chrome "${task.url || task.description}"`, 'shell');
    return result ? 'Browser action completed.' : null;
  }
  async function executeScrapeTask(task) {
    const result = await executeOnPC(`start chrome "${task.url}"`, 'shell');
    return result ? 'Scrape initiated.' : null;
  }
  async function executeFileTask(task) {
    const prompt = `Create the following file/document: ${task.description}. Return the full content.`;
    const content = await callLLM([{ role: 'user', content: prompt }]);
    return content || null;
  }
  async function executeReportTask(task) {
    const prompt = `Generate a detailed report on: ${task.description}. Include key findings, data, and recommendations.`;
    const content = await callLLM([{ role: 'user', content: prompt }]);
    return content || null;
  }
  async function executeSelfUpgradeTask(task) {
    const prompt = `You are upgrading Solomon's code. Task: ${task.description}. Provide the complete updated code.`;
    const content = await callLLM([{ role: 'user', content: prompt }], { model: 'gpt-4.1-mini' });
    return content || null;
  }
  async function executeGeneralTask(task) {
    const prompt = `Complete this task autonomously: ${task.description || task.title}. Provide a detailed result.`;
    const content = await callLLM([{ role: 'user', content: prompt }]);
    return content || null;
  }

  async function workerTick() {
    if (activeTaskIds.size >= MAX_CONCURRENT_TASKS) return;
    try {
      const next = getNextTask();
      if (next && !activeTaskIds.has(next.id)) {
        executeTask(next).catch(err => console.error('[WORKER] Parallel execution error:', err));
      }
    } catch (e) {
      console.error('[WORKER] Tick error:', e.message);
    }
  }

  setInterval(workerTick, WORKER_INTERVAL);
  console.log(`[WORKER] v4 Parallel+Persistence worker started (Limit: ${MAX_CONCURRENT_TASKS})`);
  
  return { executeTask, workerTick };
}

module.exports = { initWorker };
