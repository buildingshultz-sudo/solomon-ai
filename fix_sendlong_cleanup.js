'use strict';
// fix_sendlong_cleanup.js — Remove the duplicate old sendLongMessage body
// The brace-counting replacement left the new function body but appended the old body.
// The result is: new function closes with `}) {` then old body follows.
// We need to remove everything from `}) {` to the second `}` that closes the old body.

const fs = require('fs');
const filePath = '/root/solomon-v4/bot.js';
let code = fs.readFileSync(filePath, 'utf8');

// The new sendLongMessage ends with:
//   }
// }) {
//   const MAX_LEN = 4000;
//   ... (old body) ...
//   }
// }
// The old body starts with `}) {\n  const MAX_LEN = 4000;` and ends with the closing `\n}`
// that closes the old function body.

// Strategy: find the exact duplicate fragment and remove it
const DUPE_START = '}) {\n  const MAX_LEN = 4000;\n  if (text.length <= MAX_LEN) {\n    try {\n      await bot.sendMessage(chatId, text, opts);';

const dupeIdx = code.indexOf(DUPE_START);
if (dupeIdx === -1) {
  console.log('❌ Could not find duplicate body start');
  // Check what's around line 130
  const lines = code.split('\n');
  for (let i = 128; i < 145; i++) {
    console.log(`${i+1}: ${JSON.stringify(lines[i])}`);
  }
  process.exit(1);
}

console.log(`Found duplicate body at char ${dupeIdx}`);

// Find the end of the duplicate body — it ends with the closing `\n}` of the old function
// Count braces from dupeIdx to find the matching close
let depth = 0;
let inBody = false;
let dupeEnd = -1;
for (let i = dupeIdx; i < code.length; i++) {
  if (code[i] === '{') { depth++; inBody = true; }
  else if (code[i] === '}') {
    depth--;
    if (inBody && depth === 0) {
      dupeEnd = i + 1;
      break;
    }
  }
}

if (dupeEnd === -1) {
  console.log('❌ Could not find end of duplicate body');
  process.exit(1);
}

console.log(`Duplicate body spans chars ${dupeIdx} to ${dupeEnd} (${dupeEnd - dupeIdx} chars)`);

// Remove the duplicate body
code = code.slice(0, dupeIdx) + '\n}' + code.slice(dupeEnd);
console.log('✅ Removed duplicate sendLongMessage body');

// ── Write ─────────────────────────────────────────────────────────────────
fs.writeFileSync(filePath, code);
console.log('bot.js written.');

// ── Syntax check ─────────────────────────────────────────────────────────
const { execSync } = require('child_process');
try {
  execSync('node -c /root/solomon-v4/bot.js', { stdio: 'pipe' });
  console.log('✅ Syntax check passed');
} catch (e) {
  console.log('❌ Syntax error:', e.stderr.toString().slice(0, 200));
  process.exit(1);
}

// ── Verify ────────────────────────────────────────────────────────────────
const patched = fs.readFileSync(filePath, 'utf8');
const checks = [
  ["Only one sendLongMessage", (patched.match(/async function sendLongMessage/g) || []).length === 1],
  ["Old subChunk bug gone", !patched.includes('if (subChunk) current = subChunk;')],
  ["No duplicate MAX_LEN", (patched.match(/const MAX_LEN = 4000;/g) || []).length === 1],
  ["New hard-split logic present", patched.includes('hard-split it by character count') || patched.includes('Hard-split it by character count')],
  ["Dedup set present", patched.includes('_processedMsgIds')],
  ["Dedup check in handler", patched.includes('_processedMsgIds.has(msg.message_id)')],
  ["Photo handler intact", patched.includes('PHOTO HANDLER (Phase 8B)')],
  ["Document handler intact", patched.includes("bot.on('document'")],
  ["Anthropic vision intact", patched.includes('anthropic.messages.create')],
];
let allPass = true;
for (const [label, ok] of checks) {
  console.log(`  ${ok ? '✅' : '❌'} ${label}`);
  if (!ok) allPass = false;
}
if (allPass) console.log('\nALL CHECKS PASSED');
else { console.log('\nSOME CHECKS FAILED'); process.exit(1); }
