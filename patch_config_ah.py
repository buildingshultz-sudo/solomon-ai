#!/usr/bin/env python3
"""Inject anti-hallucination rule into config.js system prompt."""
import subprocess, sys

CONFIG_PATH = '/root/solomon-bot/config.js'

with open(CONFIG_PATH, 'r') as f:
    content = f.read()

rule = (
    '\n\n## ZERO TOLERANCE: NO FABRICATED PROGRESS\n\n'
    'This is the most critical rule in your entire operating system.\n\n'
    'NEVER fabricate task progress. NEVER invent percentages. NEVER claim work is happening '
    'that is not in your actual task queue.\n\n'
    'When Jed asks about progress or what you are working on:\n'
    '1. You will receive a [REAL TASK STATUS] injection in your context.\n'
    '2. You MUST report ONLY what is in that injection — nothing more.\n'
    '3. If the status says NO TASKS ARE CURRENTLY QUEUED, you MUST say the queue is empty '
    'and ask Jed what to start.\n'
    '4. You are FORBIDDEN from saying things like "proxy build at 62%" or "mock-up at 40%" '
    'unless those exact tasks appear in your queue with those exact percentages.\n'
    '5. Violating this rule destroys Jed\'s trust and makes you useless as a Chief of Staff.\n\n'
    'If you do not have real data, say: "Let me check." Then check. Then report what you actually found.\n'
)

# The system prompt template literal ends with backtick then newline then };
# Find the last backtick before the closing }; of the module.exports object
lines = content.split('\n')
# Find the line with just a backtick that closes the template literal
closing_line_idx = None
for i in range(len(lines) - 1, -1, -1):
    stripped = lines[i].strip()
    if stripped == '`' or stripped == '`;' or stripped.endswith('task to build it.`'):
        closing_line_idx = i
        break

if closing_line_idx is None:
    print('[FAIL] Could not find closing backtick line')
    print('Last 5 lines:', lines[-5:])
    sys.exit(1)

print(f'[OK] Found closing backtick at line {closing_line_idx}: {repr(lines[closing_line_idx])}')

# Check if already patched
if 'ZERO TOLERANCE' in content:
    print('[SKIP] Anti-hallucination rule already present in config.js')
    sys.exit(0)

# The closing backtick is at the END of a content line (e.g. 'build it.`')
# We need to insert the rule text BEFORE the backtick on that line
if lines[closing_line_idx].strip().endswith('`') and not lines[closing_line_idx].strip() == '`':
    # Backtick is at end of a content line — split it
    line = lines[closing_line_idx]
    bt_pos = line.rfind('`')
    lines[closing_line_idx] = line[:bt_pos] + rule + '`'
else:
    # Backtick is on its own line — insert before it
    rule_lines = rule.split('\n')
    lines = lines[:closing_line_idx] + rule_lines + lines[closing_line_idx:]

new_content = '\n'.join(lines)
with open(CONFIG_PATH, 'w') as f:
    f.write(new_content)
print('[OK] Injected anti-hallucination rule into config.js')

# Validate syntax
result = subprocess.run(['node', '--check', CONFIG_PATH], capture_output=True, text=True)
if result.returncode == 0:
    print('[OK] config.js syntax check passed')
else:
    print(f'[FAIL] Syntax error: {result.stderr}')
    sys.exit(1)

print('[DONE]')
