#!/bin/bash
# Patch bot.js to add activity logging hooks
# This is non-destructive — adds hooks at specific injection points

cd /root/solomon-v4

# Backup original
cp bot.js bot.js.bak

# 1. Add activity-logger require after the tools require (line 14)
sed -i '/const { TOOL_DEFINITIONS, executeTool } = require(.\/tools.);/a\const activityLogger = require('"'"'./activity-logger'"'"');' bot.js

# 2. Write bot start time file after the log('INFO', 'SYSTEM', 'Solomon V4 starting' line
sed -i "/log('INFO', 'SYSTEM', 'Solomon V4 starting'/a\\
try { require('fs').writeFileSync(require('path').join(__dirname, '.bot-start-time'), new Date().toISOString()); } catch(_) {}" bot.js

# 3. In the message handler — log message_received right after the text extraction
# Find: "log('INFO', 'MSG', `Jed: ${text.slice(0, 100)}`);"
# Add after it: activityLogger.logActivity('message_received', { summary: text.slice(0, 100) });
sed -i "/log('INFO', 'MSG', \`Jed: /a\\  activityLogger.logActivity('message_received', { summary: text.slice(0, 100) });" bot.js

# 4. Set status to THINKING when askSolomon is called
# Find the line: "async function askSolomon(userMessage) {"
# Add after it: activityLogger.setStatus('THINKING', userMessage.slice(0, 80));
sed -i '/async function askSolomon(userMessage) {/a\  activityLogger.setStatus('"'"'THINKING'"'"', userMessage.slice(0, 80));' bot.js

# 5. Wrap tool execution with timing and logging
# The tool loop is: "const result = await executeTool(tu.name, tu.input);"
# Replace with timed version
sed -i 's/const result = await executeTool(tu.name, tu.input);/const _toolStart = Date.now();\n      activityLogger.setStatus('"'"'WORKING'"'"', `Tool: ${tu.name}`);\n      activityLogger.logActivity('"'"'tool_call'"'"', { toolName: tu.name, status: '"'"'started'"'"', summary: `Calling ${tu.name}` });\n      const result = await executeTool(tu.name, tu.input);\n      const _toolDur = Date.now() - _toolStart;\n      activityLogger.logActivity('"'"'tool_call'"'"', { toolName: tu.name, status: '"'"'ok'"'"', summary: `${tu.name} completed`, durationMs: _toolDur });/' bot.js

# 6. Set status back to IDLE and log message_sent after askSolomon returns in the message handler
# Find: "const reply = await askSolomon(text);" (in the message handler, around line 449)
# We need to add after the sendLongMessage call
# Find: "await sendLongMessage(msg.chat.id, reply, { parse_mode: 'Markdown' });" (the one in the text handler)
# There are multiple sendLongMessage calls; we target the one in the main text handler
# The pattern after the try { const reply = await askSolomon(text); line
sed -i '/const reply = await askSolomon(text);/{n;s/await sendLongMessage(msg.chat.id, reply, { parse_mode: '"'"'Markdown'"'"' });/await sendLongMessage(msg.chat.id, reply, { parse_mode: '"'"'Markdown'"'"' });\n    activityLogger.logActivity('"'"'message_sent'"'"', { summary: reply.slice(0, 100) });\n    activityLogger.setStatus('"'"'IDLE'"'"', '"'"''"'"');/}' bot.js

# 7. Log errors in the catch block of the message handler
# Find: "log('ERROR', 'MSG', 'Message handler error'"
sed -i "/log('ERROR', 'MSG', 'Message handler error'/a\\    activityLogger.logActivity('error', { status: 'error', summary: err.message.slice(0, 200) });\n    activityLogger.setStatus('IDLE', '');" bot.js

# 8. Set IDLE status at the end of askSolomon (before return finalText)
sed -i '/return finalText;/i\  activityLogger.setStatus('"'"'IDLE'"'"', '"'"''"'"');' bot.js

echo "Patch complete. Verifying syntax..."
node -c bot.js
