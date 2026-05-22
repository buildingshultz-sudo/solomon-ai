#!/usr/bin/env python3
"""
patch_worker_v2.py
Patches worker.js on the VPS using precise string replacement.
Targets the exact lines we read from the file.
"""
import sys

WORKER_FILE = '/root/solomon-bot/worker.js'

with open(WORKER_FILE, 'r') as f:
    code = f.read()

original_len = len(code)
changes = []

# ─── PATCH 1: Inject error context variables before codeGenPrompt ─────────────
OLD_STEP2 = "    // Step 2: Generate the code via LLM\n    const codeGenPrompt = `You are an expert Node.js developer. You are upgrading the Solomon autonomous bot."

NEW_STEP2 = """    // Step 2: Generate the code via LLM
    // Include previous error context if this is a retry
    const previousError = task.lastSyntaxError || task.failReason || null;
    const isRetry = (task.attempts || 0) > 0 && previousError;
    const errorContext = isRetry
      ? `\\n\\nPREVIOUS ATTEMPT FAILED WITH THIS ERROR:\\n${previousError}\\n\\nYou MUST fix this error. Common causes:\\n- Duplicate function/variable declarations (declare each name only ONCE)\\n- Missing or extra closing braces/brackets\\n- Using ES module 'export' syntax instead of CommonJS module.exports\\n- Redeclaring a const/let/var/function name that already exists in the same scope\\nCarefully scan your output top-to-bottom for any identifier declared more than once.\\n`
      : '';
    const codeGenPrompt = `You are an expert Node.js developer. You are upgrading the Solomon autonomous bot."""

if OLD_STEP2 in code:
    code = code.replace(OLD_STEP2, NEW_STEP2, 1)
    changes.append('✅ Injected error context variables before codeGenPrompt')
else:
    print('ERROR: Could not find Step 2 marker', file=sys.stderr)
    sys.exit(1)

# ─── PATCH 2: Add no-duplicate rules + errorContext to the prompt body ─────────
OLD_REQUIREMENTS_END = """- If modifying an existing file, output the COMPLETE file (not just the changes)
OUTPUT: Return ONLY the complete JavaScript code. No markdown, no explanation, no \\`\\`\\` blocks. Just raw JavaScript.`;"""

NEW_REQUIREMENTS_END = """- If modifying an existing file, output the COMPLETE file (not just the changes)
- For NEW files: end with module.exports = { ...all public functions }
- CRITICAL: NEVER declare the same function or variable name twice in the same file
- CRITICAL: NEVER use duplicate const/let/var/function declarations${errorContext}
OUTPUT: Return ONLY the complete JavaScript code. No markdown, no explanation, no \\`\\`\\` blocks. Just raw JavaScript.`;"""

if OLD_REQUIREMENTS_END in code:
    code = code.replace(OLD_REQUIREMENTS_END, NEW_REQUIREMENTS_END, 1)
    changes.append('✅ Added no-duplicate rules and errorContext to prompt body')
else:
    print('WARNING: Could not find requirements end block — trying alternate form')
    # Try without the escaped backticks
    ALT_OLD = "- If modifying an existing file, output the COMPLETE file (not just the changes)\nOUTPUT: Return ONLY the complete JavaScript code. No markdown, no explanation, no `"
    if ALT_OLD in code:
        idx = code.index(ALT_OLD)
        end_idx = code.index('`;', idx) + 2
        old_block = code[idx:end_idx]
        new_block = old_block.replace(
            "- If modifying an existing file, output the COMPLETE file (not just the changes)\nOUTPUT:",
            "- If modifying an existing file, output the COMPLETE file (not just the changes)\n- For NEW files: end with module.exports = { ...all public functions }\n- CRITICAL: NEVER declare the same function or variable name twice in the same file\n- CRITICAL: NEVER use duplicate const/let/var/function declarations${errorContext}\nOUTPUT:"
        )
        code = code[:idx] + new_block + code[end_idx:]
        changes.append('✅ Added no-duplicate rules (alternate approach)')
    else:
        print('ERROR: Cannot find requirements end block in any form', file=sys.stderr)
        sys.exit(1)

# ─── PATCH 3: Update advanceStep to mention retry ─────────────────────────────
OLD_ADVANCE = "    advanceStep(task.id, 'Generating code via GPT-4o...');"
NEW_ADVANCE = "    advanceStep(task.id, `Generating code via GPT-4o${isRetry ? ' (retry — error context included)' : ''}...`);"

if OLD_ADVANCE in code:
    code = code.replace(OLD_ADVANCE, NEW_ADVANCE, 1)
    changes.append('✅ Updated advanceStep to show retry context')
else:
    changes.append('⚠️  advanceStep line not found (may already be patched)')

# ─── PATCH 4: Upgrade system prompt in callLLM ────────────────────────────────
OLD_SYS = "      { role: 'system', content: 'You are a senior Node.js developer. Output ONLY raw JavaScript code. No markdown formatting, no explanation text, no code fences. Just the code.' },"

NEW_SYS = """      { role: 'system', content: `You are a senior Node.js developer writing a standalone Node.js module.

CRITICAL RULES — MUST FOLLOW:
1. Output ONLY raw JavaScript code. No markdown, no explanation, no code fences, no backtick blocks.
2. This is a NEW MODULE FILE. Do NOT copy or redeclare functions from other files (bot.js, worker.js, etc.).
3. Every function name in this file must be UNIQUE — no duplicate const/function/let/var declarations anywhere.
4. End the file with a module.exports = { ... } block exporting all public functions.
5. Do NOT use ES module 'export default' syntax — use CommonJS require/module.exports only.
6. Do NOT redeclare variables already declared in the same scope.
7. If you need a helper function, define it ONCE only.` },"""

if OLD_SYS in code:
    code = code.replace(OLD_SYS, NEW_SYS, 1)
    changes.append('✅ Upgraded system prompt with strict no-duplicate rules')
else:
    changes.append('⚠️  System prompt line not found verbatim (may already be patched by previous run)')

# ─── PATCH 5: Store syntax error on task before throwing ──────────────────────
OLD_THROW = "          throw new Error(`Generated code has syntax error: ${syntaxError.message}`);"
NEW_THROW = """          const errMsg = `Syntax error in generated code: ${syntaxError.message}. Check for duplicate declarations (same name declared twice), missing/extra braces, or invalid syntax.`;
          updateTask(task.id, { lastSyntaxError: errMsg });
          throw new Error(errMsg);"""

if OLD_THROW in code:
    code = code.replace(OLD_THROW, NEW_THROW, 1)
    changes.append('✅ Patched syntax error throw to store error on task.lastSyntaxError')
else:
    changes.append('⚠️  Syntax throw line not found verbatim')

# ─── PATCH 6: Store PM2 restart error on task ─────────────────────────────────
OLD_PM2 = "        throw new Error(`PM2 restart failed after code deploy: ${restartErr.message}. Rolled back to backup.`);"
NEW_PM2 = """        const pm2ErrMsg = `PM2 restart failed: ${restartErr.message}. The generated code likely has a runtime error — check for undefined variables, missing requires, or logic errors at startup. Rolled back to backup.`;
        updateTask(task.id, { lastSyntaxError: pm2ErrMsg });
        throw new Error(pm2ErrMsg);"""

if OLD_PM2 in code:
    code = code.replace(OLD_PM2, NEW_PM2, 1)
    changes.append('✅ Patched PM2 restart error to store on task.lastSyntaxError')
else:
    changes.append('⚠️  PM2 throw line not found verbatim')

# ─── WRITE ────────────────────────────────────────────────────────────────────
with open(WORKER_FILE, 'w') as f:
    f.write(code)

print(f'\n✅ worker.js patched ({len(code)} chars, was {original_len})')
print('\nChanges applied:')
for c in changes:
    print(f'  {c}')
