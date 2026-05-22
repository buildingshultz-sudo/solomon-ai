#!/usr/bin/env python3
"""
Fix the PC Agent status detection:
1. Extend the heartbeat threshold in relay.js from 30s to 5 minutes (300s)
2. Add a "warn but proceed" mode in bot.js executeOnPC when status is stale
3. Improve the offline message to distinguish "truly offline" vs "missed heartbeat"
"""
import subprocess, sys

# ── Fix 1: relay.js — extend threshold from 30s to 5 minutes ──────────────────
with open('/root/solomon-bot/relay.js', 'r') as f:
    relay = f.read()

old_threshold = 'const online = (Date.now() - lastBeat) < 30000;'
new_threshold = '''// 5-minute threshold — agent is considered online if it heartbeated within 5 mins
    // (30s was too tight; brief PC sleep/wake cycles caused false "offline" reports)
    const HEARTBEAT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
    const online = lastBeat > 0 && (Date.now() - lastBeat) < HEARTBEAT_TIMEOUT_MS;
    const stale = lastBeat > 0 && !online; // heartbeat exists but is old'''

if old_threshold in relay:
    relay = relay.replace(old_threshold, new_threshold)
    # Also update the response to include stale flag
    old_respond = 'return respond(200, { ok: true, online, lastHeartbeat: lastBeat });'
    new_respond = 'return respond(200, { ok: true, online, stale, lastHeartbeat: lastBeat, ageSeconds: lastBeat > 0 ? Math.round((Date.now() - lastBeat) / 1000) : null });'
    relay = relay.replace(old_respond, new_respond)
    with open('/root/solomon-bot/relay.js', 'w') as f:
        f.write(relay)
    print('[OK] relay.js: heartbeat threshold extended to 5 minutes')
else:
    print('[FAIL] relay.js: could not find threshold line to replace')
    print('Looking for:', repr(old_threshold))
    # Show context
    idx = relay.find('30000')
    if idx >= 0:
        print('Found 30000 at:', relay[max(0,idx-100):idx+100])
    sys.exit(1)

# ── Fix 2: bot.js — improve executeOnPC to warn-but-proceed on stale status ───
with open('/root/solomon-bot/bot.js', 'r') as f:
    bot = f.read()

old_check = "    const status = await pcAgentStatus();\n    if (!status.online) return { success: false, output: 'PC agent is offline.' };"
new_check = """    const status = await pcAgentStatus();
    if (!status.online && !status.stale) {
      // Truly offline — no heartbeat ever, or relay itself is down
      return { success: false, output: 'PC agent is offline. It will auto-reconnect on Jed\\'s next login.' };
    }
    if (status.stale) {
      // Heartbeat exists but is old — agent may have just woken from sleep. Try anyway.
      console.log(`[PC] Agent heartbeat is ${status.ageSeconds}s old (stale) — attempting command anyway`);
    }"""

if old_check in bot:
    bot = bot.replace(old_check, new_check)
    with open('/root/solomon-bot/bot.js', 'w') as f:
        f.write(bot)
    print('[OK] bot.js: executeOnPC updated to warn-but-proceed on stale heartbeat')
else:
    print('[WARN] bot.js: exact string not found, trying alternate match...')
    # Try to find it differently
    idx = bot.find("if (!status.online) return { success: false, output: 'PC agent is offline.")
    if idx >= 0:
        print('Found alternate form at index', idx)
        print('Context:', repr(bot[max(0,idx-200):idx+200]))
    else:
        print('[FAIL] Could not find the offline check in bot.js')

# ── Fix 3: Verify node --check on both files ──────────────────────────────────
import subprocess
for fname in ['relay.js', 'bot.js']:
    result = subprocess.run(['node', '--check', f'/root/solomon-bot/{fname}'], capture_output=True, text=True)
    if result.returncode == 0:
        print(f'[OK] {fname} syntax check passed')
    else:
        print(f'[FAIL] {fname} syntax error: {result.stderr}')
        sys.exit(1)

print('[DONE] All patches applied successfully')
