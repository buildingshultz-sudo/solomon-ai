'use strict';
// response-formatter.js — T2: any outbound reply > LONG_RESPONSE_THRESHOLD chars
// gets written to /tmp/solomon-pdfs/<ts>-<slug>.md (VPS), optionally scp'd to
// D:\Solomon\reports\ via pc-relay, and delivered to Telegram as a document
// attachment instead of inline text.
//
// Callers (bot.js):
//   const fmt = require('./response-formatter');
//   const r = await fmt.formatLongResponse(text, { context_label: 'askSolomon' });
//   if (r.long) {
//     await bot.sendDocument(chatId, r.file_path, { caption: r.summary_line });
//   } else {
//     await bot.sendMessage(chatId, r.text);
//   }
//
// Inline-only callers (briefs, /stats, single-line replies) pass `{format: 'inline'}`
// in the opts, which short-circuits the wrapper and returns {long: false, text}.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const axios = require('axios');

const OUT_DIR = process.env.LONG_RESPONSE_DIR || '/tmp/solomon-pdfs';
const PC_DEST_DIR = process.env.LONG_RESPONSE_PC_DIR || 'D:\\Solomon\\reports';
const THRESHOLD = parseInt(process.env.LONG_RESPONSE_THRESHOLD || '800', 10);

function slugify(s, max = 50) {
  return String(s || 'response')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .toLowerCase() || 'response';
}

function fileTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function pushToPcViaRelay(localPath, filename) {
  const relayUrl = process.env.PC_RELAY_URL;
  const relaySecret = process.env.PC_RELAY_SECRET;
  if (!relayUrl || !relaySecret) return { ok: false, reason: 'PC_RELAY_URL or PC_RELAY_SECRET not set' };
  // pc-relay does NOT currently have a /file/write route — it only serves
  // reads. Use a powershell-bridge instead: instruct the relay to scp-pull
  // (or use the existing /execute route to write the file).
  // For now we use /execute to: invoke node + base64-decode the contents.
  // Less surface area: surface this as "skipped, PC push uses scp from PC side".
  return { ok: false, reason: 'pc-relay has no /file/write route — PC copy needs to be pulled from VPS' };
}

/**
 * formatLongResponse(text, opts?) — see module header.
 * @param {string} text  — the response body to potentially wrap
 * @param {object} [opts]
 * @param {string} [opts.context_label] — slug-friendly label (e.g. 'askSolomon', 'dispatch_result'); used in filename
 * @param {string} [opts.format]        — 'inline' to force inline regardless of length
 * @param {number} [opts.threshold]     — override LONG_RESPONSE_THRESHOLD for one call
 * @returns {Promise<{long: boolean, text?: string, file_path?: string, summary_line?: string}>}
 */
async function formatLongResponse(text, opts = {}) {
  const t = String(text == null ? '' : text);
  const threshold = (typeof opts.threshold === 'number') ? opts.threshold : THRESHOLD;
  if (opts.format === 'inline' || t.length <= threshold) {
    return { long: false, text: t };
  }
  try {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    const ts = fileTimestamp();
    const label = slugify(opts.context_label || 'solomon-response');
    const filename = `${ts}-${label}.md`;
    const file_path = path.join(OUT_DIR, filename);
    // Prepend a small header so the file is self-describing
    const headed = `<!-- Solomon long-response · ${new Date().toISOString()} · context: ${opts.context_label || 'n/a'} · ${t.length} chars -->\n\n${t}\n`;
    fs.writeFileSync(file_path, headed, 'utf8');
    // Best-effort push to PC. If relay isn't wired (no /file/write), file
    // stays on VPS and Telegram delivers it from there.
    const pcPush = await pushToPcViaRelay(file_path, filename);
    const charsLabel = t.length.toLocaleString();
    const summary_line = `📄 Full response saved as \`${filename}\` (${charsLabel} chars). Telegram attachment.`;
    return { long: true, file_path, summary_line, pc_push: pcPush };
  } catch (e) {
    // On any wrapper failure, gracefully degrade to inline (truncated) so the
    // user still gets a reply.
    return { long: false, text: t.slice(0, threshold) + `\n\n[note: long-response wrap failed: ${e.message.slice(0, 120)}]` };
  }
}

module.exports = { formatLongResponse, _THRESHOLD: THRESHOLD, _OUT_DIR: OUT_DIR };
