/**
 * Swap Script: Route tasks from old worker-adapter to CrewAI backend.
 * 
 * Strategy:
 * 1. Keep the old worker-adapter import but disable its processing loop
 * 2. Add CrewAI bridge that intercepts task queue additions
 * 3. When a task is added via queue_task tool, also submit to CrewAI
 * 4. CrewAI bridge polls for results and delivers PDFs
 * 
 * This script modifies bot.js to use CrewAI as the primary task processor.
 */

const fs = require('fs');
const path = '/root/solomon-bot/bot.js';

let code = fs.readFileSync(path, 'utf8');

// 1. Add CrewAI bridge import after the worker-adapter line
const workerLine = "const workerAdapter = require('./worker-adapter');";
const crewaiImport = `// ── CREWAI BACKEND (Primary Task Processor) ───────────────────────────────
const CrewAIBridge = require('./crewai-bridge');
const crewai = new CrewAIBridge(bot, config.OWNER_CHAT_ID || '${process.env.OWNER_CHAT_ID || '8762434280'}');

// Health check CrewAI on startup
(async () => {
  const h = await crewai.health();
  if (h.status === 'healthy') {
    console.log('[CREWAI] Backend connected. Agents:', h.agents.join(', '));
  } else {
    console.log('[CREWAI] Backend offline — falling back to old worker. Error:', h.error);
  }
})();`;

if (!code.includes('CrewAIBridge')) {
  code = code.replace(workerLine, workerLine + '\n' + crewaiImport);
}

// 2. Modify the queue_task tool to submit to CrewAI instead of just the old queue
const oldQueueTask = `    case 'queue_task':
      const task = taskQueue.addTask(args);
      if (task.duplicate) return { queued: false, reason: task.message };
      return { queued: true, taskId: task.id, position: 'queued' };`;

const newQueueTask = `    case 'queue_task':
      const task = taskQueue.addTask(args);
      if (task.duplicate) return { queued: false, reason: task.message };
      // Submit to CrewAI backend for processing
      const crewResult = await crewai.submitTask(args.title || args.description, args.description || args.title, { id: task.id, agent: args.agent });
      if (crewResult.success) {
        console.log('[CREWAI] Task routed to', crewResult.agent, 'agent:', task.id);
      } else {
        console.log('[CREWAI] Submit failed, old worker will handle:', crewResult.error);
      }
      return { queued: true, taskId: task.id, position: 'queued', crewai_agent: crewResult.agent || 'fallback' };`;

if (!code.includes('crewai.submitTask')) {
  code = code.replace(oldQueueTask, newQueueTask);
}

// 3. Disable the old worker's processing loop (comment it out but keep for fallback)
const oldWorkerStart = "workerAdapter.start(config, { bot, memory, taskQueue, pluginLoader, callLLM, executeTool, OWNER_ID });";
const newWorkerStart = `// OLD WORKER DISABLED — CrewAI is now the primary task processor
// workerAdapter.start(config, { bot, memory, taskQueue, pluginLoader, callLLM, executeTool, OWNER_ID });
// To re-enable old worker as fallback, uncomment the line above.`;

if (!code.includes('OLD WORKER DISABLED')) {
  code = code.replace(oldWorkerStart, newWorkerStart);
}

fs.writeFileSync(path, code);
console.log('✅ Task routing swapped to CrewAI backend');
console.log('   - CrewAI bridge imported');
console.log('   - queue_task tool now routes to CrewAI');
console.log('   - Old worker-adapter disabled');
