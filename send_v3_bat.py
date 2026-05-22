#!/usr/bin/env python3
import subprocess, json, sys

config_raw = subprocess.check_output(
    ['node', '-e', 'const c=require("/root/solomon-bot/config.js"); console.log(JSON.stringify({token:c.TELEGRAM_TOKEN,chat:c.OWNER_CHAT_ID}))'],
    cwd='/root/solomon-bot'
).decode().strip()
c = json.loads(config_raw)
token = c['token']
chat = str(c['chat'])

caption = "Third time's the charm. This one uses a proper launcher that sets the working directory first."

r = subprocess.run([
    'curl', '-s', '-X', 'POST',
    f'https://api.telegram.org/bot{token}/sendDocument',
    '-F', f'chat_id={chat}',
    '-F', 'document=@/root/solomon-bot/INSTALL-Solomon-v3.bat',
    '-F', f'caption={caption}'
], capture_output=True, text=True)

resp = json.loads(r.stdout)
if resp.get('ok'):
    print('[OK] v3 bat file sent to Jed')
else:
    print('[FAIL]', r.stdout[:300])
    sys.exit(1)
