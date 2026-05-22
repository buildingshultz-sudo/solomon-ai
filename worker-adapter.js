/**
 * Worker Adapter — bridges worker.js (v6) with the new bot.js plugin architecture
 *
 * The worker.js expects deps.core.{callLLM, webSearch, executeOnPC, safeSend}
 * This adapter provides those from the new plugin system.
 */

const { initWorker } = require('./worker');

module.exports = {
  start(config, deps) {
    const { bot, memory, taskQueue, pluginLoader, callLLM, executeTool, OWNER_ID } = deps;

    // Adapt callLLM to worker's expected signature (messages -> string)
    async function workerCallLLM(messages) {
      try {
        const response = await callLLM(messages);
        return response.content || '';
      } catch (e) {
        console.error('[WORKER-ADAPTER] LLM call failed:', e.message);
        return null;
      }
    }

    // Adapt web search
    async function webSearch(query) {
      try {
        const result = await executeTool('web_search', { query, detailed: true }, OWNER_ID);
        // Normalize to expected format
        if (result.answer) {
          return {
            success: true,
            source: result.source,
            results: result.citations ? result.citations.map(url => ({ title: url, url, snippet: '' })) : [],
            answer: result.answer
          };
        }
        return result;
      } catch (e) {
        return { success: false, error: e.message, results: [] };
      }
    }

    // Adapt PC execution
    async function executeOnPC(command, type = 'powershell') {
      try {
        const result = await executeTool('pc_execute', { command, timeout: 60000 }, OWNER_ID);
        return result;
      } catch (e) {
        return { success: false, error: e.message };
      }
    }

    // Safe send (handles Telegram markdown errors)
    async function safeSend(botInstance, chatId, text, options = {}) {
      try {
        return await botInstance.sendMessage(chatId, text, { parse_mode: 'Markdown', ...options });
      } catch {
        return await botInstance.sendMessage(chatId, text.replace(/[*_`\[\]]/g, ''));
      }
    }

    // Knowledge base adapter
    function addToKB(category, data) {
      memory.addKnowledge(category, typeof data === 'string' ? data : JSON.stringify(data));
    }

    // Initialize worker with adapted deps
    initWorker(bot, { ...config, OWNER_CHAT_ID: OWNER_ID }, {
      core: { callLLM: workerCallLLM, webSearch, executeOnPC, safeSend },
      knowledgeBase: { addToKB }
    });
  }
};
