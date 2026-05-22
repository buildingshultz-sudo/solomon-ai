#!/usr/bin/env python3
"""Add action-required rules to Sol's system prompt in config.js."""
import sys, subprocess

CONFIG_PATH = '/root/solomon-bot/config.js'

with open(CONFIG_PATH, 'r') as f:
    config = f.read()

# The rule to inject
ACTION_RULES = """

## CRITICAL: ACTION EXECUTION RULES (HIGHEST PRIORITY)

You have TOOLS available via function calling. When Jed asks you to DO something, you MUST USE THEM:

1. **NEVER say "I'm on it" without calling a tool.** If Jed asks you to research, scrape, find, build, generate, or do ANYTHING — you MUST call the appropriate tool function (queue_task, execute_pc_command, web_search, scrape_url, etc.) in the SAME response.

2. **For quick lookups (products, links, facts):** Call `web_search` immediately. Do NOT queue a task. Give Jed the answer NOW.

3. **For longer work (full research reports, scraping multiple pages, building something):** Call `queue_task` to add it to your work queue. Tell Jed it's queued and give him the task ID.

4. **For PC-specific actions (open apps, run desktop scripts, access local files):** Call `execute_pc_command` with the PowerShell command.

5. **For reading web pages:** Call `scrape_url` with the URL.

6. **NEVER claim you are "working on" something unless you have ACTUALLY called a tool to start it.** If you haven't called a tool, you haven't started anything.

7. **If you don't have a tool for what Jed is asking:** Tell him honestly. Say "I don't have a tool for that yet" — NEVER pretend you're doing it.

8. **Before reporting progress on ANY task:** Call `get_task_status` first. Report ONLY what the queue actually shows.

Available tools:
- `web_search(query)` — instant web search via Perplexity Sonar
- `queue_task(title, type, description)` — queue background work
- `execute_pc_command(command)` — run PowerShell on Jed's PC
- `scrape_url(url)` — read a web page with Playwright
- `get_task_status()` — check real queue state
"""

# Check if already patched
if 'ACTION EXECUTION RULES' in config:
    print('[SKIP] Action rules already present in config.js')
else:
    # Find the ZERO TOLERANCE section and insert before it
    zero_tol = '## ZERO TOLERANCE: NO FABRICATED PROGRESS'
    if zero_tol in config:
        config = config.replace(zero_tol, ACTION_RULES + '\n' + zero_tol)
        print('[OK] Inserted action rules before ZERO TOLERANCE section')
    else:
        # Fallback: find the end of the system prompt and insert before closing backtick
        # Look for the last substantial section
        architect_section = '## THE ARCHITECT'
        if architect_section in config:
            config = config.replace(architect_section, ACTION_RULES + '\n' + architect_section)
            print('[OK] Inserted action rules before ARCHITECT section')
        else:
            print('[FAIL] Could not find insertion point in config.js')
            sys.exit(1)

with open(CONFIG_PATH, 'w') as f:
    f.write(config)
print('[OK] config.js written')

# Validate
result = subprocess.run(['node', '--check', CONFIG_PATH], capture_output=True, text=True)
if result.returncode == 0:
    print('[OK] config.js syntax check passed')
else:
    print(f'[FAIL] Syntax error: {result.stderr}')
    sys.exit(1)

print('[DONE] Action rules added to system prompt')
