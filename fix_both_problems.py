#!/usr/bin/env python3
import subprocess, json, sys

config_raw = subprocess.check_output(
    ['node', '-e', 'const c=require("/root/solomon-bot/config.js"); console.log(JSON.stringify({token:c.TELEGRAM_TOKEN,chat:c.OWNER_CHAT_ID}))'],
    cwd='/root/solomon-bot'
).decode().strip()
c = json.loads(config_raw)
token = c['token']
chat = str(c['chat'])

# ── 1. Queue PC command to delete the broken scheduled task ──────────────────
r = subprocess.run([
    'curl', '-s', '-X', 'POST',
    'http://127.0.0.1:3001/command/queue',
    '-H', 'Content-Type: application/json',
    '-d', json.dumps({'command': 'schtasks /delete /tn "SolomonAgent" /f', 'type': 'cmd'})
], capture_output=True, text=True)
print('[QUEUE schtasks delete]', r.stdout.strip()[:100])

# ── 2. Send the startup bat file to Jed ──────────────────────────────────────
caption = "Forget the last files. Save this to your Startup folder (Win+R, type shell:startup, hit Enter, paste it there). Then double-click it once now to start the agent."

r2 = subprocess.run([
    'curl', '-s', '-X', 'POST',
    f'https://api.telegram.org/bot{token}/sendDocument',
    '-F', f'chat_id={chat}',
    '-F', 'document=@/root/solomon-bot/START-Solomon-Agent-Interactive.bat',
    '-F', f'caption={caption}'
], capture_output=True, text=True)
resp2 = json.loads(r2.stdout)
print('[SEND BAT]', 'OK' if resp2.get('ok') else r2.stdout[:200])

# ── 3. Patch system prompt with screenshot handling rule ─────────────────────
CONFIG_PATH = '/root/solomon-bot/config.js'
with open(CONFIG_PATH, 'r') as f:
    content = f.read()

SCREENSHOT_RULE = """
### RULE 4: PHOTO AND SCREENSHOT HANDLING
When Jed sends a photo or screenshot, treat it as context for the current conversation.
- Do NOT describe what the image is (never say "this is a screenshot of..." or "this appears to be...").
- Respond to what the image MEANS in context: acknowledge the result, identify any errors, suggest next steps.
- Keep it to 1-2 sentences.
- Bad: "Not a thumbnail — this is a desktop screenshot showing..."
- Good: "Looks like the task ran successfully." or "That error means the path wasn't found — try X."
"""

if 'RULE 4: PHOTO AND SCREENSHOT' in content:
    print('[SKIP] Screenshot rule already present')
else:
    anchor = '### RULE 3: TELEGRAM MESSAGE STYLE'
    if anchor in content:
        # Find end of Rule 3 and insert after it
        idx = content.find(anchor)
        next_heading = content.find('\n###', idx + len(anchor))
        next_section = content.find('\n##', idx + len(anchor))
        end_idx = min(
            next_heading if next_heading > 0 else 999999,
            next_section if next_section > 0 else 999999
        )
        if end_idx < 999999:
            content = content[:end_idx] + '\n' + SCREENSHOT_RULE + content[end_idx:]
            print('[OK] Injected Rule 4 after Rule 3')
        else:
            content = content.replace(anchor, anchor + '\n' + SCREENSHOT_RULE, 1)
            print('[OK] Injected Rule 4 inline after Rule 3 anchor')
    else:
        # Fallback: insert before PC AGENT INDEPENDENCE RULE
        anchor2 = '## PC AGENT INDEPENDENCE RULE'
        if anchor2 in content:
            content = content.replace(anchor2, SCREENSHOT_RULE + '\n' + anchor2, 1)
            print('[OK] Injected Rule 4 before PC Agent rule (fallback)')
        else:
            print('[WARN] Could not find anchor for Rule 4')

with open(CONFIG_PATH, 'w') as f:
    f.write(content)

result = subprocess.run(['node', '--check', CONFIG_PATH], capture_output=True, text=True)
if result.returncode != 0:
    print('[FAIL] config.js syntax error:', result.stderr[:300])
    sys.exit(1)
print('[OK] config.js syntax valid')

# ── 4. Update knowledge base ──────────────────────────────────────────────────
KB_PATH = '/root/solomon-bot/sol-knowledge.json'
with open(KB_PATH, 'r') as f:
    kb = json.load(f)

kb['jed_communication_preferences']['photo_handling'] = (
    "When Jed sends a photo/screenshot, respond to what it MEANS — not what it IS. "
    "Never describe the image. Acknowledge the result, flag errors, suggest next steps. 1-2 sentences."
)
kb['jed_communication_preferences']['never_do'].append(
    "Describe screenshots or photos (e.g. 'this is a screenshot of...' or 'Not a thumbnail...')"
)

with open(KB_PATH, 'w') as f:
    json.dump(kb, f, indent=2)
print('[OK] KB updated with photo handling rule')

print('[DONE]')
