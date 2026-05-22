/**
 * patch_rate_limit.js
 * Implements a global message rate limiter in bot.js and worker.js.
 * 
 * 1. Adds a 3-second delay between messages to the same chat.
 * 2. Extends the duplicate message window to 60 seconds.
 * 3. Adds a worker-level check to prevent sending the same error twice.
 */
const fs = require('fs');
const path = require('path');

// ─── PATCH bot.js ────────────────────────────────────────────────────────────
const BOT_FILE = path.join(__dirname, 'bot.js');
let botCode = fs.readFileSync(BOT_FILE, 'utf8');

// 1. Update isDuplicateMessage to 60s window
const oldDedup = 'setTimeout(() => recentSentMessages.delete(key), 10000); // 10s dedup window';
const newDedup = 'setTimeout(() => recentSentMessages.delete(key), 60000); // 60s dedup window';
botCode = botCode.replace(oldDedup, newDedup);

// 2. Add rate limiting to safeSend
const lastSentTimes = {};
const oldSafeSend = `async function safeSend(bot, chatId, text) {
  if (isDuplicateMessage(chatId, text)) { console.log('[DEDUP] Blocked duplicate message'); return; }
  if (!text || !text.trim()) return;
  const chunks = text.length > 4000 ? text.match(/[\\s\\S]{1,4000}/g) : [text];
  for (const chunk of chunks) {
    try {
      await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
    } catch (e) {
      if (e.message?.includes('parse') || e.message?.includes("can't parse")) {
        try { await bot.sendMessage(chatId, chunk); } catch (e2) { logError('send_plain', e2); }
      } else { logError('send', e); }
    }
  }
}`;

const newSafeSend = `const lastSentTimes = {};
async function safeSend(bot, chatId, text) {
  if (!text || !text.trim()) return;
  if (isDuplicateMessage(chatId, text)) { console.log('[DEDUP] Blocked duplicate message'); return; }
  
  // Rate limiting: 3s between messages to same chat
  const now = Date.now();
  const lastSent = lastSentTimes[chatId] || 0;
  const waitTime = Math.max(0, 3000 - (now - lastSent));
  if (waitTime > 0) {
    console.log(\`[RATE_LIMIT] Waiting \${waitTime}ms before sending to \${chatId}\`);
    await new Promise(r => setTimeout(r, waitTime));
  }
  lastSentTimes[chatId] = Date.now();

  const chunks = text.length > 4000 ? text.match(/[\\s\\S]{1,4000}/g) : [text];
  for (const chunk of chunks) {
    try {
      await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
    } catch (e) {
      if (e.message?.includes('parse') || e.message?.includes("can't parse")) {
        try { await bot.sendMessage(chatId, chunk); } catch (e2) { logError('send_plain', e2); }
      } else { logError('send', e); }
    }
  }
}`;

botCode = botCode.replace(oldSafeSend, newSafeSend);
fs.writeFileSync(BOT_FILE, botCode, 'utf8');
console.log('✅ bot.js patched with 60s dedup and 3s rate limiting');

// ─── PATCH worker.js ─────────────────────────────────────────────────────────
const WORKER_FILE = path.join(__dirname, 'worker.js');
let workerCode = fs.readFileSync(WORKER_FILE, 'utf8');

// Add a check in the main loop to prevent sending the same error twice
const oldErrorNotify = `        if (isNewError) {
          await safeSend(bot, config.OWNER_CHAT_ID, \`⚠️ *Task Error: \${task.title}*\\n\\n\${failReason}\\n\\nRetrying (\${attempts}/\${MAX_TASK_ATTEMPTS}).\`);
        }`;

const newErrorNotify = `        if (isNewError && !task._errorNotified) {
          await safeSend(bot, config.OWNER_CHAT_ID, \`⚠️ *Task Error: \${task.title}*\\n\\n\${failReason}\\n\\nRetrying (\${attempts}/\${MAX_TASK_ATTEMPTS}).\`);
          updateTask(task.id, { _errorNotified: true });
        }`;

workerCode = workerCode.replace(oldErrorNotify, newErrorNotify);
fs.writeFileSync(WORKER_FILE, workerCode, 'utf8');
console.log('✅ worker.js patched with error notification deduplication');
