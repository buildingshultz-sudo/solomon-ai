'use strict';
// fix_dedup.js — Add deduplication check to the message handler
// Run on VPS after fix_sendlongmessage.js

const fs = require('fs');
const filePath = '/root/solomon-v4/bot.js';
let code = fs.readFileSync(filePath, 'utf8');

// ── FIX: Add dedup check after the owner check ───────────────────────────
// The exact structure is:
//   if (msg.chat.id !== OWNER_ID) {
//     bot.sendMessage(msg.chat.id, 'This is a private assistant. Unauthorized access logged.');
//     return;
//   }
//   const text = msg.text || msg.caption || '';

const OLD_OWNER_BLOCK = `  if (msg.chat.id !== OWNER_ID) {
    bot.sendMessage(msg.chat.id, 'This is a private assistant. Unauthorized access logged.');
    return;
  }

  const text = msg.text || msg.caption || '';`;

const NEW_OWNER_BLOCK = `  if (msg.chat.id !== OWNER_ID) {
    bot.sendMessage(msg.chat.id, 'This is a private assistant. Unauthorized access logged.');
    return;
  }
  // Deduplication: ignore retried/duplicate Telegram message deliveries
  if (_processedMsgIds.has(msg.message_id)) return;
  _processedMsgIds.add(msg.message_id);
  if (_processedMsgIds.size > 500) {
    const oldest = [..._processedMsgIds].slice(0, 250);
    oldest.forEach(id => _processedMsgIds.delete(id));
  }
  const text = msg.text || msg.caption || '';`;

if (code.includes(OLD_OWNER_BLOCK)) {
  code = code.replace(OLD_OWNER_BLOCK, NEW_OWNER_BLOCK);
  console.log('✅ Added dedup check to main message handler');
} else if (code.includes('_processedMsgIds.has(msg.message_id)')) {
  console.log('⏭  Dedup check already present');
} else {
  console.log('❌ Could not find owner check anchor');
  // Show what we have around that area
  const idx = code.indexOf("'This is a private assistant.");
  if (idx > -1) {
    console.log('Context around private assistant message:');
    console.log(JSON.stringify(code.slice(idx - 100, idx + 200)));
  }
  process.exit(1);
}

// ── Write ─────────────────────────────────────────────────────────────────
fs.writeFileSync(filePath, code);
console.log('bot.js written.');

// ── Verify ────────────────────────────────────────────────────────────────
const patched = fs.readFileSync(filePath, 'utf8');
const checks = [
  ["sendLongMessage present", patched.includes('async function sendLongMessage')],
  ["Old subChunk bug gone", !patched.includes('if (subChunk) current = subChunk;')],
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
