#!/usr/bin/env python3
"""
Integrate the self-improvement loop into bot.js:
1. Add require at top
2. Hook into the main message handler after safeSend (after every response)
3. Add /improvement_status command
"""

BOT_PATH = '/root/solomon-bot/bot.js'

with open(BOT_PATH, 'r') as f:
    content = f.read()

# ── 1. Add require at top (after existing requires) ──────────────────────────
REQUIRE_LINE = "const selfImprove = require('./self-improvement');"
if 'self-improvement' not in content:
    # Insert after the last require block
    anchor = "const { initWorker } = require('./worker');"
    if anchor in content:
        content = content.replace(anchor, anchor + '\n' + REQUIRE_LINE, 1)
        print('[OK] Added require for self-improvement module')
    else:
        print('[WARN] Could not find worker require anchor')
else:
    print('[SKIP] self-improvement already required')

# ── 2. Hook into message handler after safeSend sends the reply ──────────────
# Find the line: await safeSend(bot, chatId, prefix + cleanReply);
# Add the improvement loop call right after it
HOOK_OLD = "      await safeSend(bot, chatId, prefix + cleanReply);\n      // Auto-detect and silently execute PC commands from Sol's response"
HOOK_NEW = """      await safeSend(bot, chatId, prefix + cleanReply);
      // ── SELF-IMPROVEMENT: Analyze response for failure patterns ──────────
      setImmediate(() => {
        selfImprove.runSelfImprovementLoop(text || '', cleanReply, callLLM).catch(() => {});
      });
      // Auto-detect and silently execute PC commands from Sol's response"""

if 'SELF-IMPROVEMENT: Analyze' not in content:
    if HOOK_OLD in content:
        content = content.replace(HOOK_OLD, HOOK_NEW, 1)
        print('[OK] Hooked self-improvement into message handler')
    else:
        # Try alternate anchor
        alt_old = "      await safeSend(bot, chatId, prefix + cleanReply);"
        if alt_old in content:
            content = content.replace(alt_old, alt_old + '\n      // ── SELF-IMPROVEMENT ──\n      setImmediate(() => { selfImprove.runSelfImprovementLoop(text || \'\', cleanReply, callLLM).catch(() => {}); });', 1)
            print('[OK] Hooked self-improvement (alt anchor)')
        else:
            print('[WARN] Could not find safeSend anchor for hook')
else:
    print('[SKIP] Hook already present')

# ── 3. Add /improvement_status command ───────────────────────────────────────
CMD_MARKER = "bot.onText(/\\/improvement_status"
if CMD_MARKER not in content:
    # Find a good place to insert - after /task_results command
    anchor2 = "bot.onText(/\\/task_results"
    if anchor2 in content:
        # Find the end of that command block
        idx = content.find(anchor2)
        # Find the closing }); for this command
        end_idx = content.find('\n});', idx)
        if end_idx > 0:
            insert_pos = end_idx + 4  # after '});'
            new_cmd = """

bot.onText(/\\/improvement_status/, async (msg) => {
  const chatId = msg.chat.id;
  if (chatId !== config.OWNER_CHAT_ID) return;
  const summary = selfImprove.getImprovementSummary();
  const text = `*Sol Self-Improvement Status*\\n\\nTotal lessons logged: ${summary.totalLessons}\\nAuto-patches applied: ${summary.autoPatches}\\nTop issues: ${summary.topIssues.join(', ') || 'none yet'}\\nLast analyzed: ${summary.lastAnalyzed ? new Date(summary.lastAnalyzed).toLocaleString() : 'never'}`;
  await safeSend(bot, chatId, text);
});"""
            content = content[:insert_pos] + new_cmd + content[insert_pos:]
            print('[OK] Added /improvement_status command')
        else:
            print('[WARN] Could not find end of /task_results block')
    else:
        print('[WARN] Could not find /task_results anchor for command insertion')
else:
    print('[SKIP] /improvement_status already present')

with open(BOT_PATH, 'w') as f:
    f.write(content)

import subprocess
r = subprocess.run(['node', '--check', BOT_PATH], capture_output=True, text=True)
if r.returncode == 0:
    print('[OK] bot.js syntax valid')
else:
    print('[FAIL] Syntax error:', r.stderr[:300])
    import sys; sys.exit(1)

print('[DONE]')
