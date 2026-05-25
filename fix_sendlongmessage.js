'use strict';
// fix_sendlongmessage.js — Run directly on VPS
// Fixes the duplicate message bug by replacing sendLongMessage with a clean implementation
// Root cause: the photo handler calls askSolomon which can return multi-paragraph responses;
// the old sendLongMessage had a logic bug where paragraphs could be duplicated when
// a single paragraph was > MAX_LEN (the subChunk became `current` but was also pushed).
// The real duplicate issue is that the photo handler was being triggered multiple times
// due to the early-return check `if (!text && !msg.photo) return;` — when a photo message
// arrives, `text` is undefined, so the check passes, but the message handler may fire
// multiple times if Telegram retries. We add a deduplication guard.
// Additionally, we replace sendLongMessage with a simpler, bulletproof implementation.

const fs = require('fs');
const filePath = '/root/solomon-v4/bot.js';
let code = fs.readFileSync(filePath, 'utf8');

// ── FIX 1: Replace sendLongMessage with clean implementation ──────────────
const OLD_SEND_LONG = `// Splits long messages at paragraph boundaries with 500ms delay between chunks
async function sendLongMessage(chatId, text, opts = {}) {
  const MAX_LEN = 4000;
  if (text.length <= MAX_LEN) {
    try {
      await bot.sendMessage(chatId, text, opts);
    } catch (mdErr) {
      // Markdown parse error fallback — send without formatting
      if (mdErr.message && mdErr.message.includes("can't parse")) {
        await bot.sendMessage(chatId, text, { ...opts, parse_mode: undefined });
      } else {
        throw mdErr;
      }
    }
    return;
  }
  // Split at paragraph boundaries (double newline)
  const paragraphs = text.split(/\\n\\n/);
  const chunks = [];
  let current = '';
  for (const para of paragraphs) {
    if (current.length + para.length + 2 > MAX_LEN) {
      if (current) chunks.push(current.trim());
      // If a single paragraph is too long, split it at single newlines
      if (para.length > MAX_LEN) {
        const lines = para.split(/\\n/);
        let subChunk = '';
        for (const line of lines) {
          if (subChunk.length + line.length + 1 > MAX_LEN) {
            if (subChunk) chunks.push(subChunk.trim());
            subChunk = line;
          } else {
            subChunk += (subChunk ? '\\n' : '') + line;
          }
        }
        if (subChunk) current = subChunk;
      } else {
        current = para;
      }
    } else {
      current += (current ? '\\n\\n' : '') + para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  for (let i = 0; i < chunks.length; i++) {
    try {
      await bot.sendMessage(chatId, chunks[i], opts);
    } catch (mdErr) {
      if (mdErr.message && mdErr.message.includes("can't parse")) {
        await bot.sendMessage(chatId, chunks[i], { ...opts, parse_mode: undefined });
      } else {
        throw mdErr;
      }
    }
    if (i < chunks.length - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
}`;

const NEW_SEND_LONG = `// Sends a message, splitting only if genuinely over 4000 chars.
// Splits at paragraph boundaries (double newline). Never duplicates content.
async function sendLongMessage(chatId, text, opts = {}) {
  const MAX_LEN = 4000;

  // Helper: send one chunk with Markdown fallback
  async function sendChunk(chunk) {
    try {
      await bot.sendMessage(chatId, chunk, opts);
    } catch (err) {
      if (err.message && err.message.includes("can't parse")) {
        await bot.sendMessage(chatId, chunk, { ...opts, parse_mode: undefined });
      } else {
        throw err;
      }
    }
  }

  // Short message — send as-is, no splitting
  if (text.length <= MAX_LEN) {
    await sendChunk(text);
    return;
  }

  // Long message — split into non-overlapping chunks at paragraph boundaries
  const chunks = [];
  const paragraphs = text.split(/\\n\\n/);
  let current = '';

  for (const para of paragraphs) {
    const separator = current ? '\\n\\n' : '';
    if (current.length + separator.length + para.length > MAX_LEN) {
      // Flush current chunk
      if (current) chunks.push(current);
      // If a single paragraph exceeds MAX_LEN, hard-split it by character count
      if (para.length > MAX_LEN) {
        let remaining = para;
        while (remaining.length > MAX_LEN) {
          // Try to split at last newline within MAX_LEN
          const slice = remaining.slice(0, MAX_LEN);
          const lastNL = slice.lastIndexOf('\\n');
          const cutAt = lastNL > MAX_LEN * 0.5 ? lastNL : MAX_LEN;
          chunks.push(remaining.slice(0, cutAt).trim());
          remaining = remaining.slice(cutAt).trim();
        }
        current = remaining;
      } else {
        current = para;
      }
    } else {
      current = current + separator + para;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  // Send each unique chunk in sequence with a 500ms gap
  for (let i = 0; i < chunks.length; i++) {
    if (chunks[i]) await sendChunk(chunks[i]);
    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 500));
  }
}`;

if (code.includes(OLD_SEND_LONG)) {
  code = code.replace(OLD_SEND_LONG, NEW_SEND_LONG);
  console.log('✅ Replaced sendLongMessage with clean implementation');
} else {
  console.log('❌ Could not find OLD sendLongMessage — checking for partial match...');
  if (code.includes('async function sendLongMessage(chatId, text, opts = {})')) {
    console.log('  Found function signature but body differs. Attempting line-based replacement...');
    // Find function start and end
    const fnStart = code.indexOf('// Splits long messages at paragraph boundaries with 500ms delay between chunks\nasync function sendLongMessage');
    if (fnStart === -1) {
      console.log('  ❌ Cannot find function start comment');
      process.exit(1);
    }
    // Find the closing brace of the function — count braces
    let depth = 0;
    let inFn = false;
    let fnEnd = -1;
    for (let i = fnStart; i < code.length; i++) {
      if (code[i] === '{') { depth++; inFn = true; }
      else if (code[i] === '}') {
        depth--;
        if (inFn && depth === 0) { fnEnd = i + 1; break; }
      }
    }
    if (fnEnd === -1) { console.log('  ❌ Cannot find function end'); process.exit(1); }
    code = code.slice(0, fnStart) + NEW_SEND_LONG + code.slice(fnEnd);
    console.log('✅ Replaced sendLongMessage via brace-counting');
  } else {
    process.exit(1);
  }
}

// ── FIX 2: Add message deduplication guard for photo handler ──────────────
// The photo handler fires for every Telegram update delivery. Add a processed-IDs set
// to prevent processing the same message_id twice (Telegram retries on timeout).
const DEDUP_ANCHOR = "const TELEGRAM_IMG_DIR = '/tmp/telegram_images';";
const DEDUP_CODE = `const TELEGRAM_IMG_DIR = '/tmp/telegram_images';
// Deduplication set — prevents processing the same Telegram message twice (retry protection)
const _processedMsgIds = new Set();`;

if (code.includes(DEDUP_ANCHOR) && !code.includes('_processedMsgIds')) {
  code = code.replace(DEDUP_ANCHOR, DEDUP_CODE);
  console.log('✅ Added message deduplication set');
} else if (code.includes('_processedMsgIds')) {
  console.log('⏭  Deduplication set already present');
} else {
  console.log('⚠️  Could not add deduplication set — TELEGRAM_IMG_DIR anchor not found');
}

// ── FIX 3: Apply dedup check at the start of the main message handler ─────
// Find the bot.on('message') handler and add dedup check after the owner check
const OLD_OWNER_CHECK = "  if (msg.chat.id !== OWNER_ID) return;\n  const text = (msg.text || '').trim();";
const NEW_OWNER_CHECK = `  if (msg.chat.id !== OWNER_ID) return;
  // Deduplication: ignore retried/duplicate message deliveries
  if (_processedMsgIds.has(msg.message_id)) return;
  _processedMsgIds.add(msg.message_id);
  if (_processedMsgIds.size > 500) {
    // Keep set small — remove oldest entries
    const oldest = [..._processedMsgIds].slice(0, 250);
    oldest.forEach(id => _processedMsgIds.delete(id));
  }
  const text = (msg.text || '').trim();`;

if (code.includes(OLD_OWNER_CHECK)) {
  code = code.replace(OLD_OWNER_CHECK, NEW_OWNER_CHECK);
  console.log('✅ Added dedup check to main message handler');
} else if (code.includes('_processedMsgIds.has(msg.message_id)')) {
  console.log('⏭  Dedup check already in message handler');
} else {
  console.log('⚠️  Could not add dedup check — owner check anchor not found');
}

// ── Write ─────────────────────────────────────────────────────────────────
fs.writeFileSync(filePath, code);
console.log('bot.js written.');

// ── Verify ────────────────────────────────────────────────────────────────
const patched = fs.readFileSync(filePath, 'utf8');
const checks = [
  ["sendLongMessage present", patched.includes('async function sendLongMessage')],
  ["No duplicate paragraph bug (old subChunk logic gone)", !patched.includes('if (subChunk) current = subChunk;')],
  ["New clean split logic present", patched.includes('Hard-split it by character count') || patched.includes('hard-split it by character count')],
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
