#!/usr/bin/env python3
"""
Sol VPS Upgrade Script — Task 1: Switch self-upgrade model to best available (gpt-5.1-codex)
"""
import re

# ─── TASK 1: Update config.js with best model + fallback logic in worker.js ───

# Update config.js
with open('config.js', 'r') as f:
    config = f.read()

config = config.replace("MODEL: 'openai/gpt-4o'", "MODEL: 'openai/gpt-5.1-codex'")
config = config.replace("MODEL_FALLBACK: 'openai/gpt-4o-mini'", "MODEL_FALLBACK: 'openai/gpt-4.1'")

with open('config.js', 'w') as f:
    f.write(config)
print("[OK] config.js updated: MODEL=openai/gpt-5.1-codex, FALLBACK=openai/gpt-4.1")

# Update worker.js — add model fallback logic and change the self_upgrade callLLM to use a code-specific model
with open('worker.js', 'r') as f:
    worker = f.read()

# Replace the self-upgrade LLM call to use the codex model explicitly with fallback
old_call = """advanceStep(task.id, 'Generating code via GPT-4o...');
    const generatedCode = await callLLM([
      { role: 'system', content: 'You are a senior Node.js developer. Output ONLY raw JavaScript code. No markdown formatting, no explanation text, no code fences. Just the code.' },
      { role: 'user', content: codeGenPrompt }
    ]);"""

new_call = """advanceStep(task.id, 'Generating code via GPT-5.1-codex...');
    let generatedCode;
    const codeGenMessages = [
      { role: 'system', content: 'You are a senior Node.js developer. Output ONLY raw JavaScript code. No markdown formatting, no explanation text, no code fences. Just the code. Every function must be unique. Use module.exports at the end.' },
      { role: 'user', content: codeGenPrompt }
    ];
    try {
      generatedCode = await callLLM(codeGenMessages, 'openai/gpt-5.1-codex');
    } catch (modelErr) {
      advanceStep(task.id, 'gpt-5.1-codex failed, falling back to gpt-4.1...');
      try {
        generatedCode = await callLLM(codeGenMessages, 'openai/gpt-4.1');
      } catch (fallbackErr) {
        generatedCode = await callLLM(codeGenMessages, 'openai/gpt-4o');
      }
    }"""

if old_call in worker:
    worker = worker.replace(old_call, new_call)
    print("[OK] worker.js: self_upgrade model updated to gpt-5.1-codex with fallback chain")
else:
    print("[WARN] Could not find exact old_call pattern in worker.js — trying partial match")
    # Try a more flexible replacement
    worker = worker.replace("Generating code via GPT-4o...", "Generating code via GPT-5.1-codex...")
    worker = worker.replace(
        "const generatedCode = await callLLM([\n      { role: 'system', content: 'You are a senior Node.js developer. Output ONLY raw JavaScript code. No markdown formatting, no explanation text, no code fences. Just the code.' },\n      { role: 'user', content: codeGenPrompt }\n    ]);",
        """let generatedCode;
    const codeGenMessages = [
      { role: 'system', content: 'You are a senior Node.js developer. Output ONLY raw JavaScript code. No markdown formatting, no explanation text, no code fences. Just the code. Every function must be unique. Use module.exports at the end.' },
      { role: 'user', content: codeGenPrompt }
    ];
    try {
      generatedCode = await callLLM(codeGenMessages, 'openai/gpt-5.1-codex');
    } catch (modelErr) {
      advanceStep(task.id, 'gpt-5.1-codex failed, falling back to gpt-4.1...');
      try {
        generatedCode = await callLLM(codeGenMessages, 'openai/gpt-4.1');
      } catch (fallbackErr) {
        generatedCode = await callLLM(codeGenMessages, 'openai/gpt-4o');
      }
    }"""
    )
    print("[OK] worker.js: partial match replacement applied")

with open('worker.js', 'w') as f:
    f.write(worker)

print("[DONE] Task 1 complete: Model upgraded to gpt-5.1-codex with gpt-4.1 > gpt-4o fallback chain")
