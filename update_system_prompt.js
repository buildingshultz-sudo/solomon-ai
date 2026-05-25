'use strict';
// update_system_prompt.js — Add OBS, GitHub Backup, and Version Tagging protocols to bot.js
// Run on VPS: node update_system_prompt.js

const fs = require('fs');
const filePath = '/root/solomon-v4/bot.js';
let code = fs.readFileSync(filePath, 'utf8');

// ── NEW PROTOCOLS ────────────────────────────────────────────────────────
const NEW_PROTOCOLS = `
## OBS Screen Recording Protocol
- BEFORE starting any coding/building session, start OBS recording via: pc_execute("Start-Process 'C:\\\\Program Files\\\\obs-studio\\\\bin\\\\64bit\\\\obs64.exe' -ArgumentList '--startrecording','--minimize-to-tray'")
- If OBS is already running, use: pc_execute("& 'C:\\\\Program Files\\\\obs-studio\\\\bin\\\\64bit\\\\obs64.exe' --startrecording") 
- AFTER completing a coding session (or hitting a natural stopping point), stop recording via: pc_execute("Stop-Process -Name obs64 -ErrorAction SilentlyContinue")
- This captures timelapse footage of you building apps for Jed's YouTube content
- Always mention in your completion report that recording was captured
- If OBS fails to start, note it but don't let it block the actual work

## GitHub Backup Protocol  
- EVERY completed feature or working state MUST be committed AND pushed to GitHub
- Use git_commit after every working milestone (not just at the end)
- Use git_push after every commit — local-only commits are NOT backups
- Commit messages should be descriptive: "Add timeline scrubbing to IronEdit" not "update"
- If push fails (auth issue), log it as a feature request for Nathan and continue working

## Version Tagging Protocol (Failsafe)
- BEFORE making any code changes to a project, create a git tag: git tag v{version}-pre-{feature}
- This is your rollback point. If changes break anything: git checkout v{version}-pre-{feature} -- . 
- AFTER changes are confirmed working (tests pass, app runs), create a new version tag: git tag v{next_version}
- Version numbers increment: v1.0.0, v1.0.1, v1.0.2, etc.
- For Solomon's own code (if Nathan applies changes), the protocol is: v4.8.x
- For IronEdit: start at v0.1.0 and increment
- For any other app: start at v0.1.0 and increment
- NEVER skip the pre-change tag. This is non-negotiable. It's the safety net that prevents rewrites.
- If you realize you forgot to tag before starting, STOP, stash changes, tag, then re-apply.

VERIFICATION RULE:`;

// Find the anchor point — right before VERIFICATION RULE:
const ANCHOR = 'VERIFICATION RULE:';

if (code.includes(ANCHOR)) {
  code = code.replace(ANCHOR, NEW_PROTOCOLS);
  console.log('✅ Added OBS, GitHub Backup, and Version Tagging protocols to system prompt');
} else {
  console.log('❌ Could not find system prompt anchor');
  process.exit(1);
}

// ── Write ─────────────────────────────────────────────────────────────────
fs.writeFileSync(filePath, code);
console.log('bot.js written.');

// ── Syntax check ─────────────────────────────────────────────────────────
const { execSync } = require('child_process');
try {
  execSync('node -c /root/solomon-v4/bot.js', { stdio: 'pipe' });
  console.log('✅ Syntax check passed');
} catch (e) {
  console.log('❌ Syntax error:', e.stderr.toString().slice(0, 300));
  process.exit(1);
}

// ── Verify ────────────────────────────────────────────────────────────────
const patched = fs.readFileSync(filePath, 'utf8');
const checks = [
  ["OBS Protocol present", patched.includes('## OBS Screen Recording Protocol')],
  ["GitHub Backup Protocol present", patched.includes('## GitHub Backup Protocol')],
  ["Version Tagging Protocol present", patched.includes('## Version Tagging Protocol (Failsafe)')],
  ["VERIFICATION RULE intact", patched.includes('VERIFICATION RULE:')],
  ["Closing backtick intact", patched.includes('manual testing`;')],
];
let allPass = true;
for (const [label, ok] of checks) {
  console.log(`  ${ok ? '✅' : '❌'} ${label}`);
  if (!ok) allPass = false;
}
if (allPass) console.log('\nALL CHECKS PASSED');
else { console.log('\nSOME CHECKS FAILED'); process.exit(1); }
