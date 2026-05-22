/**
 * Solomon's Forge Bot v6.0 — Autonomous Business Operating System
 *
 * Architecture:
 * - Plugin-based: all integrations are lazy-loaded modules
 * - Anti-hallucination: strict data verification, source tagging
 * - Memory: SQLite-backed persistent context
 * - Health: deep functional checks, not just process status
 * - Self-upgrade: Sol can modify his own code and deploy
 *
 * Core flow:
 * 1. User sends message via Telegram
 * 2. Message + context + KB injected into LLM
 * 3. LLM decides: direct reply, tool call, or task queue
 * 4. Tools execute via plugin system
 * 5. Results verified and delivered
 */

const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

// ── CORE MODULES ───────────────────────────────────────────────────────────
const config = require('./core/config');

// ── PERSISTENT MEMORY FILE ─────────────────────────────────────────────────
// This file contains Sol's complete context about Jed, the business, and history.
// It survives all restarts and is ALWAYS included in the system prompt.
const SOL_MEMORY_FILE = path.join(__dirname, 'sol_memory.md');
function loadPersistentMemory() {
  try {
    if (fs.existsSync(SOL_MEMORY_FILE)) {
      return "\n\n" + fs.readFileSync(SOL_MEMORY_FILE, "utf8");
    }
  } catch (e) {
    console.error('[BOT] Failed to load persistent memory:', e.message);
  }
  return '';
}
const PERSISTENT_MEMORY = loadPersistentMemory();
console.log('[BOT] Persistent memory loaded:', PERSISTENT_MEMORY.length, 'chars');
const pluginLoader = require('./core/plugin-loader');
const memory = require('./core/memory');
const taskQueue = require('./task-queue');
const healthMonitor = require('./health-monitor');

// ── VALIDATE CONFIG ────────────────────────────────────────────────────────
const missingCritical = config.validateConfig();
if (missingCritical.length > 0) {
  console.error('[BOT] Cannot start without critical config. Set in .env file.');
  process.exit(1);
}

// ── INIT BOT ───────────────────────────────────────────────────────────────
const bot = new TelegramBot(config.TELEGRAM_TOKEN, { polling: true });
const OWNER_ID = config.OWNER_CHAT_ID;

console.log('[BOT] Solomon v6.0 starting...');

// ── LOAD PLUGINS ───────────────────────────────────────────────────────────
const pluginResults = pluginLoader.loadAllPlugins(config, { bot, memory, taskQueue });
console.log(`[BOT] Plugins: ${pluginResults.loaded.length} active, ${pluginResults.inactive.length} need keys`);

// ── LLM INTERFACE ──────────────────────────────────────────────────────────
async function callLLM(messages, tools = null, model = null) {
  const selectedModel = model || config.MODEL;
  const body = {
    model: selectedModel,
    messages,
    max_tokens: config.LLM_MAX_TOKENS,
    temperature: 0.7
  };
  if (tools && tools.length > 0) body.tools = tools;

  try {
    const res = await fetch(config.OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://solomonsforge.com',
        'X-Title': 'Solomon Bot v6'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.LLM_TIMEOUT)
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[LLM] Error ${res.status}: ${errText.slice(0, 200)}`);
      // Fallback to smaller model
      if (selectedModel !== config.MODEL_FALLBACK) {
        console.log('[LLM] Falling back to', config.MODEL_FALLBACK);
        return callLLM(messages, tools, config.MODEL_FALLBACK);
      }
      throw new Error(`LLM API error: ${res.status}`);
    }

    const data = await res.json();
    return data.choices[0].message;
  } catch (e) {
    console.error('[LLM] Call failed:', e.message);
    throw e;
  }
}

// ── BUILD TOOL LIST ────────────────────────────────────────────────────────
function getAvailableTools() {
  const tools = pluginLoader.getAllTools();
  // Add core tools
  tools.push(
    {
      type: 'function', function: {
        name: 'queue_task',
        description: 'Add a task to the background work queue for autonomous execution',
        parameters: { type: 'object', properties: {
          title: { type: 'string', description: 'Task title' },
          description: { type: 'string', description: 'Detailed task description' },
          type: { type: 'string', enum: ['research', 'content', 'code', 'pc_task', 'design', 'analysis'], description: 'Task type' },
          priority: { type: 'number', description: '1=urgent, 5=normal, 10=low' }
        }, required: ['title', 'description'] }
      }
    },
    {
      type: 'function', function: {
        name: 'check_queue',
        description: 'Check current task queue status',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    {
      type: 'function', function: {
        name: 'remember',
        description: 'Store important information in persistent memory (facts, decisions, preferences)',
        parameters: { type: 'object', properties: {
          category: { type: 'string', enum: ['facts', 'decisions', 'preferences', 'research_findings', 'contacts', 'credentials'], description: 'Memory category' },
          key: { type: 'string', description: 'Short identifier' },
          value: { type: 'string', description: 'Information to remember' }
        }, required: ['category', 'value'] }
      }
    },
    {
      type: 'function', function: {
        name: 'recall',
        description: 'Search persistent memory for stored information',
        parameters: { type: 'object', properties: {
          query: { type: 'string', description: 'What to search for' }
        }, required: ['query'] }
      }
    },
    {
      type: 'function', function: {
        name: 'generate_pdf',
        description: 'Generate a PDF document from markdown content and send it via Telegram',
        parameters: { type: 'object', properties: {
          title: { type: 'string', description: 'Document title' },
          markdown: { type: 'string', description: 'Full markdown content for the PDF' }
        }, required: ['title', 'markdown'] }
      }
    },
    {
      type: 'function', function: {
        name: 'system_health',
        description: 'Run a full system health check',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    }
  );
  return tools;
}

// ── TOOL EXECUTION ─────────────────────────────────────────────────────────
async function executeTool(toolName, args, chatId) {
  console.log(`[TOOL] Executing: ${toolName}`, JSON.stringify(args).slice(0, 100));

  // Core tools
  switch (toolName) {
    case 'queue_task':
      const task = taskQueue.addTask(args);
      if (task.duplicate) return { queued: false, reason: task.message };
      // Submit to CrewAI backend for processing
      const crewResult = await crewai.submitTask(args.title || args.description, args.description || args.title, { id: task.id, agent: args.agent });
      if (crewResult.success) {
        console.log('[CREWAI] Task routed to', crewResult.agent, 'agent:', task.id);
      } else {
        console.log('[CREWAI] Submit failed, old worker will handle:', crewResult.error);
      }
      return { queued: true, taskId: task.id, position: 'queued', crewai_agent: crewResult.agent || 'fallback' };

    case 'check_queue':
      return taskQueue.getQueueSummary();

    case 'remember':
      memory.addKnowledge(args.category, args.value, args.key);
      return { stored: true, category: args.category };

    case 'recall':
      const results = memory.searchKnowledge(args.query);
      return { found: results.length, results: results.map(r => ({ category: r.category, value: r.value })) };

    case 'generate_pdf':
      return await generateAndSendPDF(args.title, args.markdown, chatId);

    case 'system_health':
      return await healthMonitor.runFullCheck(config);
  }

  // Plugin tools
  const result = await pluginLoader.executePluginTool(toolName, args, { config, memory, bot });
  return result;
}

// ── PDF GENERATION ─────────────────────────────────────────────────────────
async function generateAndSendPDF(title, markdown, chatId) {
  const mdPath = `/tmp/sol_${Date.now()}.md`;
  const pdfPath = `/tmp/sol_${Date.now()}.pdf`;

  try {
    fs.writeFileSync(mdPath, `# ${title}\n\n${markdown}`);

    // Try multiple PDF generation methods
    const { execSync } = require('child_process');
    let generated = false;

    // Method 1: weasyprint via markdown-to-html
    try {
      const htmlPath = `/tmp/sol_${Date.now()}.html`;
      const htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        body { font-family: 'Segoe UI', Arial, sans-serif; margin: 40px; line-height: 1.6; color: #333; }
        h1 { color: #1a1a2e; border-bottom: 2px solid #e94560; padding-bottom: 10px; }
        h2 { color: #16213e; margin-top: 30px; }
        code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; }
        pre { background: #f5f5f5; padding: 15px; border-radius: 5px; overflow-x: auto; }
        table { border-collapse: collapse; width: 100%; margin: 15px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background: #16213e; color: white; }
        blockquote { border-left: 4px solid #e94560; margin: 15px 0; padding: 10px 20px; background: #f9f9f9; }
      </style></head><body>${markdownToHtml(markdown, title)}</body></html>`;
      fs.writeFileSync(htmlPath, htmlContent);
      execSync(`weasyprint "${htmlPath}" "${pdfPath}"`, { timeout: 30000, env: { ...process.env, PATH: '/usr/local/bin:/usr/bin:/bin' } });
      generated = true;
    } catch (e) {
      console.log('[PDF] weasyprint failed:', e.message);
    }

    // Method 2: manus-md-to-pdf
    if (!generated) {
      try {
        execSync(`/usr/local/bin/manus-md-to-pdf "${mdPath}" "${pdfPath}"`, { timeout: 30000 });
        generated = true;
      } catch (e) {
        console.log('[PDF] manus-md-to-pdf failed:', e.message);
      }
    }

    if (!generated || !fs.existsSync(pdfPath)) {
      // Send as markdown file instead
      await bot.sendDocument(chatId, Buffer.from(`# ${title}\n\n${markdown}`), {
        caption: `📄 ${title} (PDF generation unavailable, sending as .md)`
      }, { filename: `${title.replace(/[^a-z0-9]/gi, '_')}.md`, contentType: 'text/markdown' });
      return { success: true, format: 'markdown', note: 'PDF tools unavailable, sent as .md' };
    }

    await bot.sendDocument(chatId, pdfPath, { caption: `📄 ${title}` });
    // Cleanup
    try { fs.unlinkSync(mdPath); fs.unlinkSync(pdfPath); } catch {}
    return { success: true, format: 'pdf' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function markdownToHtml(md, title) {
  let html = `<h1>${title}</h1>\n`;
  html += md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
  return `<p>${html}</p>`;
}

// ── MESSAGE HANDLER ────────────────────────────────────────────────────────
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  // Owner check
  if (String(chatId) !== String(OWNER_ID)) {
    bot.sendMessage(chatId, "⚔️ Solomon's Forge is a private system. Access denied.");
    return;
  }

  // Handle commands
  if (text.startsWith('/')) {
    const handled = await handleCommand(text, chatId);
    if (handled) return;
  }

  try {
    // Save message to memory
    memory.saveMessage(chatId, 'user', text);

    // Build context
    const history = memory.getChatHistory(chatId, config.MAX_MESSAGES);
    const kbContext = memory.getKBContext();
    const tools = getAvailableTools();

    const messages = [
      { role: 'system', content: config.SYSTEM_PROMPT + PERSISTENT_MEMORY + kbContext },
      ...history,
      { role: 'user', content: text }
    ];

    // Call LLM with tools
    let response = await callLLM(messages, tools);
    let iterations = 0;
    const maxIterations = 5;

    // Tool call loop
    while (response.tool_calls && iterations < maxIterations) {
      iterations++;
      const toolResults = [];

      for (const toolCall of response.tool_calls) {
        const name = toolCall.function.name;
        let args = {};
        try { args = JSON.parse(toolCall.function.arguments); } catch {}

        const result = await executeTool(name, args, chatId);
        toolResults.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        });
      }

      // Continue conversation with tool results
      messages.push(response);
      messages.push(...toolResults);
      response = await callLLM(messages, tools);
    }

    // Send final response
    const reply = response.content || '(No response generated)';
    memory.saveMessage(chatId, 'assistant', reply);

    // Split long messages (Telegram 4096 char limit)
    if (reply.length > 4000) {
      const chunks = splitMessage(reply, 4000);
      for (const chunk of chunks) {
        await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' }).catch(() =>
          bot.sendMessage(chatId, chunk)  // Retry without markdown if parsing fails
        );
      }
    } else {
      await bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' }).catch(() =>
        bot.sendMessage(chatId, reply)
      );
    }
  } catch (e) {
    console.error('[BOT] Message handling error:', e.message);
    bot.sendMessage(chatId, `⚠️ Error: ${e.message}\n\nI'm still operational. Try again or check /health.`);
  }
});

// ── COMMAND HANDLER ────────────────────────────────────────────────────────
async function handleCommand(text, chatId) {
  const [cmd, ...args] = text.split(' ');

  switch (cmd) {
    case '/start':
      bot.sendMessage(chatId, `⚔️ *Solomon's Forge v6.0* — Online\n\nI'm Sol, your autonomous business OS. What do you need?`, { parse_mode: 'Markdown' });
      return true;

    case '/health':
      bot.sendMessage(chatId, '🔍 Running deep health check...');
      const report = await healthMonitor.runFullCheck(config);
      bot.sendMessage(chatId, healthMonitor.formatReportForTelegram(report), { parse_mode: 'Markdown' });
      return true;

    case '/status':
      const summary = taskQueue.getQueueSummary();
      const plugins = pluginLoader.getActivePlugins();
      let statusMsg = `⚔️ *Sol Status*\n\n`;
      statusMsg += `🔌 Plugins: ${plugins.length} active\n`;
      statusMsg += `📋 Queue: ${summary.pending.length} pending, ${summary.active.length} active\n`;
      statusMsg += `✅ Completed: ${summary.stats.completed} | ❌ Failed: ${summary.stats.failed}\n`;
      bot.sendMessage(chatId, statusMsg, { parse_mode: 'Markdown' });
      return true;

    case '/plugins':
      const status = pluginLoader.getPluginStatus();
      let pluginMsg = '🔌 *Plugin Status*\n\n';
      for (const p of status) {
        const icon = p.active ? '✅' : '⚠️';
        pluginMsg += `${icon} *${p.name}* v${p.version}`;
        if (!p.active && p.reason) pluginMsg += ` — ${p.reason}`;
        pluginMsg += '\n';
      }
      bot.sendMessage(chatId, pluginMsg, { parse_mode: 'Markdown' });
      return true;

    case '/queue':
      const q = taskQueue.getQueueSummary();
      let qMsg = '📋 *Task Queue*\n\n';
      if (q.active.length > 0) qMsg += `*Active:*\n${q.active.map(t => `▶️ ${t.title} (${t.progress}%)`).join('\n')}\n\n`;
      if (q.pending.length > 0) qMsg += `*Pending:*\n${q.pending.map(t => `⏳ ${t.title}`).join('\n')}\n\n`;
      if (q.blocked.length > 0) qMsg += `*Blocked:*\n${q.blocked.map(t => `🚫 ${t.title}: ${t.blockReason}`).join('\n')}\n\n`;
      if (q.active.length === 0 && q.pending.length === 0) qMsg += '_Queue is empty._\n';
      bot.sendMessage(chatId, qMsg, { parse_mode: 'Markdown' });
      return true;

    case '/clear':
      memory.clearChatHistory(chatId);
      bot.sendMessage(chatId, '🧹 Chat history cleared. Fresh context.');
      return true;

    case '/capabilities':
      const caps = pluginLoader.getActivePlugins();
      let capMsg = '⚔️ *Sol\'s Capabilities*\n\n';
      for (const p of caps) {
        capMsg += `*${p.name}*: ${p.description}\n`;
        if (p.commands.length > 0) capMsg += `  Commands: ${p.commands.join(', ')}\n`;
        capMsg += '\n';
      }
      bot.sendMessage(chatId, capMsg, { parse_mode: 'Markdown' });
      return true;

    default:
      // Check plugin commands
      const pluginCommands = pluginLoader.getAllCommands();
      if (pluginCommands[cmd]) {
        // Route to plugin handler (future: plugins can register command handlers)
        return false;  // Let the LLM handle it with context
      }
      return false;
  }
}

// ── UTILITIES ──────────────────────────────────────────────────────────────
function splitMessage(text, maxLen) {
  const chunks = [];
  while (text.length > maxLen) {
    let splitAt = text.lastIndexOf('\n', maxLen);
    if (splitAt === -1 || splitAt < maxLen / 2) splitAt = maxLen;
    chunks.push(text.slice(0, splitAt));
    text = text.slice(splitAt);
  }
  if (text) chunks.push(text);
  return chunks;
}

// ── WORKER INTEGRATION ─────────────────────────────────────────────────────
const workerAdapter = require('./worker-adapter');
// ── CREWAI BACKEND (Primary Task Processor) ───────────────────────────────
const CrewAIBridge = require('./crewai-bridge');
const crewai = new CrewAIBridge(bot, config.OWNER_CHAT_ID || '8762434280');

// Health check CrewAI on startup
(async () => {
  const h = await crewai.health();
  if (h.status === 'healthy') {
    console.log('[CREWAI] Backend connected. Agents:', h.agents.join(', '));
  } else {
    console.log('[CREWAI] Backend offline — falling back to old worker. Error:', h.error);
  }
})();
// OLD WORKER DISABLED — CrewAI is now the primary task processor
// workerAdapter.start(config, { bot, memory, taskQueue, pluginLoader, callLLM, executeTool, OWNER_ID });
// To re-enable old worker as fallback, uncomment the line above.

// ── HEALTH CHECK SCHEDULER ─────────────────────────────────────────────────
setInterval(async () => {
  try {
    const report = await healthMonitor.runFullCheck(config);
    if (report.overall === 'critical') {
      bot.sendMessage(OWNER_ID, `🚨 *CRITICAL ALERT*\n\n${healthMonitor.formatReportForTelegram(report)}`, { parse_mode: 'Markdown' });
    }
  } catch {}
}, healthMonitor.CHECK_INTERVAL);

// ── DAILY CHECK-IN ─────────────────────────────────────────────────────────
function scheduleDailyCheckin() {
  const now = new Date();
  const target = new Date();
  target.setHours(config.DAILY_CHECKIN_HOUR, config.DAILY_CHECKIN_MINUTE, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  const delay = target - now;

  setTimeout(async () => {
    try {
      const health = await healthMonitor.runFullCheck(config);
      const queue = taskQueue.getQueueSummary();
      let msg = `☀️ *Good morning, Jed. Sol's daily report:*\n\n`;
      msg += healthMonitor.formatReportForTelegram(health);
      msg += `\n📋 Queue: ${queue.pending.length} pending, ${queue.stats.completed} completed total\n`;
      if (queue.pending.length > 0) {
        msg += `\nNext up:\n${queue.pending.slice(0, 3).map(t => `• ${t.title}`).join('\n')}`;
      }
      bot.sendMessage(OWNER_ID, msg, { parse_mode: 'Markdown' });
    } catch {}
    scheduleDailyCheckin();
  }, delay);
}
scheduleDailyCheckin();

// ── REMINDER CHECKER ───────────────────────────────────────────────────────
setInterval(() => {
  try {
    const due = memory.getDueReminders();
    for (const reminder of due) {
      bot.sendMessage(reminder.chat_id, `⏰ *Reminder:* ${reminder.text}`, { parse_mode: 'Markdown' });
      memory.markReminderFired(reminder.id);
    }
  } catch {}
}, 60000);

// ── GRACEFUL SHUTDOWN ──────────────────────────────────────────────────────
process.on('SIGTERM', () => {
  console.log('[BOT] Shutting down gracefully...');
  bot.stopPolling();
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('[BOT] Uncaught exception:', err.message, err.stack);
  // Don't crash — log and continue
});

process.on('unhandledRejection', (reason) => {
  console.error('[BOT] Unhandled rejection:', reason);
});


// ── INTERNAL CALLBACK SERVER (for Python CrewAI backend) ──────────────────
// Listens on port 4000 for proactive notifications from the CrewAI backend
const http = require('http');
const internalServer = http.createServer(async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405); res.end('Method Not Allowed'); return;
  }
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const data = JSON.parse(body);
      const { type, message, title, pdf_path, md_path, task_id } = data;
      const chatId = OWNER_ID;

      if (req.url === '/notify/complete') {
        // Task completed — send PDF if available
        const caption = `✅ *${title || 'Task Complete'}*

${(message || '').slice(0, 900)}`;
        if (pdf_path && fs.existsSync(pdf_path)) {
          await bot.sendDocument(chatId, pdf_path, { caption, parse_mode: 'Markdown' });
        } else if (md_path && fs.existsSync(md_path)) {
          await bot.sendDocument(chatId, md_path, { caption: caption + '\n_(PDF unavailable, sending markdown)_', parse_mode: 'Markdown' });
        } else {
          await bot.sendMessage(chatId, caption, { parse_mode: 'Markdown' });
        }
      } else if (req.url === '/notify/question') {
        // Sol needs Jed's input
        await bot.sendMessage(chatId,
          `❓ *Sol needs your input:*\n\n${message || 'Please respond to continue.'}`,
          { parse_mode: 'Markdown' });
      } else if (req.url === '/notify/milestone') {
        // Significant milestone reached
        await bot.sendMessage(chatId,
          `🏆 *Milestone:* ${title || ''}\n\n${message || ''}`,
          { parse_mode: 'Markdown' });
      } else if (req.url === '/notify/error') {
        // Error requiring human intervention
        await bot.sendMessage(chatId,
          `🚨 *Action needed:* ${title || 'Error'}\n\n${message || ''}\n\nPlease advise.`,
          { parse_mode: 'Markdown' });
      } else if (req.url === '/notify/blocked') {
        // Task is blocked
        await bot.sendMessage(chatId,
          `🚫 *Blocked: ${title || 'Task'}*\n\n${message || ''}\n\nThis task needs your input to proceed.`,
          { parse_mode: 'Markdown' });
      } else {
        // Generic notification
        await bot.sendMessage(chatId, message || 'Notification from Sol.', { parse_mode: 'Markdown' });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      console.error('[INTERNAL-SERVER] Error:', e.message);
      res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  });
});
internalServer.listen(4000, '127.0.0.1', () => {
  console.log('[BOT] Internal callback server listening on port 4000');
});
// ── END INTERNAL CALLBACK SERVER ───────────────────────────────────────────

console.log('[BOT] Solomon v6.0 fully initialized. Awaiting commands.');

// ── STARTUP RECOVERY ───────────────────────────────────────────────────────
// On every start, check for interrupted tasks and notify Jed
setTimeout(async () => {
  try {
    const queue = taskQueue.getQueueSummary();
    // Find tasks that were "active" when we crashed — reset them to pending
    const interrupted = queue.active || [];
    let recovered = 0;
    for (const task of interrupted) {
      taskQueue.updateTask(task.id, {
        status: 'pending',
        result: null,
        startedAt: null,
        attempt: (task.attempt || 0) + 1,
        notes: 'Recovered from crash at ' + new Date().toISOString()
      });
      recovered++;
    }
    const freshQueue = taskQueue.getQueueSummary();
    const pendingCount = freshQueue.pending.length;
    const completedCount = freshQueue.stats.completed || 0;
    let msg = '\u2694\ufe0f *Sol v6.0 back online.*\n\n';
    if (recovered > 0) {
      msg += '\uD83D\uDD04 Resumed ' + recovered + ' interrupted task' + (recovered !== 1 ? 's' : '') + '.\n';
    }
    msg += '\uD83D\uDCCB Queue: ' + pendingCount + ' pending, ' + completedCount + ' completed total.\n';
    if (pendingCount > 0) {
      msg += '\nNext up:\n' + freshQueue.pending.slice(0, 3).map(function(t) { return '\u2022 ' + t.title; }).join('\n');
    } else {
      msg += '\nQueue is clear \u2014 what should I tackle next?';
    }
    await bot.sendMessage(OWNER_ID, msg, { parse_mode: 'Markdown' });
    console.log('[BOT] Startup recovery: ' + recovered + ' tasks resumed, ' + pendingCount + ' pending');
  } catch (e) {
    console.error('[BOT] Startup recovery error:', e.message);
  }
}, 3000); // Wait 3s for everything to initialize
