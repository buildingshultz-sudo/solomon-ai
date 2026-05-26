// fix7_worker_upgrade.js — Upgrade the task worker to use tools and a proper agentic loop
const fs = require('fs');
const path = '/root/solomon-v4/scheduler.js';
let code = fs.readFileSync(path, 'utf8');

// Step 1: Add TOOL_DEFINITIONS import (executeTool is already imported)
const oldImport = "const { executeTool } = require('./tools');";
const newImport = "const { executeTool, TOOL_DEFINITIONS } = require('./tools');";
code = code.replace(oldImport, newImport);

// Step 2: Replace the entire task worker cron job (the broken one) with a proper agentic version
const oldWorkerStart = `cron.schedule('*/5 * * * *', async () => {
  const pending = tasks.getPending();
  if (!pending.length) return;`;

// Find the old worker and replace everything up to the closing of that cron.schedule
const workerStartIdx = code.indexOf(oldWorkerStart);
if (workerStartIdx === -1) {
  console.error('ERROR: Could not find task worker cron job');
  process.exit(1);
}

// Find the end of this cron.schedule block - look for the next ITEM comment
const nextItemIdx = code.indexOf('// ══════════════════', workerStartIdx + 100);
// Go back to find the closing });
const closingIdx = code.lastIndexOf('});', nextItemIdx);

const oldWorker = code.substring(workerStartIdx, closingIdx + 3);

const newWorker = `cron.schedule('*/5 * * * *', async () => {
  const pending = tasks.getPending();
  if (!pending.length) return;
  const task = pending[0];
  if (task.retries > 0 && task.started_at) {
    const lastAttempt = new Date(task.started_at).getTime();
    const backoffMinutes = Math.pow(5, task.retries);
    const waitUntil = lastAttempt + (backoffMinutes * 60 * 1000);
    if (Date.now() < waitUntil) {
      console.log(\`[WORKER] Task #\${task.id} backing off (retry \${task.retries}, wait \${backoffMinutes}m)\`);
      return;
    }
  }
  console.log(\`[WORKER] Starting task #\${task.id}: \${task.title} (retry \${task.retries}/3)\`);
  tasks.start(task.id);
  try {
    // Worker system prompt — gives Solomon context for background task execution
    const workerSystem = \`You are Solomon, an autonomous AI agent executing a background task for Jedidiah Shultz (Shultz Enterprises).
You have full tool access. Use your tools to ACTUALLY complete the task — do not just describe what you would do.
Rules:
1. You MUST call tools to complete work. Text-only responses = failure.
2. After completing, provide a brief summary of what you actually did.
3. If a task requires PC access, use the pc_* tools. If it requires VPS work, use vps_execute or file_write/file_edit.
4. Budget awareness: keep costs minimal. Do not make unnecessary API calls.
5. If you cannot complete the task, explain exactly why and what's blocking you.\`;

    // Agentic tool-use loop (same pattern as bot.js)
    let messages = [{ role: 'user', content: \`Execute this task:\\n\\nTitle: \${task.title}\\nDescription: \${task.description}\\nType: \${task.type || 'general'}\\nPriority: \${task.priority || 5}\` }];
    let totalInput = 0;
    let totalOutput = 0;
    let iterations = 0;
    const MAX_ITERATIONS = 10;

    while (iterations < MAX_ITERATIONS) {
      iterations++;
      const resp = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: workerSystem,
        tools: TOOL_DEFINITIONS,
        messages: messages
      });
      totalInput += resp.usage.input_tokens;
      totalOutput += resp.usage.output_tokens;

      // If no tool use, we're done
      if (resp.stop_reason !== 'tool_use') {
        const textBlock = resp.content.find(b => b.type === 'text');
        const result = textBlock ? textBlock.text : 'Task completed (no text response)';
        budget.log({ inputTokens: totalInput, outputTokens: totalOutput, model: MODEL });
        tasks.complete(task.id, result);
        bot.sendMessage(OWNER_ID, \`✅ Task #\${task.id} done: \${task.title}\\n\${result.slice(0, 300)}\`).catch(() => {});
        console.log(\`[WORKER] Task #\${task.id} completed in \${iterations} iteration(s)\`);
        return;
      }

      // Process tool calls
      messages.push({ role: 'assistant', content: resp.content });
      const toolResults = [];
      for (const block of resp.content) {
        if (block.type === 'tool_use') {
          console.log(\`[WORKER] Tool call: \${block.name} \${JSON.stringify(block.input).slice(0, 100)}\`);
          try {
            const toolResult = await executeTool(block.name, block.input);
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(toolResult).slice(0, 4000) });
          } catch (toolErr) {
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ ok: false, error: toolErr.message }), is_error: true });
          }
        }
      }
      messages.push({ role: 'user', content: toolResults });
    }

    // If we hit max iterations, mark as done with warning
    budget.log({ inputTokens: totalInput, outputTokens: totalOutput, model: MODEL });
    tasks.complete(task.id, \`Completed after \${MAX_ITERATIONS} iterations (may be partial)\`);
    bot.sendMessage(OWNER_ID, \`⚠️ Task #\${task.id} hit iteration limit: \${task.title}\`).catch(() => {});
    console.log(\`[WORKER] Task #\${task.id} hit max iterations\`);
  } catch (err) {
    console.error(\`[WORKER] Task #\${task.id} failed:\`, err.message);
    const retries = tasks.incrementRetry(task.id);
    if (retries >= 3) {
      tasks.fail(task.id, \`Max retries reached: \${err.message}\`);
      bot.sendMessage(OWNER_ID, \`❌ Task #\${task.id} failed after 3 retries: \${task.title}\\n\${err.message.slice(0, 150)}\`).catch(() => {});
    } else {
      const nextBackoff = Math.pow(5, retries);
      bot.sendMessage(OWNER_ID, \`⚠️ Task #\${task.id} retry \${retries}/3 (next attempt in \${nextBackoff}m): \${task.title}\`).catch(() => {});
    }
  }
})`;

code = code.replace(oldWorker, newWorker);

fs.writeFileSync(path, code, 'utf8');
console.log('✅ Task worker upgraded with tools, system prompt, and agentic loop');
console.log('   - TOOL_DEFINITIONS imported');
console.log('   - Worker now has system prompt');
console.log('   - Worker now passes all 84 tools to Claude');
console.log('   - Worker now has tool-use loop (max 10 iterations)');
console.log('   - max_tokens increased from 1024 to 4096');
