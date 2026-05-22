#!/usr/bin/env python3
"""Add a queue depth guard to executeOnPC in bot.js to prevent command spam."""
import subprocess

BOT_PATH = '/root/solomon-bot/bot.js'

with open(BOT_PATH, 'r') as f:
    content = f.read()

# Check if guard already exists
if 'Queue full' in content or 'queue.*full' in content:
    print('[SKIP] Queue guard already present')
    exit(0)

# Find the executeOnPC function
target = "async function executeOnPC(command, type = 'powershell', timeoutMs = 60000) {\n  try {"

if target not in content:
    print('[FAIL] Could not find executeOnPC function header')
    exit(1)

replacement = """async function executeOnPC(command, type = 'powershell', timeoutMs = 60000) {
  try {
    // Guard: check relay queue depth before adding more commands
    try {
      const hRes = await fetch(config.RELAY_URL + '/health');
      const hData = await hRes.json();
      if (hData.pending >= 5) {
        console.log('[PC] Queue full (' + hData.pending + ' pending). Refusing to add more.');
        return { success: false, output: 'PC Agent queue is full (' + hData.pending + ' pending). Agent may be offline.' };
      }
    } catch (e) { /* health check failed, proceed anyway */ }"""

content = content.replace(target, replacement)

with open(BOT_PATH, 'w') as f:
    f.write(content)

result = subprocess.run(['node', '--check', BOT_PATH], capture_output=True, text=True)
if result.returncode == 0:
    print('[OK] bot.js syntax valid with queue guard')
else:
    print(f'[FAIL] {result.stderr}')
    exit(1)

print('[DONE] Queue depth guard added')
