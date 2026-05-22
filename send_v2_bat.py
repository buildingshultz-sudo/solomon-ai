#!/usr/bin/env python3
import subprocess, json, sys, shutil

shutil.copy('/tmp/INSTALL-Solomon-v2.bat', '/root/solomon-bot/INSTALL-Solomon-v2.bat')

config_raw = subprocess.check_output(
    ['node', '-e', 'const c=require("/root/solomon-bot/config.js"); console.log(JSON.stringify({token:c.TELEGRAM_TOKEN,chat:c.OWNER_CHAT_ID}))'],
    cwd='/root/solomon-bot'
).decode().strip()
c = json.loads(config_raw)
token = c['token']
chat = str(c['chat'])

# The agent isn't picking up commands - it's still in Session 0
# Send the corrected bat file
caption = "The first file had a quoting bug. Run this one instead — it fixes the path issue."

r = subprocess.run([
    'curl', '-s', '-X', 'POST',
    f'https://api.telegram.org/bot{token}/sendDocument',
    '-F', f'chat_id={chat}',
    '-F', 'document=@/root/solomon-bot/INSTALL-Solomon-v2.bat',
    '-F', f'caption={caption}'
], capture_output=True, text=True)

resp = json.loads(r.stdout)
if resp.get('ok'):
    print('[OK] v2 bat file sent to Jed')
else:
    print('[FAIL]', r.stdout[:300])
    sys.exit(1)
