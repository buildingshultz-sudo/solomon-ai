'use strict';
// fix_orphan.js — Remove the orphaned old sendLongMessage body fragment
// After the previous cleanup, there's still orphaned code between the new function's
// closing `}` and the `// ── SYSTEM PROMPT` comment.

const fs = require('fs');
const filePath = '/root/solomon-v4/bot.js';
let code = fs.readFileSync(filePath, 'utf8');

// The orphaned fragment starts right after the new function's closing `}`
// and ends before `// ── SYSTEM PROMPT`
// It looks like:
//   }
// \n  // Split at paragraph boundaries (double newline)\n  const paragraphs = ...
// ... (old body without function wrapper) ...
// }
// // ── SYSTEM PROMPT

const ORPHAN_START = '\n  // Split at paragraph boundaries (double newline)\n  const paragraphs = text.split(/\\n\\n/);';
const ORPHAN_END = '\n// ── SYSTEM PROMPT ────────────────────────────────────────────────────────';

const startIdx = code.indexOf(ORPHAN_START);
const endIdx = code.indexOf(ORPHAN_END);

if (startIdx === -1) {
  console.log('❌ Could not find orphan start');
  process.exit(1);
}
if (endIdx === -1) {
  console.log('❌ Could not find SYSTEM PROMPT anchor');
  process.exit(1);
}

console.log(`Orphan fragment: chars ${startIdx} to ${endIdx} (${endIdx - startIdx} chars)`);

// Remove everything between startIdx and endIdx (exclusive of SYSTEM PROMPT comment)
code = code.slice(0, startIdx) + '\n' + code.slice(endIdx);
console.log('✅ Removed orphaned old function body');

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
  ["Only one sendLongMessage", (patched.match(/async function sendLongMessage/g) || []).length === 1],
  ["Old subChunk bug gone", !patched.includes('if (subChunk) current = subChunk;')],
  ["No duplicate MAX_LEN", (patched.match(/const MAX_LEN = 4000;/g) || []).length === 1],
  ["New hard-split logic present", patched.includes('hard-split it by character count') || patched.includes('Hard-split it by character count')],
  ["Dedup set present", patched.includes('_processedMsgIds')],
  ["Dedup check in handler", patched.includes('_processedMsgIds.has(msg.message_id)')],
  ["Photo handler intact", patched.includes('PHOTO HANDLER (Phase 8B)')],
  ["Document handler intact", patched.includes("bot.on('document'")],
  ["Anthropic vision intact", patched.includes('anthropic.messages.create')],
  ["SYSTEM PROMPT present", patched.includes('// ── SYSTEM PROMPT')],
];
let allPass = true;
for (const [label, ok] of checks) {
  console.log(`  ${ok ? '✅' : '❌'} ${label}`);
  if (!ok) allPass = false;
}
if (allPass) console.log('\nALL CHECKS PASSED');
else { console.log('\nSOME CHECKS FAILED'); process.exit(1); }
