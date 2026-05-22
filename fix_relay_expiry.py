#!/usr/bin/env python3
"""Fix relay.js: add command expiry and fix the broken backtick escaping."""

RELAY_PATH = '/root/solomon-bot/relay.js'

with open(RELAY_PATH, 'r') as f:
    content = f.read()

# The previous patch broke the file with escaped backticks. Fix it.
# First, check if the broken line exists
if '\\`[EXPIRE]' in content:
    # Remove the broken expiry block and rewrite it properly
    # Find and remove the broken section
    lines = content.split('\n')
    new_lines = []
    skip = False
    for line in lines:
        if 'COMMAND_EXPIRY_MS' in line and 'const' in line:
            # Keep this constant but fix it
            new_lines.append('const COMMAND_EXPIRY_MS = 5 * 60 * 1000; // Commands expire after 5 minutes')
            continue
        if 'Filter out expired commands' in line:
            skip = True
            continue
        if skip and 'const commands = validCommands' in line:
            skip = False
            # Replace with the correct code
            new_lines.append('    // Filter out expired commands (older than 5 minutes)')
            new_lines.append('    const now = Date.now();')
            new_lines.append('    const validCommands = [];')
            new_lines.append('    for (const cmd of pendingCommands) {')
            new_lines.append('      if (now - cmd.queuedAt <= COMMAND_EXPIRY_MS) {')
            new_lines.append('        validCommands.push(cmd);')
            new_lines.append('      }')
            new_lines.append('    }')
            new_lines.append('    const expired = pendingCommands.length - validCommands.length;')
            new_lines.append('    if (expired > 0) console.log("[EXPIRE] Dropped " + expired + " stale commands");')
            new_lines.append('    pendingCommands.length = 0;')
            new_lines.append('    const commands = validCommands;')
            continue
        if skip:
            continue
        new_lines.append(line)
    content = '\n'.join(new_lines)
elif 'COMMAND_EXPIRY' not in content:
    # Fresh install - add the constant
    content = content.replace(
        'const HEARTBEAT_FILE',
        'const COMMAND_EXPIRY_MS = 5 * 60 * 1000; // Commands expire after 5 minutes\nconst HEARTBEAT_FILE'
    )
    # Add expiry logic in the poll handler
    content = content.replace(
        '// Send all pending commands\n    const commands = pendingCommands.splice(0, pendingCommands.length);',
        '''// Filter out expired commands (older than 5 minutes)
    const now = Date.now();
    const validCommands = [];
    for (const cmd of pendingCommands) {
      if (now - cmd.queuedAt <= COMMAND_EXPIRY_MS) {
        validCommands.push(cmd);
      }
    }
    const expired = pendingCommands.length - validCommands.length;
    if (expired > 0) console.log("[EXPIRE] Dropped " + expired + " stale commands");
    pendingCommands.length = 0;
    const commands = validCommands;'''
    )
else:
    print('[SKIP] COMMAND_EXPIRY already present and no broken backticks found')

with open(RELAY_PATH, 'w') as f:
    f.write(content)

import subprocess
result = subprocess.run(['node', '--check', RELAY_PATH], capture_output=True, text=True)
if result.returncode == 0:
    print('[OK] relay.js syntax valid')
else:
    print(f'[FAIL] {result.stderr}')
    exit(1)

print('[DONE] Relay expiry logic fixed')
