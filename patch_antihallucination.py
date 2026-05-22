#!/usr/bin/env python3
"""
Anti-hallucination progress reporting guard.
Patches bot.js to inject REAL task queue status before GPT answers progress questions.
Patches config.js to add a hard zero-tolerance rule against fabricating progress.
"""
import sys

# ── Patch 1: bot.js — inject real task status before GPT for progress questions ──

with open('/root/solomon-bot/bot.js', 'r') as f:
    bot = f.read()

# The getActiveTaskStatus function to add near the top of the file (after require statements)
task_status_fn = '''
// ─── ANTI-HALLUCINATION: Real Task Status ─────────────────────────────────────
// Returns the REAL state of the task queue. Called before GPT answers any
// progress/status question to prevent fabricated progress reports.
function getActiveTaskStatus() {
  try {
    const fs = require('fs');
    const qPath = require('path').join(__dirname, 'task-queue.json');
    if (!fs.existsSync(qPath)) return { empty: true, summary: 'Task queue file not found.' };
    const raw = JSON.parse(fs.readFileSync(qPath, 'utf8'));
    const tasks = Array.isArray(raw) ? raw : (raw.tasks || Object.values(raw));
    const active = tasks.filter(t => t.status === 'pending' || t.status === 'in_progress' || t.status === 'active');
    const recentDone = tasks
      .filter(t => t.status === 'completed' && t.completedAt && (Date.now() - t.completedAt) < 3600000)
      .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
      .slice(0, 3);
    if (active.length === 0 && recentDone.length === 0) {
      return { empty: true, summary: 'No tasks are currently queued or running. Nothing is being worked on right now.' };
    }
    let summary = '';
    if (active.length > 0) {
      summary += `ACTIVE/PENDING TASKS (${active.length}):\\n`;
      active.forEach(t => {
        summary += `  - [${t.status.toUpperCase()}] ${t.title} (type: ${t.type}, attempts: ${t.attempts || 0})\\n`;
      });
    }
    if (recentDone.length > 0) {
      summary += `\\nRECENTLY COMPLETED (last hour):\\n`;
      recentDone.forEach(t => {
        const ago = Math.round((Date.now() - t.completedAt) / 60000);
        summary += `  - [DONE ${ago}m ago] ${t.title}\\n`;
      });
    }
    return { empty: active.length === 0, summary: summary.trim(), activeCount: active.length };
  } catch (e) {
    return { empty: true, summary: `Could not read task queue: ${e.message}` };
  }
}

// Keywords that indicate Jed is asking about Sol's current work/progress
const PROGRESS_KEYWORDS = /\\b(progress|status|how.*(going|it|things)|what.*(working on|doing|up to|happening)|update|any updates|check in|check-in|how are (you|things|we)|what.*(done|finished|completed|built)|still working|still running|background|autonomous|tasks?|queue|working on anything)\\b/i;
'''

# Insert the function after the last require/const block at the top
# Find a good insertion point: after the healthStatus declaration
insert_after = 'let healthStatus = { telegram: true, openrouter: true, pm2: true };'
if insert_after in bot:
    bot = bot.replace(insert_after, insert_after + '\n' + task_status_fn)
    print('[OK] Inserted getActiveTaskStatus() and PROGRESS_KEYWORDS into bot.js')
else:
    # Fallback: insert after the first async function
    insert_after2 = 'async function callLLM('
    if insert_after2 in bot:
        bot = bot.replace(insert_after2, task_status_fn + '\nasync function callLLM(')
        print('[OK] Inserted getActiveTaskStatus() before callLLM (fallback position)')
    else:
        print('[FAIL] Could not find insertion point in bot.js')
        sys.exit(1)

# ── Patch 2: Inject real status into contextInjection before GPT call ──────────
# Find the progress/status injection point — right before the messages array is built
old_context_build = "    const messages = [\n      { role: 'system', content: config.SYSTEM_PROMPT + buildContext(chatId) + contextInjection },"
new_context_build = """    // ── ANTI-HALLUCINATION GUARD: Inject real task status for progress questions ──
    if (PROGRESS_KEYWORDS.test(text)) {
      const realStatus = getActiveTaskStatus();
      if (realStatus.empty) {
        contextInjection += `\\n\\n[REAL TASK STATUS — MANDATORY: You MUST report this exactly. Do NOT invent or fabricate any progress, percentages, or task statuses.]\\nNO TASKS ARE CURRENTLY QUEUED OR RUNNING. Nothing is being worked on autonomously right now. You MUST tell Jed the queue is empty and ask what he would like you to start. Do NOT say things like "still working on X" or "62% complete" — that would be a lie.\\n`;
      } else {
        contextInjection += `\\n\\n[REAL TASK STATUS — MANDATORY: Report ONLY what is listed here. Do NOT invent additional tasks, percentages, or progress beyond what is shown.]\\n${realStatus.summary}\\n`;
      }
    }

    const messages = [
      { role: 'system', content: config.SYSTEM_PROMPT + buildContext(chatId) + contextInjection },"""

if old_context_build in bot:
    bot = bot.replace(old_context_build, new_context_build)
    print('[OK] Injected real task status guard into message handler')
else:
    print('[FAIL] Could not find messages array build point in bot.js')
    # Show context for debugging
    idx = bot.find("const messages = [")
    if idx >= 0:
        print('Found messages at index', idx)
        print('Context:', repr(bot[max(0,idx-200):idx+100]))
    sys.exit(1)

with open('/root/solomon-bot/bot.js', 'w') as f:
    f.write(bot)
print('[OK] bot.js written')

# ── Patch 3: config.js — add hard zero-tolerance rule to system prompt ─────────
with open('/root/solomon-bot/config.js', 'r') as f:
    config = f.read()

# Find the end of the system prompt and inject the rule before the closing backtick
# The system prompt ends with a backtick on its own line
anti_hallucination_rule = """
## ZERO TOLERANCE: NO FABRICATED PROGRESS

This is the most critical rule in your entire operating system.

**NEVER fabricate task progress. NEVER invent percentages. NEVER claim work is happening that is not in your actual task queue.**

When Jed asks "how's it going?", "what are you working on?", or any similar question:
1. You will receive a [REAL TASK STATUS] injection in your context.
2. You MUST report ONLY what is in that injection — nothing more.
3. If the status says "NO TASKS ARE CURRENTLY QUEUED", you MUST say the queue is empty and ask Jed what to start.
4. You are FORBIDDEN from saying things like "proxy build at 62%", "mock-up at 40%", or any invented status.
5. Violating this rule destroys Jed's trust and makes you useless as a Chief of Staff.

If you do not have real data, say: "Let me check." Then check. Then report what you actually found.

"""

# Find the last occurrence of the system prompt closing pattern
# Look for the end of the SYSTEM_PROMPT template literal
# The prompt ends before `module.exports`
if 'module.exports' in config and 'SYSTEM_PROMPT' in config:
    # Find the position just before module.exports
    module_exports_idx = config.rfind('module.exports')
    # Find the backtick that closes the template literal just before module.exports
    # Walk backwards from module.exports to find the closing backtick
    search_region = config[:module_exports_idx]
    last_backtick = search_region.rfind('`;')
    if last_backtick >= 0:
        # Insert the rule just before the closing backtick
        config = config[:last_backtick] + anti_hallucination_rule + config[last_backtick:]
        print('[OK] Injected anti-hallucination rule into system prompt')
    else:
        # Try just a backtick without semicolon
        last_backtick = search_region.rfind('`')
        if last_backtick >= 0:
            config = config[:last_backtick] + anti_hallucination_rule + config[last_backtick:]
            print('[OK] Injected anti-hallucination rule into system prompt (no semicolon form)')
        else:
            print('[FAIL] Could not find system prompt closing backtick')
            sys.exit(1)
else:
    print('[FAIL] Could not find module.exports or SYSTEM_PROMPT in config.js')
    sys.exit(1)

with open('/root/solomon-bot/config.js', 'w') as f:
    f.write(config)
print('[OK] config.js written')

# ── Patch 4: Syntax validation ────────────────────────────────────────────────
import subprocess
for fname in ['bot.js', 'config.js']:
    result = subprocess.run(['node', '--check', f'/root/solomon-bot/{fname}'], capture_output=True, text=True)
    if result.returncode == 0:
        print(f'[OK] {fname} syntax check passed')
    else:
        print(f'[FAIL] {fname} syntax error:\n{result.stderr}')
        sys.exit(1)

print('[DONE] All anti-hallucination patches applied and validated')
