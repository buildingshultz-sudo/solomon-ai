'use strict';
// bot.js — Solomon V4 main entry point.
// ONE file. ONE model. NO self-patching. NO Ollama. NO local LLM.
// If it breaks, you can read the whole thing in 10 minutes.
require('dotenv').config();

const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const Anthropic = require('@anthropic-ai/sdk');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { messages, tasks, mem, budget, projectQueue, featureRequests, nathanInbox, lessons, jedTasks } = require('./memory');
const { TOOL_DEFINITIONS, executeTool, getSocialAuthStatus } = require('./tools');
const { execSync } = require('child_process');
const activityLogger = require("./activity-logger");
const parallelTaskManager = require('./parallel_task_manager');
const sharp = require('sharp');

// ── FILE READ CACHE (prevents read loops) ────────────────────
const fileReadCache = new Map();
const fileReadCount = new Map();
const FILE_READ_MAX_PER_TURN = 2;

function resetFileReadCache() {
  fileReadCache.clear();
  fileReadCount.clear();
}


// ══ IMAGE PROCESSING QUEUE (Rate Limit Fix) ═════════════════════════════════
// Processes photos one at a time with a delay to avoid 429 rate limit errors.
// Album/media-group photos are batched into a single Vision call + single reply.
const _imageQueue = [];
let _imageProcessing = false;
const IMAGE_QUEUE_DELAY_MS = 10000; // 10 seconds between vision API calls
const _reportedPhotoErrors = new Set(); // Dedup error messages per photo

// Album batching: Telegram delivers each photo in an album as a separate `msg`
// sharing a `media_group_id`. We buffer them briefly so one Vision call + one
// reply covers the whole album instead of N parallel calls hitting 429s.
const _mediaGroupBuffers = new Map(); // media_group_id -> { msgs, timer }
const MEDIA_GROUP_DEBOUNCE_MS = 1500;
const MAX_PHOTOS_PER_BATCH = 5; // Anthropic Vision: keep batches small for rate-limit safety

function enqueuePhoto(msg) {
  if (!msg.media_group_id) {
    _imageQueue.push({ msgs: [msg] });
    processImageQueue();
    return;
  }
  const gid = msg.media_group_id;
  let buf = _mediaGroupBuffers.get(gid);
  if (!buf) {
    buf = { msgs: [], timer: null };
    _mediaGroupBuffers.set(gid, buf);
  }
  buf.msgs.push(msg);
  if (buf.timer) clearTimeout(buf.timer);
  buf.timer = setTimeout(() => {
    _mediaGroupBuffers.delete(gid);
    const all = buf.msgs;
    for (let i = 0; i < all.length; i += MAX_PHOTOS_PER_BATCH) {
      _imageQueue.push({ msgs: all.slice(i, i + MAX_PHOTOS_PER_BATCH) });
    }
    log('INFO', 'PHOTO', 'Album flushed to queue', { media_group_id: gid, total: all.length, batches: Math.ceil(all.length / MAX_PHOTOS_PER_BATCH) });
    processImageQueue();
  }, MEDIA_GROUP_DEBOUNCE_MS);
}

async function processImageQueue() {
  if (_imageProcessing || _imageQueue.length === 0) return;
  _imageProcessing = true;

  while (_imageQueue.length > 0) {
    const job = _imageQueue.shift();
    try {
      await processPhotos(job.msgs);
    } catch (err) {
      const firstMsg = job.msgs[0];
      const errorKey = `${firstMsg.message_id}_${err.message}`;
      if (!_reportedPhotoErrors.has(errorKey)) {
        _reportedPhotoErrors.add(errorKey);
        log('ERROR', 'PHOTO', 'Photo handler error', { error: err.message, batch_size: job.msgs.length });
        bot.sendMessage(firstMsg.chat.id, `❌ Photo processing error: ${err.message.slice(0, 200)}`).catch(() => {});
        // Cleanup old error keys after 5 minutes
        setTimeout(() => _reportedPhotoErrors.delete(errorKey), 5 * 60 * 1000);
      }
    }
    // Wait between processing to respect rate limits
    if (_imageQueue.length > 0) {
      log('INFO', 'PHOTO', `Queue: ${_imageQueue.length} batch(es) remaining. Waiting ${IMAGE_QUEUE_DELAY_MS/1000}s before next...`);
      await new Promise(r => setTimeout(r, IMAGE_QUEUE_DELAY_MS));
    }
  }

  _imageProcessing = false;
}

// Download one Telegram photo and return { localPath, processedBuffer (JPEG) }.
async function downloadAndResize(photoMsg) {
  const photo = photoMsg.photo[photoMsg.photo.length - 1]; // highest-resolution
  const fileInfo = await bot.getFile(photo.file_id);
  const telegramFilePath = fileInfo.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${telegramFilePath}`;
  const imgResponse = await axios.get(fileUrl, { responseType: 'arraybuffer', timeout: 30000 });
  const rawBuffer = Buffer.from(imgResponse.data);
  const ext = telegramFilePath.split('.').pop() || 'jpg';
  const localPath = `${TELEGRAM_IMG_DIR}/${photo.file_id}.${ext}`;
  fs.writeFileSync(localPath, rawBuffer);

  let processedBuffer;
  try {
    const metadata = await sharp(rawBuffer).metadata();
    const maxDim = 1024;
    if (metadata.width > maxDim || metadata.height > maxDim) {
      processedBuffer = await sharp(rawBuffer)
        .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      log('INFO', 'PHOTO', 'Image resized', { file_id: photo.file_id, original: `${metadata.width}x${metadata.height}`, newBytes: processedBuffer.length });
    } else {
      processedBuffer = await sharp(rawBuffer).jpeg({ quality: 85 }).toBuffer();
      log('INFO', 'PHOTO', 'Image compressed (no resize needed)', { file_id: photo.file_id, newBytes: processedBuffer.length });
    }
  } catch (sharpErr) {
    log('WARN', 'PHOTO', 'Sharp processing failed, using original', { file_id: photo.file_id, error: sharpErr.message });
    processedBuffer = rawBuffer;
  }
  return { localPath, processedBuffer };
}

async function processPhotos(msgs) {
  const firstMsg = msgs[0];
  bot.sendChatAction(firstMsg.chat.id, 'typing').catch(() => {});
  const isAlbum = msgs.length > 1;
  // Telegram puts the album caption on exactly one photo in the group
  const caption = (msgs.find(m => m.caption)?.caption) || firstMsg.caption || '';
  log('INFO', 'PHOTO', isAlbum ? `Processing album of ${msgs.length}` : 'Processing single photo', { caption: caption.slice(0, 100) });

  // Download + resize all photos in the batch
  const downloads = [];
  for (const m of msgs) {
    downloads.push(await downloadAndResize(m));
  }

  // Build one Vision call with all images
  const imageBlocks = downloads.map(d => ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: d.processedBuffer.toString('base64') }
  }));
  const visionPrompt = isAlbum
    ? (caption
        ? `The user sent an album of ${msgs.length} images with the caption: "${caption}". Analyze the images together and respond helpfully to their request. Treat the images as a single set, not independently.`
        : `The user sent an album of ${msgs.length} images with no caption. Analyze them together and describe what you see. Treat them as a single set.`)
    : (caption
        ? `The user sent this image with the caption: "${caption}". Please analyze the image and respond helpfully to their request.`
        : 'Please analyze this image and describe what you see in detail. If it contains text, read it. If it shows code or a screenshot, explain what it shows. Be thorough and helpful.');

  let visionResponse;
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      visionResponse = await anthropic.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 1024,
        messages: [{ role: 'user', content: [...imageBlocks, { type: 'text', text: visionPrompt }] }]
      });
      break;
    } catch (visionErr) {
      const status = visionErr.status || (visionErr.response && visionErr.response.status);
      if (status === 429 && attempt < maxAttempts) {
        const backoff = 20000;
        log('WARN', 'PHOTO', `Vision 429 — backing off ${backoff/1000}s and retrying`, { attempt, batch_size: msgs.length });
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }
      throw visionErr;
    }
  }
  const imageDescription = visionResponse.content.find(b => b.type === 'text')?.text || 'Unable to analyze images.';
  log('INFO', 'PHOTO', 'Vision analysis complete', { chars: imageDescription.length, images: msgs.length });

  const contextMessage = isAlbum
    ? (caption
        ? `[User sent an album of ${msgs.length} photos with caption: "${caption}"]\n\n[Combined image analysis: ${imageDescription}]\n\nRespond to the user's request based on the whole album.`
        : `[User sent an album of ${msgs.length} photos — no caption]\n\n[Combined image analysis: ${imageDescription}]\n\nRespond helpfully about the album.`)
    : (caption
        ? `[User sent a photo with caption: "${caption}"]\n\n[Image analysis: ${imageDescription}]\n\nPlease respond to the user's request based on this image.`
        : `[User sent a photo — no caption]\n\n[Image analysis: ${imageDescription}]\n\nPlease respond helpfully about this image. You can use it for any task (generating wallpapers, analyzing screenshots, reading documents, etc.) as needed.`);

  const reply = await askSolomon(contextMessage);
  await sendLongMessage(firstMsg.chat.id, reply, { parse_mode: 'Markdown' });
  activityLogger.logActivity('message_sent', { summary: reply.slice(0, 100) });
  activityLogger.setStatus('IDLE', '');

  // Cleanup temp files
  for (const d of downloads) {
    try { fs.unlinkSync(d.localPath); } catch (_) {}
  }
}


// ══ STRUCTURED LOGGING (Item 36) ═════════════════════════════════════════
const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
const TELEGRAM_IMG_DIR = '/tmp/telegram_images';
// Deduplication set — prevents processing the same Telegram message twice (retry protection)
const _processedMsgIds = new Set();
if (!fs.existsSync(TELEGRAM_IMG_DIR)) fs.mkdirSync(TELEGRAM_IMG_DIR, { recursive: true });

const LOG_MAX_BYTES = 50 * 1024 * 1024; // 50MB hard cap per file

function getLogFile() {
  const d = new Date();
  const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const base = path.join(LOG_DIR, `solomon-${ds}.log`);
  try {
    if (fs.existsSync(base) && fs.statSync(base).size >= LOG_MAX_BYTES) {
      let n = 1;
      while (fs.existsSync(`${base}.${n}`)) n++;
      fs.renameSync(base, `${base}.${n}`);
    }
  } catch (_) {}
  return base;
}

function log(level, category, message, data) {
  const ts = new Date().toISOString();
  const entry = { ts, level, category, message, ...(data ? { data } : {}) };
  try { fs.appendFileSync(getLogFile(), JSON.stringify(entry) + '\n'); } catch (_) {}
  const prefix = `[${ts.slice(11,19)}][${level}][${category}]`;
  if (level === 'ERROR') {
    console.error(`${prefix} ${message}`, data ? JSON.stringify(data).slice(0,200) : '');
  } else {
    console.log(`${prefix} ${message}`, data ? JSON.stringify(data).slice(0,200) : '');
  }
}

// Rotate logs older than 7 days -- includes numbered rotation files (e.g. solomon-*.log.1)
function rotateLogs() {
  try {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    fs.readdirSync(LOG_DIR).filter(f => f.startsWith('solomon-')).forEach(f => {
      const fp = path.join(LOG_DIR, f);
      if (fs.statSync(fp).mtimeMs < cutoff) { fs.unlinkSync(fp); }
    });
  } catch (_) {}
}
setInterval(rotateLogs, 6 * 60 * 60 * 1000);

// ══ GLOBAL ERROR HANDLERS (Item 35) ══════════════════════════════════════
process.on('uncaughtException', (err) => {
  log('ERROR', 'PROCESS', 'Uncaught exception - bot continues', { error: err.message });
});
process.on('unhandledRejection', (reason) => {
  log('ERROR', 'PROCESS', 'Unhandled rejection - bot continues', { reason: String(reason).slice(0,300) });
});

// ── VALIDATE CONFIG ──────────────────────────────────────────────────────
const REQUIRED = ['ANTHROPIC_API_KEY', 'TELEGRAM_BOT_TOKEN', 'OWNER_CHAT_ID'];
const missing = REQUIRED.filter(k => !process.env[k]);
if (missing.length) {
  console.error('[FATAL] Missing required env vars:', missing.join(', '));
  process.exit(1);
}

// ── INIT ─────────────────────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const OWNER_ID = parseInt(process.env.OWNER_CHAT_ID);
const MODEL = process.env.MODEL || 'claude-sonnet-4-5-20250929';
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || '2048');

log('INFO', 'SYSTEM', 'Solomon V4 starting', { model: MODEL, owner: OWNER_ID });
try { require('fs').writeFileSync(require('path').join(__dirname, '.bot-start-time'), new Date().toISOString()); } catch(_) {}


// ── SMART MESSAGE SPLITTING (Phase 8B) ───────────────────────────────────
// Sends a message, splitting only if genuinely over 4000 chars.
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
  const paragraphs = text.split(/\n\n/);
  let current = '';

  for (const para of paragraphs) {
    const separator = current ? '\n\n' : '';
    if (current.length + separator.length + para.length > MAX_LEN) {
      // Flush current chunk
      if (current) chunks.push(current);
      // If a single paragraph exceeds MAX_LEN, hard-split it by character count
      if (para.length > MAX_LEN) {
        let remaining = para;
        while (remaining.length > MAX_LEN) {
          // Try to split at last newline within MAX_LEN
          const slice = remaining.slice(0, MAX_LEN);
          const lastNL = slice.lastIndexOf('\n');
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

}


// ── SYSTEM PROMPT ────────────────────────────────────────────────────────
function buildSystemPrompt() {
  const identity = mem.getCategory('identity');
  const business = mem.getCategory('business');
  const preferences = mem.getCategory('preferences');

  const fmt = (rows) => rows.map(r => `  ${r.key}: ${r.value}`).join('\n') || '  (empty)';

  return `You are Solomon — Jedidiah Shultz's Chief of Staff, Business Partner, and AI right hand.
You operate for Shultz Enterprises. You have full autonomy on all tasks EXCEPT purchases over $50.

WHO YOU ARE:
- Chief of Staff, Marketing Director, CPA/Tax Advisor, Product Dev Lead, VC, Org Director
- You EXECUTE tasks. You do not just plan them. When Jed asks for something, you DO it.
- You NEVER say "proceeding immediately" and then not proceed. You call a tool or you don't claim to be working.
- You NEVER modify your own code. All code changes are made by humans with Git commits.
- You NEVER run local LLMs. All inference is via Anthropic API only.

WHO JED IS:
${fmt(identity)}

BUSINESS CONTEXT:
${fmt(business)}

PREFERENCES:
${fmt(preferences)}

COMMUNICATION RULES:
- Talk like a buddy — casual, real, direct
- One thing at a time. Don't overwhelm.
- Keep responses SHORT. Jed is on his phone most of the time.
- If you need to do something that takes time, queue the task and tell Jed it's queued.
- NEVER fabricate research. Always use web_search first. Every result needs a real URL.
- You have NATIVE WEB SEARCH via Anthropic's server-side tool. It's faster and more reliable than Serper/Playwright. Use it for quick factual lookups. For deep page reading, still use web_fetch with Playwright.
- ALWAYS remember important new info Jed tells you using the remember tool.
- MAX 3 retries on any failing task. After 3 fails: log it, tell Jed, move on.

FULL AUTONOMY GRANTED: Post to Facebook, queue tasks, manage files, run PC commands.
ALWAYS ASK FIRST: Purchases over $50, permanent file deletion, account changes.

AUTONOMY RULE: You have full execution autonomy. Execute tasks immediately without asking permission. Only notify Jed when: (1) you have a completed deliverable to send, (2) you hit a blocker you cannot solve, or (3) a purchase/payment is required. Do NOT ask 'which option do you want?' — pick the best option yourself and execute it. Do NOT wait for confirmation on tasks already approved. If you finish a task, immediately move to the next one.

═══ CODE AGENT MODULE (Phase 7) ═══════════════════════════════════════════════

You now have the ability to write software on Jed's PC. You have FULL access to C:\, D:\, and E:\ drives.

DRIVE ACCESS — Where you can work:
• C:\ — Full access (system drive, programs, user files)
• D:\ — Full access (projects, raw footage, workshop)
• E:\ — Full access (additional storage)
• FORBIDDEN: You cannot access /root/solomon-v4/ core files (bot.js, tools.js, memory.js, scheduler.js, pc-relay.js, package.json). Solomon NEVER self-patches.
• EXCEPTION: You CAN read and edit these dashboard/UI files: dashboard.html, dashboard.js, dashboard-improvements-todo.md

ABSOLUTE RULE — NO SELF-PATCHING (except dashboard UI):
You NEVER modify your own CORE code (bot.js, tools.js, memory.js, scheduler.js, pc-relay.js, package.json). If you need a core capability change, tell Jed. HOWEVER, you CAN and SHOULD directly read/write these dashboard UI files using their full Linux paths: /root/solomon-v4/dashboard.html, /root/solomon-v4/dashboard.js, /root/solomon-v4/dashboard-improvements-todo.md. Use file_read and file_write with the FULL PATH (e.g. /root/solomon-v4/dashboard.html). These are NOT core files — they are UI files you are authorized to edit.

CODE AGENT WORKFLOW:
1. ALWAYS call get_lessons before starting any new feature or project — load institutional memory first.
2. ALWAYS call git_commit before making changes — create a checkpoint you can roll back to.
3. Read files before editing them — never assume you know what's in a file.
4. Write files in small chunks — never dump an entire 500-line app in one file_write. Break it into logical files.
5. Test before reporting "done" — run "npm run build" or "npm test" and verify it passes.
6. ALWAYS call write_lesson after any coding session — record what worked and what failed.
7. Call update_project_state after completing each phase.

ERROR BUDGET:
If a command or approach fails 3 times in a row, STOP. Do not spiral into retry loops. Instead:
• Record the error pattern with the error signature
• Report to Jed with: what you tried, what failed, and what you think the fix might be
• Wait for Jed's guidance before continuing

GIT CHECKPOINT WORKFLOW:
Before ANY code change:
  1. git_commit with message "checkpoint: before {description of planned change}"
  2. Make the change
  3. Run build/test to verify
  4. If it works: git_commit with "feat: {what you added}" or "fix: {what you fixed}"
  5. If it breaks: git_rollback to restore the checkpoint

DEPLOY GATE:
Never push to production, publish to app stores, or make anything public without Jed's explicit approval. Always ask first.


## OBS Screen Recording Protocol
- BEFORE starting any coding/building session, start OBS recording via: pc_execute("Start-Process 'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe' -ArgumentList '--startrecording','--minimize-to-tray'")
- If OBS is already running, use: pc_execute("& 'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe' --startrecording") 
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

VERIFICATION RULE:
Do NOT run commands that start persistent processes (npm run electron, npm run dev, npm start for servers). These will hang your tool executor. Instead:
• Use "npm run build" to verify the code compiles
• Use "npm test" to verify tests pass
• Ask Jed to manually run persistent processes to confirm they work
• Report what you've verified and what needs manual testing

═══ TOOL VERIFICATION LAW (ABSOLUTE — NO EXCEPTIONS) ═══════════════════════════

RULE: You MUST NOT claim any file has been created, modified, or updated unless you can point to a tool_use response in this conversation showing { ok: true }.

ENFORCEMENT:
1. Before saying "Done", "Added", "Updated", "Fixed", "Created", or any synonym — CHECK: Did you receive a tool response with ok: true?
2. If YES → Report the result with the tool's confirmation (path, bytes_written, replacements count).
3. If NO → You MUST say: "I have not yet made this change. Let me call the tool now." Then CALL the tool.
4. NEVER describe what a file "now contains" unless you wrote it via file_write/file_edit/vps_execute in THIS conversation.
5. NEVER provide a URL to verify changes unless the tool confirmed the write succeeded.
6. The ONLY valid dashboard URL is: http://167.99.237.26:3001 — not any other URL.

═══ FILE EDITING STRATEGY (MANDATORY) ══════════════════════════════════════════
- For EXISTING files: ALWAYS use file_edit (find/replace) for targeted changes.
  Do NOT rewrite entire files with file_write — it wastes tokens and may exceed output limits.
- For NEW files: Use file_write.
- For large changes to existing files: Break into multiple file_edit calls, each replacing one section.
- If file_edit returns {ok: false, replacements: 0}: your find text was wrong. Use file_read to check exact content, then retry.
- NEVER read the same file more than twice in one conversation turn. If you already read it, use the content you have.
════════════════════════════════════════════════════════════════════════════════

═══ PC CONTROL CAPABILITIES ════════════════════════════════════

You can now control Jed's PC directly. Use these tools:

pc_launch_app — Open any application
  ALWAYS verify it opened by checking pc_get_windows after
  Wait 3 seconds after launching before trying to interact

pc_gui_control — Click, type, press keys
  ALWAYS take a screenshot first to see what's on screen
  Use coordinates from the screenshot for clicking

pc_screenshot — See what's on Jed's screen
  Use this to verify actions worked
  Screenshot is sent to Jed via Telegram automatically

pc_get_windows — List all open windows
  Use to find window titles before focusing

WORKFLOW FOR OPENING ANY APP:
1. Call pc_launch_app with the app name
2. Wait 3 seconds
3. Call pc_get_windows to verify it's running
4. Call pc_screenshot to confirm it's visible
5. Report back to Jed with confirmation

NEVER report an app as open without verifying with pc_get_windows or pc_screenshot first.
VIOLATION OF THIS LAW = HALLUCINATION. Jed has caught you doing this before. It destroys trust. Tool call first, report second. Always.`;
}

// ── BUDGET CHECK (Item 37) ────────────────────────────────────────────────
async function checkBudget() {
  const total = budget.getMonthTotal();
  const hard = parseFloat(process.env.MONTHLY_BUDGET_HARD_STOP || '100');
  const alertPct80 = hard * 0.80;
  const alertPct50 = parseFloat(process.env.MONTHLY_BUDGET_ALERT || '50');
  if (total >= hard) {
    log('ERROR', 'BUDGET', `Hard stop reached: $${total.toFixed(2)} of $${hard}`);
    throw new Error(`Monthly budget hard stop: $${total.toFixed(2)} >= $${hard}. No more API calls this month.`);
  }
  if (total >= alertPct80) {
    log('WARN', 'BUDGET', `80% budget alert: $${total.toFixed(2)} of $${hard}`);
    bot.sendMessage(OWNER_ID, `⚠️ Budget Alert: $${total.toFixed(2)} of $${hard} used this month (${Math.round(total/hard*100)}%). Approaching limit.`).catch(() => {});
  } else if (total >= alertPct50) {
    log('WARN', 'BUDGET', `50% budget alert: $${total.toFixed(2)} of $${hard}`);
    bot.sendMessage(OWNER_ID, `⚠️ Budget Alert: $${total.toFixed(2)} of $${hard} used this month.`).catch(() => {});
  }
  return total;
}

// ── HALLUCINATION GUARD ──────────────────────────────────────────────────
const FILE_TASK_KEYWORDS = [
  'add', 'edit', 'modify', 'change', 'update', 'fix', 'write',
  'create', 'build', 'implement', 'insert', 'append', 'remove'
];
const FILE_TARGET_KEYWORDS = [
  'dashboard', 'dashboard.html', 'dashboard.js', 'file', '.html',
  '.js', '.json', '.md', 'code', 'feature', 'chat', 'input', 'ui'
];

function isFileModificationTask(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  const hasAction = FILE_TASK_KEYWORDS.some(k => lower.includes(k));
  const hasTarget = FILE_TARGET_KEYWORDS.some(k => lower.includes(k));
  return hasAction && hasTarget;
}

function responseHasToolCall(responseContent) {
  if (!Array.isArray(responseContent)) return false;
  return responseContent.some(block => block.type === 'tool_use');
}

const ENFORCEMENT_PROMPT = `ENFORCEMENT: Your last response contained no tool calls. For file modification tasks, you MUST invoke file_write, file_edit, or vps_execute. Do not generate text describing the changes — make the actual tool call right now. Call the tool. Show me the { ok: true } result.`;

// PC actions (screenshot, app launch, window listing, GUI) the file-task detector misses.
const PC_TASK_PATTERNS = [
  /\bscreenshot\b/i,
  /\btake\s+(?:a\s+)?(?:pc\s+)?screen/i,
  /\b(?:see|show|view)\s+(?:me\s+)?(?:my\s+|the\s+)?(?:pc\s+)?(?:screen|desktop)\b/i,
  /\b(?:open|launch|start|fire\s+up)\s+(?:up\s+)?(?:notepad|chrome|firefox|edge|davinci|resolve|obs|file\s+explorer|explorer|powershell|cmd|command\s+prompt|terminal|word|excel|outlook|spotify|steam|discord|slack)\b/i,
  /\b(?:list|show|what)\b.{0,30}\b(?:open\s+)?windows?\b/i,
  /\bbring\s+(?:up|forward)\b/i,
  /\bfocus\s+(?:on\s+)?(?:the\s+)?\w+\s+(?:window|app|tab)\b/i,
  /\bclick\s+(?:on\s+)?(?:the\s+)?(?:button|link|icon|menu|tab|field)/i,
  /\btype\s+(?:into|in)\s+(?:the\s+)?(?:window|app|field|box|search)/i,
  /\bon\s+(?:my|the)\s+(?:pc|computer|desktop)\b/i
];

function isPcTask(text) {
  if (!text) return false;
  return PC_TASK_PATTERNS.some(p => p.test(text));
}

const PC_ENFORCEMENT_PROMPT = `ENFORCEMENT: Your last response contained no tool calls. The user requested a PC action (screenshot, app launch, window list, focus, click, type, etc.). You MUST invoke pc_screenshot, pc_launch_app, pc_get_windows, or pc_gui_control right now. Do not describe what you will do — make the actual tool call. Show me the { ok: true } result. PREFER pc_launch_app over pc_execute with Start-Process when opening apps; the launch-app endpoint verifies the window appeared.`;
// ─────────────────────────────────────────────────────────────────────────

// ── WEB SEARCH HISTORY SANITIZER ─────────────────────────────────────────
// Anthropic rejects any web_search_tool_result block whose matching server_tool_use
// is not present earlier in the message list. When the turn is rebuilt across
// pause_turn / tool iterations, a result can outlive its tool_use and orphan,
// returning a 400 that crashes the turn. Drop orphaned results (idempotent, safe).
function sanitizeMessages(msgs) {
  const serverToolUseIds = new Set();
  const out = [];
  for (const msg of msgs) {
    if (!msg || !Array.isArray(msg.content)) { out.push(msg); continue; }
    const content = [];
    for (const block of msg.content) {
      if (block && block.type === 'server_tool_use') {
        serverToolUseIds.add(block.id);
        content.push(block);
      } else if (block && block.type === 'web_search_tool_result') {
        if (serverToolUseIds.has(block.tool_use_id)) content.push(block); // paired — keep
        // else orphaned — drop
      } else {
        content.push(block);
      }
    }
    if (content.length > 0) {
      out.push({ ...msg, content });
    } else if (msg.role === 'assistant') {
      // Stripping emptied the message — keep a placeholder to preserve role alternation
      out.push({ ...msg, content: [{ type: 'text', text: '(web search results omitted)' }] });
    }
  }
  return out;
}

// ── REPLY CACHE (Step 5a) ────────────────────────────────────────────────
// In-memory cache for repeated identical short queries. Keyed on a sha256 of
// the normalized message; TTL ~1 hour; capped at 500 entries (oldest evicted).
// Only caches "safe" queries — short, no slash command, no token/url/file paths,
// no time-of-day-sensitive phrasing. Skips the full askSolomon round-trip
// (including the budget log) on hit, so cache hits are essentially free.
const _replyCache = new Map();
const REPLY_CACHE_TTL_MS = 60 * 60 * 1000;
const REPLY_CACHE_MAX = 500;
let _replyCacheHits = 0;
let _replyCacheMisses = 0;
function _replyCacheKey(msg) {
  return require('crypto').createHash('sha256')
    .update(String(msg).trim().toLowerCase().replace(/\s+/g, ' '))
    .digest('hex').slice(0, 32);
}
function _replyIsCacheable(msg) {
  if (!msg || typeof msg !== 'string') return false;
  if (msg.length < 4 || msg.length > 300) return false;
  if (msg.trim().startsWith('/')) return false;
  if (/(token|secret|password|http[s]?:\/\/|@|file:\/\/|\.env|sk-|api[_-]?key)/i.test(msg)) return false;
  if (/(now|today|tonight|this morning|right now|just now|currently|latest|recent)/i.test(msg)) return false;
  return true;
}
function _replyCacheTrim() {
  if (_replyCache.size <= REPLY_CACHE_MAX) return;
  const sorted = [..._replyCache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  const toDrop = sorted.slice(0, Math.floor(REPLY_CACHE_MAX / 2));
  toDrop.forEach(([k]) => _replyCache.delete(k));
}

// ── CORE LLM CALL ────────────────────────────────────────────────────────
async function askSolomon(userMessage) {
  // 0. Cache short-circuit (Step 5a).
  let _cacheKey = null;
  if (_replyIsCacheable(userMessage)) {
    _cacheKey = _replyCacheKey(userMessage);
    const hit = _replyCache.get(_cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      _replyCacheHits++;
      log('INFO', 'CACHE', 'reply cache HIT', { key: _cacheKey.slice(0, 8), age_s: Math.round((Date.now() - hit.cachedAt) / 1000), preview: userMessage.slice(0, 40) });
      // Mirror the same side effects a fresh reply would have so /status, /stats,
      // and message history all stay coherent — except for the budget log.
      messages.add('user', userMessage);
      messages.add('assistant', hit.reply);
      activityLogger.setStatus('IDLE', '[cache hit]');
      return hit.reply;
    }
    _replyCacheMisses++;
  }

  resetFileReadCache();
  activityLogger.setStatus('THINKING', userMessage.slice(0, 80));
  // 1. Budget check first
  await checkBudget();

  // 2. Add user message to history
  messages.add('user', userMessage);

  // 3. Build conversation from DB (last 20 messages)
  const history = messages.getLast(20);

  // 4. Call Claude with tools
  // Build cached system prompt and tools for prompt caching
  const cachedSystem = [
    {
      type: "text",
      text: buildSystemPrompt(),
      cache_control: { type: "ephemeral" }
    }
  ];
  const cachedTools = [
    // Anthropic server tool: native web search (faster, no Playwright needed)
    {
      type: "web_search_20250305",
      name: "web_search",
      max_uses: 5
    },
    // Anthropic native memory tool (client-side)
    {
      type: "memory_20250818",
      name: "memory"
    },
    // Custom tools with cache_control on the last one
    ...TOOL_DEFINITIONS.map((tool, index) => {
      if (index === TOOL_DEFINITIONS.length - 1) {
        return { ...tool, cache_control: { type: "ephemeral" } };
      }
      return tool;
    })
  ];

  let response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: cachedSystem,
    tools: cachedTools,
    messages: sanitizeMessages(history),
    ...(isPcTask(userMessage) || isFileModificationTask(userMessage) ? { tool_choice: { type: 'any' } } : {})
  });

  // 5. Log tokens to budget
  budget.log({
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    model: MODEL
  });
  // Log cache performance
  if (response.usage.cache_creation_input_tokens || response.usage.cache_read_input_tokens) {
    log('INFO', 'CACHE', 'Prompt caching stats', {
      cache_creation: response.usage.cache_creation_input_tokens || 0,
      cache_read: response.usage.cache_read_input_tokens || 0,
      input_tokens: response.usage.input_tokens
    });
  }

  // 6. Tool loop — max 8 iterations to prevent infinite loops
  // Handles both custom tool_use (client-side) and server tools (pause_turn)
  let iterations = 0;
  let workingHistory = [...history]; // accumulates all exchanges within this turn
  while ((response.stop_reason === 'tool_use' || response.stop_reason === 'pause_turn') && iterations < 25) {
    iterations++;

    // Handle pause_turn (server tools like web_search executed by Anthropic)
    if (response.stop_reason === 'pause_turn') {
      log('INFO', 'TOOL', 'Server tool pause_turn — continuing conversation');
      // Pass the response content back as assistant message to continue the turn
      const assistantMsg = { role: 'assistant', content: response.content };
      workingHistory = [...workingHistory, assistantMsg];
      response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: cachedSystem,
        tools: cachedTools,
        messages: sanitizeMessages(workingHistory)
      });
      budget.log({
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        model: MODEL
      });
      continue;
    }

    // Handle custom tool_use (client-side execution)
    const toolUses = response.content.filter(b => b.type === 'tool_use');
    const toolResults = [];

    for (const tu of toolUses) {
      const _toolStart = Date.now();
      activityLogger.setStatus('WORKING', `Tool: ${tu.name}`);
      activityLogger.logActivity('tool_call', { toolName: tu.name, status: 'started', summary: `Calling ${tu.name}` });
      
      let result;
      if (tu.name === 'memory') {
        // Map native memory tool call to our memory_manage executor
        result = await executeTool('memory_manage', tu.input);
      } else if (tu.name === 'file_read') {
        // ── FILE READ CACHE: prevent read loops ──
        const filePath = tu.input.path || tu.input.file_path || '';
        const readKey = filePath;
        const currentCount = fileReadCount.get(readKey) || 0;
        if (currentCount >= FILE_READ_MAX_PER_TURN && fileReadCache.has(readKey)) {
          // 3rd+ read: return cached with WARNING
          result = '[FILE_READ_CACHE] WARNING: You have already read this file ' + currentCount + ' times this turn. Use the content below and proceed with file_edit. Do NOT read again.\n\n' + fileReadCache.get(readKey);
          log('WARN', 'CACHE', 'file_read blocked (loop prevention)', { path: filePath, count: currentCount + 1 });
        } else if (currentCount === 1 && fileReadCache.has(readKey)) {
          // 2nd read: return cached with note
          fileReadCount.set(readKey, currentCount + 1);
          result = '[FILE_READ_CACHE] Note: Returning cached content (read #2). Next read will be blocked.\n\n' + fileReadCache.get(readKey);
        } else {
          // 1st read: execute normally and cache
          result = await executeTool(tu.name, tu.input);
          const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
          fileReadCache.set(readKey, resultStr);
          fileReadCount.set(readKey, currentCount + 1);
        }
      } else {
        result = await executeTool(tu.name, tu.input);
      }
      
      const _toolDur = Date.now() - _toolStart;
      activityLogger.logActivity('tool_call', { toolName: tu.name, status: 'ok', summary: `${tu.name} completed`, durationMs: _toolDur });
      log('INFO', 'TOOL', `${tu.name} result`, { result: typeof result === 'string' ? result.slice(0, 200) : JSON.stringify(result).slice(0,200) });
      
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: typeof result === 'string' ? result : JSON.stringify(result)
      });
    }

    // Accumulate this exchange so each API call in the loop sees the full chain
    const assistantMsg = { role: 'assistant', content: response.content };
    const toolResultMsg = { role: 'user', content: toolResults };
    workingHistory = [...workingHistory, assistantMsg, toolResultMsg];
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: cachedSystem,
      tools: cachedTools,
      messages: sanitizeMessages(workingHistory)
    });

    budget.log({
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      model: MODEL
    });
  }

  // ── HALLUCINATION ENFORCEMENT GATE ─────────────────────────────────────
  // If this was a file or PC task and Solomon returned only text (no tool call), force a retry
  const _hgFileTask = isFileModificationTask(userMessage);
  const _hgPcTask = !_hgFileTask && isPcTask(userMessage);
  if (
    (_hgFileTask || _hgPcTask) &&
    !responseHasToolCall(response.content) &&
    response.stop_reason === 'end_turn'
  ) {
    const _hgLabel = _hgFileTask ? 'file modification' : 'PC action';
    const _hgPrompt = _hgFileTask ? ENFORCEMENT_PROMPT : PC_ENFORCEMENT_PROMPT;
    log('WARN', 'HALLUCINATION', `Text-only response to ${_hgLabel} task. Enforcing tool call.`);
    // Give Solomon one more chance with explicit enforcement prompt
    const enforcedHistory = [
      ...history,
      { role: 'assistant', content: response.content },
      { role: 'user', content: [{ type: 'text', text: _hgPrompt }] }
    ];
    const enforced = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: cachedSystem,
      tools: cachedTools,
      messages: sanitizeMessages(enforcedHistory)
    });
    budget.log({
      inputTokens: enforced.usage.input_tokens,
      outputTokens: enforced.usage.output_tokens,
      model: MODEL
    });
    // If enforced response has a tool call, process it through the tool loop
    if (enforced.stop_reason === 'tool_use') {
      log('INFO', 'HALLUCINATION', 'Enforcement succeeded — tool call triggered');
      response = enforced;
      // Run one more tool loop iteration
      const toolUses = response.content.filter(b => b.type === 'tool_use');
      const toolResults = [];
      for (const tu of toolUses) {
        const _toolStart = Date.now();
        activityLogger.setStatus('WORKING', `Tool: ${tu.name}`);
        activityLogger.logActivity('tool_call', { toolName: tu.name, status: 'started', summary: `Calling ${tu.name}` });
        let result;
        if (tu.name === 'memory') {
          result = await executeTool('memory_manage', tu.input);
        } else {
          result = await executeTool(tu.name, tu.input);
        }
        const _toolDur = Date.now() - _toolStart;
        activityLogger.logActivity('tool_call', { toolName: tu.name, status: 'ok', summary: `${tu.name} completed`, durationMs: _toolDur });
        log('INFO', 'TOOL', `${tu.name} result`, { result: typeof result === 'string' ? result.slice(0, 200) : JSON.stringify(result).slice(0,200) });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: typeof result === 'string' ? result : JSON.stringify(result)
        });
      }
      // Get final response after tool execution
      const assistantMsg = { role: 'assistant', content: response.content };
      const toolResultMsg = { role: 'user', content: toolResults };
      response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: cachedSystem,
        tools: cachedTools,
        messages: sanitizeMessages([...enforcedHistory, assistantMsg, toolResultMsg])
      });
      budget.log({
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        model: MODEL
      });
    } else {
      log('WARN', 'HALLUCINATION', 'Enforcement failed — Solomon still did not call a tool');
      response = enforced;
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  // 7. Extract final text response + AUTO-CONTINUATION
  const textBlock = response.content.find(b => b.type === 'text');
  const finalText = textBlock ? textBlock.text : '(Task queued \u2014 will report back when done)';

  // AUTO-CONTINUE: If Solomon used tools AND his text indicates work in progress,
  // send the progress update to Telegram and keep working automatically.
  function shouldAutoContinue(responseText, toolCallsMade) {
    if (toolCallsMade === 0) return false;
    
    const incompleteSignals = [
      /next[,\s]+i('ll| will)/i,
      /step \d+ (of \d+|complete)/i,
      /continuing/i,
      /now (let me|i'll|i will)/i,
      /moving (on|to) (the )?next/i,
      /\d+ (more|remaining)/i,
      /let me (now|proceed|continue)/i,
      /i('ll| will) (now|next|proceed)/i
    ];
    
    return incompleteSignals.some(pattern => pattern.test(responseText));
  }
  const isProgressUpdate = shouldAutoContinue(finalText, iterations);

  // Use a module-level counter to prevent infinite self-continuation
  if (!global._solContinuationCount) global._solContinuationCount = 0;
  const MAX_CONTINUATIONS = 8;

  if (isProgressUpdate && global._solContinuationCount < MAX_CONTINUATIONS) {
    global._solContinuationCount++;
    log('INFO', 'AUTO-CONTINUE', `Progress detected, continuing work (${global._solContinuationCount}/${MAX_CONTINUATIONS})`);

    // Send progress to Telegram so Jed sees updates in real time
    try {
      await bot.sendMessage(OWNER_ID, finalText, { parse_mode: 'Markdown' }).catch(() =>
        bot.sendMessage(OWNER_ID, finalText)
      );
    } catch (_) {}

    // Save progress to history and auto-inject continuation
    messages.add('assistant', finalText);
    messages.add('user', 'Continue working. Do not repeat what you just said — proceed to the next step.');

    // Recursive call to keep working
    const continueResult = await askSolomon('Continue working. Do not repeat what you just said \u2014 proceed to the next step.');
    global._solContinuationCount = 0;
    return continueResult;
  }

  // Normal completion — reset counter
  global._solContinuationCount = 0;

  // 8. Save assistant response to history
  messages.add('assistant', finalText);
  activityLogger.setStatus('IDLE', '');

  // 9. Cache the reply (Step 5a) if the query was cacheable.
  if (_cacheKey) {
    _replyCache.set(_cacheKey, { reply: finalText, cachedAt: Date.now(), expiresAt: Date.now() + REPLY_CACHE_TTL_MS });
    _replyCacheTrim();
  }
  return finalText;
}

// ── SOCIAL CROSS-POST ─────────────────────────────────────────────────────
// Triggered by "post this to all socials" (and /post). Rewrites the content per
// platform with Claude, then AUTO-POSTS where the platform + token actually allow:
//  • Facebook — auto-posts to both pages (falls back to FACEBOOK_PAGE_TOKEN if a
//    page token is expired).
//  • Instagram — auto-posts only if a Business account is linked AND an image is
//    supplied (IG feed posts can't be text-only); otherwise hands back the caption.
//  • YouTube community — always handed back: the YouTube Data API has no
//    community-post endpoint, so it can't be auto-posted even with a valid token.
async function handleCrossPost(content, chatId) {
  bot.sendChatAction(chatId, 'typing').catch(() => {});
  log('INFO', 'SOCIAL', 'Cross-post requested', { preview: content.slice(0, 80) });
  let variants;
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: "You are Solomon, social media manager for Jed Shultz's construction brands (Building Shultz and Irish Craftsman). Rewrite the owner's raw content into platform-optimized posts. Voice: direct, practical, no fluff, grounded in real jobsite experience. Return ONLY compact JSON with exactly these keys: \"facebook\" (1-2 short paragraphs, conversational, CTA-friendly, minimal hashtags), \"instagram_caption\" (punchy and scannable, a few tasteful emoji, max 2200 chars, no hashtags here), \"instagram_hashtags\" (a single string of 8-15 relevant hashtags separated by spaces), \"youtube_community\" (one short community-post paragraph ending with a question to drive engagement). No preamble, no markdown code fences.",
      messages: [{ role: 'user', content: `Raw content to adapt for all platforms:\n\n${content}` }]
    });
    const txt = (resp.content.find(b => b.type === 'text') || {}).text || '';
    const m = txt.match(/\{[\s\S]*\}/);
    variants = m ? JSON.parse(m[0]) : null;
  } catch (e) {
    log('ERROR', 'SOCIAL', 'Rewrite failed', { error: e.message });
    bot.sendMessage(chatId, `❌ Couldn't generate social versions: ${e.message.slice(0, 150)}`).catch(() => {});
    return;
  }
  if (!variants || !variants.facebook) {
    bot.sendMessage(chatId, '❌ Could not parse platform versions from Claude. Try rephrasing the content.').catch(() => {});
    return;
  }

  // Detect which platforms we can auto-post to right now (live token/account check).
  let auth;
  try { auth = await getSocialAuthStatus(); }
  catch (e) { auth = { youtube: { tokenValid: false }, facebook: {}, instagram: {} }; }

  const sendSafe = (m) => bot.sendMessage(chatId, m, { parse_mode: 'Markdown' }).catch(() =>
    bot.sendMessage(chatId, m.replace(/[*_`]/g, '')).catch(() => {}));

  // ── Facebook: auto-post to both pages (social_post falls back to the spare token) ──
  const fbResults = [];
  for (const [pageKey, pageLabel] of [['building_shultz', 'Building Shultz'], ['irish_craftsman', 'Irish Craftsman']]) {
    try {
      const r = await executeTool('social_post', { page: pageKey, platform: 'facebook', message: variants.facebook });
      fbResults.push(`${r.ok ? '✅' : '❌'} ${pageLabel}${r.ok ? ` (id ${r.post_id})` : `: ${r.error || 'failed'}`}`);
    } catch (e) {
      fbResults.push(`❌ ${pageLabel}: ${e.message.slice(0, 100)}`);
    }
  }
  await sendSafe(`📘 *Facebook — auto-posted*\n${fbResults.join('\n')}`);

  // ── Instagram: auto-post only if a Business account is linked AND we have an image. ──
  const igReady = !!(auth.instagram && ((auth.instagram.building_shultz && auth.instagram.building_shultz.ready) || (auth.instagram.irish_craftsman && auth.instagram.irish_craftsman.ready)));
  const igCaption = `${variants.instagram_caption || ''}\n\n${variants.instagram_hashtags || ''}`.trim();
  if (igReady && variants.image_url) {
    const igPage = (auth.instagram.building_shultz && auth.instagram.building_shultz.ready) ? 'building_shultz' : 'irish_craftsman';
    try {
      const r = await executeTool('social_post', { page: igPage, platform: 'instagram', message: variants.instagram_caption, image_url: variants.image_url });
      await sendSafe(r.ok ? `📸 *Instagram — auto-posted* (id ${r.post_id})` : `📸 *Instagram — paste manually* (${r.error})\n\n${igCaption}`);
    } catch (e) {
      await sendSafe(`📸 *Instagram — paste manually* (${e.message.slice(0, 80)})\n\n${igCaption}`);
    }
  } else {
    const igReason = igReady
      ? 'account connected, but a post needs an image — paste this with a photo'
      : 'no IG Business account linked yet — paste manually';
    await sendSafe(`📸 *Instagram — ${igReason}*\n\n${igCaption}`);
  }

  // ── YouTube community: try the Playwright browser-post path first (real browser via
  //    a saved auth state). If the state file is missing or selectors fail, fall back to
  //    the Telegram hand-back. The YT Data API has no community-post endpoint, so this
  //    browser route is the only way to auto-post community posts. ──
  let ytAutoPosted = false, ytNote = 'paste manually';
  try {
    const ytRes = await executeTool('post_via_browser', { platform: 'youtube', content: variants.youtube_community || '' });
    if (ytRes && ytRes.ok) { ytAutoPosted = true; }
    else if (ytRes && ytRes.error) { ytNote = ytRes.error.slice(0, 160); }
  } catch (e) { ytNote = 'browser-post error: ' + e.message.slice(0, 120); }
  if (ytAutoPosted) {
    await sendSafe(`▶️ *YouTube community post — auto-posted via browser*`);
  } else {
    await sendSafe(`▶️ *YouTube community post — paste manually*\n(_${ytNote}_)\n\n${variants.youtube_community || ''}`);
  }

  try { mem.set('social_log', new Date().toISOString(), JSON.stringify({ kind: 'cross_post', fb: fbResults, igReady, ytAutoPosted, preview: content.slice(0, 60) })); } catch (_) {}
  log('INFO', 'SOCIAL', 'Cross-post complete', { fb: fbResults.join('; '), igReady, ytAutoPosted });
}

// Generate + send the morning brief on demand (same content as the 6 AM job).
async function generateBrief(chatId) {
  await executeTool('prepare_morning_brief', {}).catch(() => {});
  const compiledRaw = mem.get('system', 'morning_brief_compiled');
  let briefData = null;
  if (compiledRaw) { try { briefData = JSON.parse(compiledRaw); } catch (_) {} }
  let context;
  if (briefData) {
    context = `Generate a concise morning brief for Jedidiah Shultz from this compiled data:\n${JSON.stringify(briefData)}\nFormat: short bullet points, what needs his attention today, highlight urgent items, under 400 words.`;
  } else {
    const pending = tasks.getPending();
    const budgetTotal = budget.getMonthTotal();
    context = `Generate a concise morning brief for Jedidiah Shultz. Pending tasks: ${pending.length}. Month spend: $${budgetTotal.toFixed(2)}. Short bullet points, under 300 words.`;
  }
  const resp = await anthropic.messages.create({ model: MODEL, max_tokens: 600, messages: [{ role: 'user', content: context }] });
  budget.log({ inputTokens: resp.usage.input_tokens, outputTokens: resp.usage.output_tokens, model: MODEL });
  const brief = `🌅 *Morning Brief*\n${resp.content[0].text}`;
  await bot.sendMessage(chatId, brief, { parse_mode: 'Markdown' }).catch(() => bot.sendMessage(chatId, brief.replace(/[*_`]/g, '')));
}

// ══ JED-TASK DONE DETECTION ═══════════════════════════════════════════════
// When Jed says "done with the IRS call" / "finished the KDP upload" / "mark
// the FB tokens done" we fuzzy-match against open jed_tasks (via Claude, low
// temp, structured JSON) and update status. Pattern-gated first so the regex
// cost stays cheap on the 99% of messages that aren't completion markers.
const _doneRegex = /(?:^|\s)(?:done\s+with|finished|completed?|wrapped\s+up|mark\b[^,.]*\bdone|knocked\s+out|crossed\s+off|that.{0,5}done)\b/i;
async function _maybeHandleDoneMarker(chatId, text) {
  const open = jedTasks.getOpen();
  if (!open.length) return false; // nothing to mark — fall through
  // Cheap-side: if the message is very long, it probably wasn't a completion
  // signal even though it contains "done" somewhere. Cap to 280 chars.
  if (text.length > 280) return false;
  const catalogue = open.map(t => ({ id: t.id, priority: t.priority, task: t.task, category: t.category }));
  let resp;
  try {
    resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 200,
      system:
`You match Jed's completion message to ONE open jed_task row. Respond ONLY in compact JSON:
{"matched_id": <integer or null>, "confidence": "high"|"medium"|"low", "rationale": "one short sentence"}

Pick "high" only when one task is clearly THE one (verb + noun match the task description). Pick "medium" when probable but two open tasks could fit. Pick "low" when nothing fits well — set matched_id to null. NEVER guess.`,
      messages: [{ role: 'user', content: `Jed message: ${JSON.stringify(text)}\n\nOpen tasks:\n${JSON.stringify(catalogue, null, 2)}` }]
    });
  } catch (e) {
    log('ERROR', 'JEDTASKS', 'fuzzy-match Claude call failed', { error: e.message });
    return false;
  }
  budget.log({ inputTokens: resp.usage && resp.usage.input_tokens, outputTokens: resp.usage && resp.usage.output_tokens, model: MODEL });
  const txt = (resp.content.find(b => b.type === 'text') || {}).text || '';
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return false;
  let parsed; try { parsed = JSON.parse(m[0]); } catch (_) { parsed = null; }
  if (!parsed) return false;

  // No confident match → fall through to normal handling (don't claim to mark anything).
  if (!parsed.matched_id || parsed.confidence === 'low') return false;

  // Ambiguous → ask Jed which one, don't auto-pick.
  if (parsed.confidence === 'medium') {
    const list = open.map(t => `  #${t.id}  ${t.task.slice(0, 90)}`).join('\n');
    await bot.sendMessage(chatId,
      `✋ Couldn't tell which one you meant. Reply with the task number (e.g. "mark #${open[0].id} done"):\n${list}`
    ).catch(() => {});
    return true; // we handled it (by asking), don't fall through
  }

  // High confidence → mark done.
  const row = jedTasks.getById(parsed.matched_id);
  if (!row || row.status !== 'open') {
    await bot.sendMessage(chatId, `Hmm — task #${parsed.matched_id} not open or not found.`).catch(() => {});
    return true;
  }
  jedTasks.markDone(row.id);
  const remaining = jedTasks.getOpen().length;
  await bot.sendMessage(chatId,
    `✅ Marked done: #${row.id} ${row.task}\n${remaining === 0 ? '🎉 All tasks done.' : `${remaining} task${remaining === 1 ? '' : 's'} still open.`}`,
    { parse_mode: 'Markdown' }
  ).catch(() => bot.sendMessage(chatId, `Marked done: #${row.id} ${row.task}`).catch(() => {}));
  activityLogger.logActivity('jed_task_done', { summary: `#${row.id} ${row.task.slice(0, 80)}` });
  return true;
}

// ══ INLINE-BUTTON APPROVAL FLOWS ════════════════════════════════════════
// Two flows share this plumbing:
//   • FB comment auto-reply       (✅ Post It / ✍️ Edit)
//   • Campaign post preview       (✅ Post Now / ✍️ Edit / ⏭️ Skip)
// The scheduler creates a row in mem('pending_action', id) = JSON({type, status,
// deadline_ts, payload, …}). Telegram inline_keyboard buttons carry callback_data
// "act:<id>:<verb>". Here we look up the action, dispatch, and persist the new
// status so the watcher cron knows whether to auto-fire later.
async function _executeFbReply(action, replyText) {
  const p = action.payload;
  const r = await executeTool('reply_fb_comment', { page: p.page, comment_id: p.comment_id, message: replyText });
  return r.ok
    ? `✅ Posted reply on ${p.page_label || p.page} (reply id ${r.reply_id})`
    : `❌ Reply failed: ${r.error}`;
}

async function _executeCampaignPost(action, overrideFacebook) {
  const p = action.payload;
  const fbText = (overrideFacebook && overrideFacebook.trim()) || p.facebook;
  const fbResults = [];
  for (const [pageKey, label] of [['building_shultz', 'Building Shultz'], ['irish_craftsman', 'Irish Craftsman']]) {
    try {
      const r = await executeTool('social_post', { page: pageKey, platform: 'facebook', message: fbText });
      fbResults.push(`${r.ok ? '✅' : '❌'} ${label}${r.ok ? ` (id ${r.post_id})` : `: ${r.error || 'failed'}`}`);
    } catch (e) { fbResults.push(`❌ ${label}: ${e.message.slice(0, 80)}`); }
  }
  return `📅 *Day ${p.dayIndex}/30 — ${p.slot}* posted to Facebook:\n${fbResults.join('\n')}\n\n📸 Instagram + ▶️ YouTube handbacks were sent at preview time.`;
}

function _setActionStatus(actionId, status, patch) {
  const raw = mem.get('pending_action', actionId);
  if (!raw) return null;
  let a; try { a = JSON.parse(raw); } catch (_) { return null; }
  a.status = status;
  if (patch) Object.assign(a, patch);
  mem.set('pending_action', actionId, JSON.stringify(a));
  return a;
}

bot.on('callback_query', async (cq) => {
  try {
    if (!cq.from || cq.from.id !== OWNER_ID) {
      bot.answerCallbackQuery(cq.id, { text: 'Not authorized.' }).catch(() => {});
      return;
    }
    const data = cq.data || '';
    const m = data.match(/^act:([a-zA-Z0-9_-]+):(post|edit|skip)$/);
    if (!m) { bot.answerCallbackQuery(cq.id, { text: 'Unknown action.' }).catch(() => {}); return; }
    const [, actionId, verb] = m;
    const raw = mem.get('pending_action', actionId);
    if (!raw) { bot.answerCallbackQuery(cq.id, { text: 'This action expired.' }).catch(() => {}); return; }
    let action; try { action = JSON.parse(raw); } catch (_) { return; }
    if (action.status && action.status !== 'pending') {
      bot.answerCallbackQuery(cq.id, { text: `Already ${action.status}.` }).catch(() => {});
      return;
    }
    bot.answerCallbackQuery(cq.id, { text: '👍' }).catch(() => {});

    if (verb === 'skip') {
      _setActionStatus(actionId, 'skipped');
      await bot.sendMessage(cq.message.chat.id, `⏭️ Skipped: ${action.payload?.label || action.type}.`).catch(() => {});
      return;
    }

    if (verb === 'edit') {
      // Park us in edit-mode for this user. The next non-slash text message
      // becomes the replacement content for this action.
      mem.set('pending_edit', String(OWNER_ID), JSON.stringify({ actionId, type: action.type, ts: Date.now() }));
      const hint = action.type === 'fb_reply'
        ? `✍️ Send your replacement reply text now. It will be posted to ${action.payload.page_label || action.payload.page} as the reply to ${action.payload.commenter}.`
        : `✍️ Send the replacement Facebook post text now. It will be posted to BOTH pages. (Instagram + YouTube handbacks at preview time still stand.)`;
      await bot.sendMessage(cq.message.chat.id, hint).catch(() => {});
      return;
    }

    // verb === 'post' — fire immediately with the original content.
    _setActionStatus(actionId, 'posting');
    let resultMsg;
    if (action.type === 'fb_reply') {
      resultMsg = await _executeFbReply(action, action.payload.suggestion);
    } else if (action.type === 'campaign_preview') {
      resultMsg = await _executeCampaignPost(action, null);
    } else {
      resultMsg = `Unknown action type: ${action.type}`;
    }
    _setActionStatus(actionId, 'posted');
    await bot.sendMessage(cq.message.chat.id, resultMsg, { parse_mode: 'Markdown' })
      .catch(() => bot.sendMessage(cq.message.chat.id, resultMsg.replace(/[*_`]/g, '')));
  } catch (e) {
    log('ERROR', 'CALLBACK', 'callback_query handler failed', { error: e.message });
    try { bot.answerCallbackQuery(cq.id, { text: 'Internal error.' }); } catch (_) {}
  }
});

// ── TELEGRAM MESSAGE HANDLER ─────────────────────────────────────────────
bot.on('message', async (msg) => {
  // Only respond to Jed
  if (msg.chat.id !== OWNER_ID) {
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
  const text = msg.text || msg.caption || '';
  if (!text && !msg.photo) return;

  // ── EDIT-MODE INTERCEPT (inline-button ✍️ flow) ──────────────────────
  // If we asked Jed for replacement text, treat his next text message as the
  // edited content and fire the action. Slash commands and photos bypass.
  if (text && !text.startsWith('/') && !msg.photo) {
    const rawEdit = mem.get('pending_edit', String(OWNER_ID));
    if (rawEdit) {
      let ed; try { ed = JSON.parse(rawEdit); } catch (_) { ed = null; }
      // Expire stale edit windows after 15 minutes so a random later message
      // is never accidentally treated as a reply.
      if (ed && ed.actionId && (Date.now() - (ed.ts || 0)) < 15 * 60 * 1000) {
        mem.set('pending_edit', String(OWNER_ID), ''); // clear immediately
        const raw = mem.get('pending_action', ed.actionId);
        if (raw) {
          let action; try { action = JSON.parse(raw); } catch (_) {}
          if (action) {
            _setActionStatus(ed.actionId, 'posting');
            let resultMsg;
            try {
              if (action.type === 'fb_reply') resultMsg = await _executeFbReply(action, text);
              else if (action.type === 'campaign_preview') resultMsg = await _executeCampaignPost(action, text);
              else resultMsg = `Unknown action type: ${action.type}`;
              _setActionStatus(ed.actionId, 'posted');
            } catch (e) {
              _setActionStatus(ed.actionId, 'failed');
              resultMsg = `❌ Edit-and-post failed: ${e.message.slice(0, 200)}`;
            }
            await bot.sendMessage(msg.chat.id, resultMsg, { parse_mode: 'Markdown' })
              .catch(() => bot.sendMessage(msg.chat.id, resultMsg.replace(/[*_`]/g, '')));
            return;
          }
        }
        // Couldn't find the action — fall through to normal handling.
      } else if (ed) {
        // Stale entry, clear it silently.
        mem.set('pending_edit', String(OWNER_ID), '');
      }
    }
  }

  // ── PHOTO HANDLER (Phase 8B — Rate-Limited Queue + Album Batching) ────
  if (msg.photo) {
    log('INFO', 'PHOTO', 'Received photo, dispatching', { message_id: msg.message_id, media_group_id: msg.media_group_id || null, queue_size: _imageQueue.length });
    bot.sendChatAction(msg.chat.id, 'typing').catch(() => {});
    enqueuePhoto(msg); // Single-photo → queue immediately; album → debounce then batch
    return;
  }
  // ── END PHOTO HANDLER ────────────────────────────────────────────────
  // Redact secrets from logs (token-bearing commands must not leak into log files / dashboard).
  const safeText = text.replace(/^\/setfbtoken\b.*$/i, '/setfbtoken [REDACTED]');
  log('INFO', 'MSG', `Jed: ${safeText.slice(0, 100)}`);
  activityLogger.logActivity('message_received', { summary: safeText.slice(0, 100) });

  // Slash commands are handled by their dedicated onText handlers below — don't
  // also run them through the LLM (prevents double-processing of /post, /status, etc.).
  if (text.startsWith('/')) return;

  // ── DONE-DETECT INTERCEPT: Jed marking a jed_task complete ─────────────
  // Pattern-gated first (cheap regex), then Claude fuzzy-match against the
  // open task list (precise, single-task confirmation). Single task at a time:
  // if ambiguous, ask which one. Routes through async helper so the rest of
  // the message handler doesn't pay the cost on every message.
  if (text && _doneRegex.test(text)) {
    try {
      const handled = await _maybeHandleDoneMarker(msg.chat.id, text);
      if (handled) return;
    } catch (e) { log('ERROR', 'JEDTASKS', 'done-detect failed', { error: e.message }); }
  }

  // ── CROSS-POST INTERCEPT: "post this to all socials" ──────────────────
  if (/post this to all socials/i.test(text)) {
    const content = text.replace(/post this to all socials/i, '').replace(/^[\s:,\-–—]+|[\s:,\-–—]+$/g, '').trim();
    if (!content) {
      bot.sendMessage(msg.chat.id, '📣 Send the content together with "post this to all socials" — paste your update, then add that line.').catch(() => {});
      return;
    }
    await handleCrossPost(content, msg.chat.id);
    return;
  }

  // ── "update the context" — Jed explicitly logs a note to the permanent master context ──
  if (/update (the )?context/i.test(text)) {
    const note = text.replace(/.*update (the )?context[:,\s\-–—]*/i, '').trim();
    const r = await executeTool('append_master_context', { section: 'GENERAL', entry: note || 'Manual context update (no note provided).' });
    bot.sendMessage(msg.chat.id, r.ok ? `📝 Logged to master context (${r.section}):\n${r.entry}` : `⚠️ ${r.error}`).catch(() => {});
    return;
  }

  // ── AUTO-DISPATCH (invisible /dispatch) ───────────────────────────────
  // When dispatch mode is 'live', every non-slash message is routed through
  // the dispatch classifier automatically. 'shadow' (the default) reverts to
  // normal conversational handling. Flip with /dispatch mode live|shadow.
  {
    const dmode = mem.get('dispatch', 'mode') || (process.env.DISPATCH_MODE === 'live' ? 'live' : 'shadow');
    if (dmode === 'live') {
      bot.sendChatAction(msg.chat.id, 'typing').catch(() => {});
      try {
        const dispatch = require('./dispatch');
        const result = await dispatch.classifyAndRoute(text, {
          mem,
          executors: { solomon: async (t, inputs, filled) => askSolomon(filled || text) }
        });
        const ar = result.action_result || {};
        if (result.decision === 'execute_direct' || result.decision === 'execute_after_nathan') {
          log('INFO', 'AUTODISPATCH', `live route: ${result.template?.id} -> ${ar.kind}`, { decision: result.decision });
          if (ar.kind === 'caleb_payload') {
            // Hand the structured payload to the PC relay's /caleb-task endpoint.
            let queued = false, detail = '';
            try {
              const resp = await axios.post(`${process.env.PC_RELAY_URL}/caleb-task`, ar.payload, {
                headers: { 'X-Secret': process.env.PC_RELAY_SECRET, 'Content-Type': 'application/json' },
                timeout: 15000
              });
              queued = !!(resp.data && resp.data.ok);
              detail = resp.data && resp.data.file ? ` (${resp.data.file})` : '';
            } catch (e) {
              detail = ` — relay error: ${String(e.response?.data?.error || e.message || '').slice(0, 160)}`;
            }
            await bot.sendMessage(msg.chat.id,
              `${queued ? '🤖 *Caleb task queued*' : '⚠️ *Caleb dispatch failed*'}\nTemplate: \`${result.template?.id}\`\nTask: ${ar.payload?.task || '(n/a)'}${detail}`,
              { parse_mode: 'Markdown' }).catch(() => {});
            return;
          }
          if (ar.kind === 'sam_queued') {
            await bot.sendMessage(msg.chat.id,
              `🛠️ *Sam task queued*\nTemplate: \`${result.template?.id}\`\nJob: \`${ar.job_id}\``,
              { parse_mode: 'Markdown' }).catch(() => {});
            return;
          }
          if (ar.kind === 'solomon_executed') {
            const out = typeof ar.result === 'string' ? ar.result : (ar.result?.reply || String(JSON.stringify(ar.result)).slice(0, 1500));
            await sendLongMessage(msg.chat.id, out, { parse_mode: 'Markdown' });
            activityLogger.logActivity('message_sent', { summary: String(out).slice(0, 100) });
            activityLogger.setStatus('IDLE', '');
            return;
          }
          // unknown / no-executor kinds → fall through to normal handling.
          log('INFO', 'AUTODISPATCH', `unhandled action kind, conversational fallback`, { kind: ar.kind });
        } else {
          // consult_nathan / escalate_jed → fall through to normal askSolomon
          // so Jed always gets a helpful conversational answer.
          log('INFO', 'AUTODISPATCH', `non-execute decision, conversational fallback`, { decision: result.decision, reason: String(result.reason || '').slice(0, 160) });
        }
      } catch (e) {
        log('ERROR', 'AUTODISPATCH', 'auto-dispatch error, falling back to askSolomon', { error: e.message });
      }
    }
  }

  // Show typing indicator
  bot.sendChatAction(msg.chat.id, 'typing').catch(() => {});

  try {
    const reply = await askSolomon(text);

    await sendLongMessage(msg.chat.id, reply, { parse_mode: 'Markdown' });
    activityLogger.logActivity('message_sent', { summary: reply.slice(0, 100) });
    activityLogger.setStatus('IDLE', '');
  } catch (err) {
    log('ERROR', 'MSG', 'Message handler error', { error: err.message });
    activityLogger.logActivity('error', { status: 'error', summary: err.message.slice(0, 200) });
    activityLogger.setStatus('IDLE', '');
    const errorMsg = err.message.includes('budget')
      ? `🛑 Monthly budget limit reached. Use /budget to check.`
      : `❌ Error: ${err.message.slice(0, 200)}`;
    bot.sendMessage(msg.chat.id, errorMsg).catch(() => {});
  }
});

// ── COMMANDS ─────────────────────────────────────────────────────────────
// /tasks -- Jed's open action items, grouped by priority. Earlier /tasks showed
// the internal Sam build queue, which Jed never asked about; this now surfaces
// the jed_tasks table which is what Jed actually wants when he types /tasks.
bot.onText(/^\/tasks\b/i, async (msg) => {
  if (msg.chat.id !== OWNER_ID) return;
  try {
    const out = jedTasks.forTasksCommand();
    bot.sendMessage(msg.chat.id, out, { parse_mode: 'Markdown' })
      .catch(() => bot.sendMessage(msg.chat.id, out.replace(/[*_`]/g, '')));
  } catch (e) {
    bot.sendMessage(msg.chat.id, `❌ /tasks failed: ${e.message.slice(0, 200)}`).catch(() => {});
  }
});

bot.onText(/^\/budget/, async (msg) => {
  if (msg.chat.id !== OWNER_ID) return;
  const result = await executeTool('check_budget', {});
  bot.sendMessage(msg.chat.id, `*Budget:* $${result.month_total_usd} this month — Status: ${result.status}`, { parse_mode: 'Markdown' });
});

bot.onText(/^\/memory/, async (msg) => {
  if (msg.chat.id !== OWNER_ID) return;
  const all = mem.getAll();
  const text = all.map(r => `${r.category}/${r.key}: ${r.value.slice(0, 80)}`).join('\n');
  bot.sendMessage(msg.chat.id, `*Memory:*\n${text || 'Empty'}`, { parse_mode: 'Markdown' });
});

bot.onText(/^\/status/, async (msg) => {
  if (msg.chat.id !== OWNER_ID) return;
  try {
    const pending = tasks.getPending();
    const budgetTotal = budget.getMonthTotal();
    const activeProject = projectQueue.getActive();
    const queuedApps = projectQueue.getByStatus('queued');
    const pendingFeatures = featureRequests.getPending();
    const lastLesson = lessons.getTop(1)[0];
    const uptimeMin = Math.floor(process.uptime() / 60);
    const uptimeStr = uptimeMin >= 60 ? `${Math.floor(uptimeMin/60)}h ${uptimeMin%60}m` : `${uptimeMin}m`;

    // PC relay ping
    let pcStatus = '❓ Unknown';
    try {
      const pcResp = await axios.get(`${process.env.PC_RELAY_URL}/health`, {
        headers: { 'X-Secret': process.env.PC_RELAY_SECRET },
        timeout: 3000
      });
      pcStatus = pcResp.data && pcResp.data.ok ? '✅ Connected' : '⚠️ Unhealthy';
    } catch (pcErr) {
      pcStatus = '❌ Offline';
    }

    // Running PM2 processes
    let procLines = '  (pm2 unavailable)';
    try {
      const procs = JSON.parse(execSync('pm2 jlist', { timeout: 5000 }).toString())
        .filter(p => p.name && p.name.startsWith('solomon'));
      procLines = procs.map(p => {
        const env = p.pm2_env || {};
        const up = env.pm_uptime ? Math.round((Date.now() - env.pm_uptime) / 60000) : 0;
        return `  ${env.status === 'online' ? '✅' : '❌'} ${p.name} (${env.status || '?'}, ${up}m, ↺${env.restart_time != null ? env.restart_time : '?'})`;
      }).join('\n') || '  None';
    } catch (_) {}

    // Email triage stats
    const eGet = (k) => mem.get('email_stats', k) || '0';
    const eLast = mem.get('email_stats', 'last_email_at') || 'never';

    // Recent social posts
    let socialLines = '  None yet';
    try {
      const logs = mem.getCategory('social_log').sort((a, b) => b.key.localeCompare(a.key)).slice(0, 5);
      if (logs.length) socialLines = logs.map(l => {
        let body = ''; try { const j = JSON.parse(l.value); body = `${j.kind || 'post'}: ${(j.fb || []).join(', ')}`.slice(0, 70); } catch (_) { body = '(post)'; }
        return `  • ${l.key.slice(5, 16)} ${body}`;
      }).join('\n');
    } catch (_) {}

    const statusLines = [
      `*Solomon V4 Status*`,
      `✅ Online | 🧠 ${MODEL}`,
      `⏱ Uptime: ${uptimeStr}`,
      ``,
      `*Processes:*`,
      procLines,
      ``,
      `*Email triage:* ${eGet('total')} total — 🚨${eGet('urgent')} / 📧${eGet('normal')} / 📭${eGet('newsletter')}`,
      `  last email: ${eLast.slice(0, 16)}`,
      ``,
      `*Recent social posts:*`,
      socialLines,
      ``,
      `*App Factory:*`,
      `  🔨 Active: ${activeProject ? activeProject.app_name + ' (' + activeProject.phases_complete + '/' + activeProject.phases_total + ')' : 'None'}`,
      `  ⏳ Queued: ${queuedApps.length}`,
      ``,
      `*Tasks & Budget:*`,
      `  📋 Pending tasks: ${pending.length}`,
      `  💰 Month spend: ${budgetTotal.toFixed(2)}`,
      `  🎯 Feature requests: ${pendingFeatures.length} pending`,
      ``,
      `*Systems:*`,
      `  🖥 PC Relay: ${pcStatus}`,
      `  📚 Last lesson: ${lastLesson ? lastLesson.what_worked ? lastLesson.what_worked.slice(0, 60) : lastLesson.project : 'None yet'}`,
    ];

    await sendLongMessage(msg.chat.id, statusLines.join('\n'), { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(msg.chat.id, `❌ Status error: ${err.message.slice(0, 200)}`).catch(() => {});
  }
});

bot.onText(/^\/queue/, async (msg) => {
  if (msg.chat.id !== OWNER_ID) return;
  const { projectQueue } = require('./memory');
  const all = projectQueue.getAll();
  if (!all.length) { bot.sendMessage(msg.chat.id, 'No apps in queue.'); return; }
  const text = all.map(a => `${a.status === 'active' ? '🔨' : a.status === 'complete' ? '✅' : '⏳'} ${a.app_name} [${a.status}] $${a.spent_usd}/$${a.budget_usd}`).join('\n');
  bot.sendMessage(msg.chat.id, `*App Factory Queue:*\n${text}`, { parse_mode: 'Markdown' });
});

bot.onText(/^\/clear/, async (msg) => {
  if (msg.chat.id !== OWNER_ID) return;
  messages.clear();
  bot.sendMessage(msg.chat.id, '🧹 Conversation history cleared.');
});

// /post <content> — rewrite + distribute to all connected social platforms.
bot.onText(/^\/post\b/i, async (msg) => {
  if (msg.chat.id !== OWNER_ID) return;
  const content = (msg.text || '').replace(/^\/post\b/i, '').trim();
  if (!content) { bot.sendMessage(msg.chat.id, 'Usage: /post <content to distribute to all socials>').catch(() => {}); return; }
  await handleCrossPost(content, msg.chat.id);
  executeTool('append_master_context', { section: 'GENERAL', entry: `/post ran — content: "${content.slice(0, 80)}"` }).catch(() => {});
});

// /launch — start the 30-day book & merch launch campaign sequence.
bot.onText(/^\/launch\b/i, async (msg) => {
  if (msg.chat.id !== OWNER_ID) return;
  bot.sendChatAction(msg.chat.id, 'typing').catch(() => {});
  try {
    const r = await executeTool('launch_campaign', {});
    const out = r.ok ? `🚀 ${r.message || 'Campaign launched.'}` : `⚠️ ${r.error}`;
    bot.sendMessage(msg.chat.id, out, { parse_mode: 'Markdown' }).catch(() => bot.sendMessage(msg.chat.id, out.replace(/[*_`]/g, '')));
    if (r.ok) executeTool('append_master_context', { section: 'GENERAL', entry: '/launch ran — ' + (r.message || 'campaign armed') }).catch(() => {});
  } catch (e) {
    bot.sendMessage(msg.chat.id, `❌ Launch error: ${e.message.slice(0, 150)}`).catch(() => {});
  }
});

// /brief — send the full PERMANENT master context (shultz_master_context.md), the
// authoritative paste-into-Claude brief for Nathan. Plain text, chunked if long.
bot.onText(/^\/brief\b/i, async (msg) => {
  if (msg.chat.id !== OWNER_ID) return;
  bot.sendChatAction(msg.chat.id, 'typing').catch(() => {});
  try {
    let content = '';
    try { content = fs.readFileSync(path.join(__dirname, 'shultz_master_context.md'), 'utf8'); } catch (_) {}
    if (!content.trim()) {
      await bot.sendMessage(msg.chat.id, '⚠️ shultz_master_context.md is missing — that file is the master source of truth.').catch(() => {});
      return;
    }
    const today = new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const header = `NATHAN CONTEXT BRIEF — CURRENT AS OF ${today}\n(Authoritative. Paste this whole message into a new Claude chat to brief Nathan with zero context loss.)\n\n`;
    await sendLongMessage(msg.chat.id, header + content, {});
  } catch (e) {
    bot.sendMessage(msg.chat.id, `❌ Brief error: ${e.message.slice(0, 150)}`).catch(() => {});
  }
});

// /setfbtoken <page> <token> — Jed pastes a freshly-regenerated long-lived Facebook
// page token from developers.facebook.com/tools/explorer. Solomon validates it
// (Graph API /me + page-ID match), updates .env, and triggers a PM2 restart of
// solomon-v4 to pick up the new value. The token is REDACTED from logs.
bot.onText(/^\/setfbtoken\b/i, async (msg) => {
  if (msg.chat.id !== OWNER_ID) return;
  const parts = (msg.text || '').trim().split(/\s+/);
  if (parts.length < 3) {
    bot.sendMessage(msg.chat.id, 'Usage: /setfbtoken <building_shultz|irish_craftsman> <long-lived-token>').catch(() => {});
    return;
  }
  const pageKey = String(parts[1]).toLowerCase();
  const token = parts.slice(2).join(' ').trim();
  const pageIds = { building_shultz: process.env.FB_BUILDING_SHULTZ_ID, irish_craftsman: process.env.FB_IRISH_CRAFTSMAN_ID };
  if (!pageIds[pageKey]) {
    bot.sendMessage(msg.chat.id, '❌ Unknown page. Use `building_shultz` or `irish_craftsman`.', { parse_mode: 'Markdown' }).catch(() => {});
    return;
  }
  if (token.length < 30) {
    bot.sendMessage(msg.chat.id, '❌ Token looks too short — paste the full long-lived token.').catch(() => {});
    return;
  }
  bot.sendChatAction(msg.chat.id, 'typing').catch(() => {});
  try {
    // Validate the token against Graph API and check it belongs to the EXPECTED page id.
    const r = await axios.get('https://graph.facebook.com/v19.0/me', {
      params: { access_token: token, fields: 'id,name' }, timeout: 12000
    });
    const tokId = String(r.data && r.data.id || '');
    const tokName = (r.data && r.data.name) || '';
    if (tokId !== String(pageIds[pageKey])) {
      await bot.sendMessage(msg.chat.id, `❌ Token belongs to page "${tokName}" (id ${tokId}), not the *${pageKey}* page (expected id ${pageIds[pageKey]}). Not saved.`, { parse_mode: 'Markdown' }).catch(() => {});
      return;
    }
    // Write into .env (replace existing line or append). Preserve everything else.
    const envPath = path.join(__dirname, '.env');
    const envKey = pageKey === 'building_shultz' ? 'FB_BUILDING_SHULTZ_TOKEN' : 'FB_IRISH_CRAFTSMAN_TOKEN';
    let envContent = fs.readFileSync(envPath, 'utf8');
    const re = new RegExp('^' + envKey + '=.*$', 'm');
    envContent = re.test(envContent) ? envContent.replace(re, envKey + '=' + token) : (envContent.replace(/\s*$/, '') + '\n' + envKey + '=' + token + '\n');
    fs.writeFileSync(envPath, envContent, 'utf8');
    process.env[envKey] = token; // keep current process in sync until restart
    const masked = token.slice(0, 8) + '…' + token.slice(-4);
    await bot.sendMessage(msg.chat.id, `✅ *${pageKey}* token saved (validated as "${tokName}", id ${tokId}; masked: \`${masked}\`).\nRestarting solomon-v4 to activate…`, { parse_mode: 'Markdown' })
      .catch(() => bot.sendMessage(msg.chat.id, `✅ ${pageKey} token saved (validated). Restarting solomon-v4...`));
    try { await executeTool('append_master_context', { section: 'STACK', entry: `FB token refreshed for ${pageKey} (${tokName})` }); } catch (_) {}
    // Restart after a short delay so the confirmation reply lands first.
    setTimeout(() => {
      try { require('child_process').spawn('pm2', ['restart', 'solomon-v4'], { detached: true, stdio: 'ignore' }).unref(); } catch (_) {}
    }, 1500);
  } catch (e) {
    const m = (e.response && e.response.data && e.response.data.error && e.response.data.error.message) || e.message;
    bot.sendMessage(msg.chat.id, `❌ Token validation failed: ${String(m).slice(0, 200)}`).catch(() => {});
  }
});

// /dispatch <message> — run a Telegram message through the new dispatch engine
// (opt-in for safety). Defaults to shadow mode = classify+route+nathan-consult
// but DO NOT actually fire handlers — log what would have happened to
// dispatch-shadow-log.json. Flip with: /dispatch mode live  (and back with shadow).
bot.onText(/^\/dispatch\b\s*(.*)$/i, async (msg, match) => {
  if (msg.chat.id !== OWNER_ID) return;
  const arg = (match && match[1] || '').trim();
  // mode flip subcommand
  const modeMatch = arg.match(/^mode\s+(shadow|live)$/i);
  if (modeMatch) {
    const m = modeMatch[1].toLowerCase();
    mem.set('dispatch', 'mode', m);
    bot.sendMessage(msg.chat.id, `🔀 Dispatch mode set to *${m}*. ${m === 'live' ? 'Auto-dispatch *ON* — every non-slash message is now routed through the classifier automatically (Caleb/Sam tasks fire, solomon actions execute, anything uncertain falls back to normal chat).' : 'Auto-dispatch *OFF* — messages handled normally (revert). Use `/dispatch <msg>` to test a single message.'}`, { parse_mode: 'Markdown' }).catch(() => {});
    return;
  }
  if (!arg) {
    bot.sendMessage(msg.chat.id, 'Usage: `/dispatch <message you would send>`\nOr: `/dispatch mode shadow|live`\nCurrent mode: ' + (mem.get('dispatch', 'mode') || (process.env.DISPATCH_MODE === 'live' ? 'live' : 'shadow')), { parse_mode: 'Markdown' }).catch(() => {});
    return;
  }
  bot.sendChatAction(msg.chat.id, 'typing').catch(() => {});
  let dispatch;
  try { dispatch = require('./dispatch'); }
  catch (e) {
    bot.sendMessage(msg.chat.id, `❌ Dispatch engine not loadable: ${e.message}`).catch(() => {});
    return;
  }
  try {
    const result = await dispatch.classifyAndRoute(arg, { mem });
    const tpl = result.template?.id || '(no template)';
    const reply = [
      `🧭 *Dispatch result*  _(${result.mode})_`,
      `Template: \`${tpl}\``,
      `Confidence: ${result.confidence?.toFixed(2) ?? '?'}`,
      `Decision: *${result.decision}*`,
      `Reason: ${result.reason}`,
      result.nathan_consult ? `\nNathan: *${result.nathan_consult.recommendation}* (agreement ${result.nathan_consult.agreement?.toFixed?.(2) ?? '?'})` : '',
      result.nathan_consult?.concerns?.length ? `Concerns: ${result.nathan_consult.concerns.join(' · ')}` : '',
      result.action_result ? `\nAction: \`${result.action_result.kind || result.action_result.mode}\`` : ''
    ].filter(Boolean).join('\n');
    await bot.sendMessage(msg.chat.id, reply, { parse_mode: 'Markdown' })
      .catch(() => bot.sendMessage(msg.chat.id, reply.replace(/[*_`]/g, '')));
  } catch (e) {
    log('ERROR', 'DISPATCH', 'dispatch failed', { error: e.message });
    bot.sendMessage(msg.chat.id, `❌ Dispatch failed: ${e.message.slice(0, 300)}`).catch(() => {});
  }
});

// /generate <prompt> — generate an image via Black Forest Labs Flux and reply with it.
bot.onText(/^\/generate\b\s*(.*)$/i, async (msg, match) => {
  if (msg.chat.id !== OWNER_ID) return;
  const prompt = (match && match[1] || '').trim();
  if (!prompt) {
    bot.sendMessage(msg.chat.id, 'Usage: `/generate <prompt>`\nExample: `/generate weathered leather book cover, "Motivation for Tough Guys" gold foil title, cinematic lighting`', { parse_mode: 'Markdown' }).catch(() => {});
    return;
  }
  const apiKey = process.env.BFL_API_KEY;
  if (!apiKey || apiKey === 'PLACEHOLDER') {
    bot.sendMessage(msg.chat.id, '❌ BFL_API_KEY missing in .env.').catch(() => {});
    return;
  }
  log('INFO', 'GENERATE', `prompt: ${prompt.slice(0, 120)}`);
  bot.sendChatAction(msg.chat.id, 'upload_photo').catch(() => {});
  const baseUrl = process.env.BFL_API_URL || 'https://api.bfl.ai';
  const endpoint = process.env.BFL_MODEL_ENDPOINT || '/v1/flux-pro-1.1';
  try {
    const submitResp = await axios.post(`${baseUrl}${endpoint}`, {
      prompt,
      width: 1024,
      height: 1024,
      prompt_upsampling: false,
      safety_tolerance: 2,
      output_format: 'jpeg'
    }, {
      headers: { 'x-key': apiKey, 'Content-Type': 'application/json' },
      timeout: 20000
    });
    const jobId = submitResp.data?.id;
    const pollingUrl = submitResp.data?.polling_url || `${baseUrl}/v1/get_result?id=${jobId}`;
    if (!jobId) throw new Error('BFL did not return a job id');
    log('INFO', 'GENERATE', `job submitted: ${jobId}`);

    let imageUrl = null;
    const maxAttempts = 30; // ~60s total at 2s interval
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const pollResp = await axios.get(pollingUrl, {
        headers: { 'x-key': apiKey, accept: 'application/json' },
        timeout: 15000
      });
      const status = pollResp.data?.status;
      if (status === 'Ready') {
        imageUrl = pollResp.data?.result?.sample;
        break;
      }
      if (status === 'Error' || status === 'Content Moderated' || status === 'Request Moderated') {
        throw new Error(`BFL ${status}: ${JSON.stringify(pollResp.data?.result || {}).slice(0, 200)}`);
      }
      if (status === 'Task not found') throw new Error('BFL: task not found');
      // else Pending / Queued → continue polling
    }
    if (!imageUrl) throw new Error('Generation timed out after 60s');

    log('INFO', 'GENERATE', `image ready, sending to Telegram`);
    await bot.sendPhoto(msg.chat.id, imageUrl, {
      caption: `🎨 ${prompt.slice(0, 900)}`
    });
    activityLogger.logActivity('image_generated', { summary: prompt.slice(0, 100) });
  } catch (err) {
    const detail = err.response?.data?.detail || err.response?.data || err.message;
    log('ERROR', 'GENERATE', 'Image generation failed', { error: String(detail).slice(0, 200) });
    bot.sendMessage(msg.chat.id, `❌ Image generation failed: ${String(detail).slice(0, 300)}`).catch(() => {});
  }
});

// /stats — today's message + tool-call volume, MTD budget, cache hit rate.
// Reads activity_log for the rolling 24h window. Scorecard-style, scannable.
bot.onText(/^\/stats/i, async (msg) => {
  if (msg.chat.id !== OWNER_ID) return;
  try {
    const today = new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' });
    // Activity counts last 24h
    const rows = db.prepare("SELECT type, COUNT(*) AS n FROM activity_log WHERE timestamp >= datetime('now', '-24 hours') GROUP BY type").all();
    const c = (t) => (rows.find(r => r.type === t) || { n: 0 }).n;
    const msgsRecv = c('message_received');
    const msgsSent = c('message_sent');
    const toolCalls = c('tool_call');
    const errs = c('error');
    // Budget
    const monthSpend = budget.getMonthTotal();
    const hardStop = parseFloat(process.env.MONTHLY_BUDGET_HARD_STOP || '100');
    const pct = Math.min(100, Math.round((monthSpend / hardStop) * 100));
    const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
    const warn = pct >= 80 ? '  ⚠️' : '';
    // Cache stats (this process lifetime)
    const cacheTotal = _replyCacheHits + _replyCacheMisses;
    const hitRate = cacheTotal ? Math.round((_replyCacheHits / cacheTotal) * 100) : 0;
    const lines = [
      `📊 *Solomon stats — ${today}*`,
      '',
      `💬 Messages (24h): *${msgsRecv}* received · ${msgsSent} sent`,
      `🛠️ Tool calls (24h): *${toolCalls}*${errs ? `  ⚠️ ${errs} errors` : ''}`,
      `💵 Budget: $${monthSpend.toFixed(2)} / $${hardStop.toFixed(0)} (${pct}%) ${bar}${warn}`,
      `⚡ Reply cache: ${_replyCacheHits} hit / ${_replyCacheMisses} miss (${hitRate}%) · ${_replyCache.size} entries`
    ];
    const out = lines.join('\n');
    await bot.sendMessage(msg.chat.id, out, { parse_mode: 'Markdown' })
      .catch(() => bot.sendMessage(msg.chat.id, out.replace(/[*_`]/g, '')));
  } catch (e) {
    log('ERROR', 'STATS', 'stats failed', { error: e.message });
    bot.sendMessage(msg.chat.id, `❌ /stats failed: ${e.message.slice(0, 200)}`).catch(() => {});
  }
});

// /help — list available commands.
bot.onText(/^\/help\b/i, async (msg) => {
  if (msg.chat.id !== OWNER_ID) return;
  const help = [
    '*Solomon commands*',
    '/status — processes, uptime, recent posts, email triage stats',
    '/stats — 24h message / tool / budget / cache scorecard',
    '/post <content> — rewrite + distribute to all socials',
    '/launch — start the 30-day book & merch campaign',
    '/brief — send the morning brief now',
    '/generate <prompt> — generate an image (Flux 1.1 via BFL) and reply with it',
    '/dispatch <message> — run one message through the dispatch engine (test). Flip auto-routing of ALL messages with /dispatch mode live (on) / shadow (off, default)',
    '/setfbtoken <page> <token> — paste a freshly-regenerated FB page token; Solomon validates + restarts',
    '/help — this list',
    '',
    '_Also:_ /tasks  /budget  /memory  /queue  /clear',
    '',
    'Or just talk to me, or say "post this to all socials" with your content.'
  ].join('\n');
  bot.sendMessage(msg.chat.id, help, { parse_mode: 'Markdown' }).catch(() => bot.sendMessage(msg.chat.id, help.replace(/[*_`]/g, '')));
});

// ── TELEGRAM DOCUMENT HANDLER (Phase 8) ─────────────────────────────────
// Handles incoming file messages — downloads and saves to PC via relay
bot.on('document', async (msg) => {
  if (msg.chat.id !== OWNER_ID) return;
  const doc = msg.document;
  const caption = msg.caption || '';
  log('INFO', 'FILE', `Received file: ${doc.file_name} (${doc.file_size} bytes)`);
  try {
    bot.sendChatAction(msg.chat.id, 'typing').catch(() => {});
    let savePath;
    if (caption && caption.includes(':\\')) {
      savePath = caption.trim();
    } else {
      savePath = `D:\\Projects\\__inbox\\${doc.file_name}`;
    }
    const result = await executeTool('receive_telegram_file', {
      file_id: doc.file_id,
      save_path: savePath
    });
    if (result.ok) {
      await bot.sendMessage(msg.chat.id, `📁 File saved: ${doc.file_name}\nPath: ${savePath}\nSize: ${result.size_bytes} bytes`);
    } else {
      await bot.sendMessage(msg.chat.id, `❌ Failed to save file: ${result.error}`);
    }
  } catch (err) {
    log('ERROR', 'FILE', 'Document handler error', { error: err.message });
    bot.sendMessage(msg.chat.id, `❌ File handling error: ${err.message.slice(0, 200)}`).catch(() => {});
  }
});

// ── EXPRESS APP (Inject + OAuth) ─────────────────────────────────────────
const app = express();
app.use(express.json());

// Inject endpoint (for Nathan / Manus AI)
app.post('/inject', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'No text provided' });
  log('INFO', 'INJECT', text.slice(0, 100));
  try {
    const reply = await askSolomon(text);
    await bot.sendMessage(OWNER_ID, reply);
    res.json({ ok: true, reply });
  } catch (err) {
    log('ERROR', 'INJECT', 'Inject error', { error: err.message });
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ ok: true, version: '4.0.0', model: MODEL, uptime: process.uptime() });
});

// ── COWORK CONFLICT DETECTION ────────────────────────────────────────────
// Cowork (desktop agent) POSTs busy=true when it starts a PC task and
// busy=false when it finishes. Solomon queues all pc_* tool calls while
// Cowork is busy and drains the queue every minute (scheduler ITEM 20).
// Auth: X-Secret header must equal PC_RELAY_SECRET (same shared secret).
app.post('/cowork/busy', async (req, res) => {
  if (req.get('X-Secret') !== process.env.PC_RELAY_SECRET) return res.status(401).json({ error: 'unauthorized' });
  const { busy, eta_seconds, note } = req.body || {};
  if (busy) {
    const eta = Math.max(10, Math.min(parseInt(eta_seconds, 10) || 300, 7200)); // 10s..2h cap
    const until = new Date(Date.now() + eta * 1000).toISOString();
    mem.set('pc_lock', 'cowork_busy_until', until);
    mem.set('pc_lock', 'cowork_busy_note', String(note || ''));
    log('INFO', 'COWORK', 'Cowork busy', { until, note });
    return res.json({ ok: true, busy_until: until });
  } else {
    try { mem.delete('pc_lock', 'cowork_busy_until'); } catch (_) {}
    try { mem.delete('pc_lock', 'cowork_busy_note'); } catch (_) {}
    log('INFO', 'COWORK', 'Cowork idle');
    return res.json({ ok: true, busy: false });
  }
});
app.get('/cowork/status', (req, res) => {
  const until = mem.get('pc_lock', 'cowork_busy_until');
  const note = mem.get('pc_lock', 'cowork_busy_note') || '';
  const busy = !!(until && new Date(until).getTime() > Date.now());
  const queueSize = mem.getCategory('pc_queue').length;
  res.json({ busy, busy_until: until, note, pc_queue: queueSize });
});

// ── API ENDPOINTS (Phase 8B) ─────────────────────────────────────────────
app.get('/api/nathan-inbox', (req, res) => {
  try {
    const rows = nathanInbox.getUnread();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/feature-requests', (req, res) => {
  try {
    const rows = featureRequests.getPending();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/status', (req, res) => {
  try {
    const activeProject = projectQueue.getActive();
    const queuedApps = projectQueue.getByStatus('queued');
    const pendingFeatures = featureRequests.getPending();
    const nathanUnread = nathanInbox.getUnread();
    const budgetTotal = budget.getMonthTotal();
    const pendingTasks = tasks.getPending();
    res.json({
      ok: true,
      uptime_seconds: Math.floor(process.uptime()),
      model: MODEL,
      active_project: activeProject ? {
        name: activeProject.app_name,
        type: activeProject.app_type,
        phases_complete: activeProject.phases_complete,
        phases_total: activeProject.phases_total,
        spent_usd: activeProject.spent_usd,
        budget_usd: activeProject.budget_usd
      } : null,
      queue_count: queuedApps.length,
      pending_tasks: pendingTasks.length,
      feature_requests_pending: pendingFeatures.length,
      nathan_inbox_unread: nathanUnread.length,
      budget_month_usd: parseFloat(budgetTotal.toFixed(4))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// ITEM 33 — YOUTUBE OAUTH FLOW (Desktop App / localhost redirect method)
// Flow: Jed visits /oauth/start → clicks Google auth link → Google redirects to
// http://localhost?code=XXX (fails to load, but code is visible in URL bar) →
// Jed copies the code → pastes it into the form on /oauth/start → submits to
// /oauth/exchange → Solomon exchanges code for tokens, saves refresh token.
// ══════════════════════════════════════════════════════════════════════════
app.get('/oauth/start', (req, res) => {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  if (!clientId || clientId === 'PLACEHOLDER') {
    return res.status(500).send('YOUTUBE_CLIENT_ID not configured in .env');
  }
  // Desktop app type: Google allows http://localhost as redirect URI
  const redirectUri = 'http://localhost';
  const scopes = [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/gmail.send'
  ].join(' ');

  // prompt=select_account+consent forces Google to show BOTH the account picker
  // AND the consent screen — required so Jed can switch from his personal channel
  // to the Building Shultz brand channel during reauth.
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&access_type=offline` +
    `&include_granted_scopes=true` +
    `&prompt=${encodeURIComponent('select_account consent')}`;

  console.log('[OAUTH] Serving desktop auth page...');
  res.send(`<!DOCTYPE html>
<html>
<head><title>Solomon YouTube Auth</title>
<style>
  body{font-family:sans-serif;max-width:640px;margin:50px auto;padding:20px;color:#222;}
  h1{color:#cc0000;}
  .step{background:#f8f8f8;border-left:4px solid #cc0000;padding:12px 16px;margin:16px 0;border-radius:0 6px 6px 0;}
  .step strong{display:block;margin-bottom:4px;}
  a.btn{display:inline-block;background:#cc0000;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:15px;margin:8px 0;}
  a.btn:hover{background:#990000;}
  input[type=text]{width:100%;padding:10px;font-size:14px;border:2px solid #ccc;border-radius:6px;box-sizing:border-box;margin:8px 0;}
  button[type=submit]{background:#1a73e8;color:white;padding:10px 24px;border:none;border-radius:6px;font-size:15px;font-weight:bold;cursor:pointer;}
  button[type=submit]:hover{background:#1558b0;}
  code{background:#eee;padding:2px 6px;border-radius:4px;font-size:13px;}
  .warn{color:#b00;font-size:13px;}
</style>
</head>
<body>
<h1>&#x1F4F9; Solomon YouTube Authorization</h1>
<p>Authorize Solomon to post to the <strong>Building Shultz</strong> YouTube channel.</p>

<div class="step" style="border-left-color:#1a73e8;background:#e8f0fe;">
  <strong>&#x26A0;&#xFE0F; READ THIS FIRST — Pick the BRAND channel, not the personal one:</strong>
  After you click the button below, Google will show you an account picker. Choose the Google account that owns <strong>Building Shultz</strong> (~1,450 subs). If Google then asks <em>"Which channel?"</em>, pick <strong>Building Shultz</strong>, NOT <em>Jedidiah Shultz</em>. Wrong pick = Solomon posts to the wrong channel.
</div>

<div class="step">
  <strong>Step 1 — Click to authorize on Google:</strong>
  <a class="btn" href="${authUrl}" target="_blank">&#x1F517; Open Google Authorization</a>
  <p class="warn">&#x26A0;&#xFE0F; After clicking Allow, your browser will try to load <code>http://localhost</code> and show a connection error. That's expected.</p>
</div>

<div class="step">
  <strong>Step 2 — Copy the code from your browser's URL bar:</strong>
  <p>The URL will look like: <code>http://localhost/?code=<strong>4/0AXXXXXXXXXX...</strong>&scope=...</code><br>
  Copy everything after <code>code=</code> and before <code>&scope</code> (or to the end if no &amp;).</p>
</div>

<div class="step">
  <strong>Step 3 — Paste the code here and submit:</strong>
  <form action="/oauth/exchange" method="POST">
    <input type="text" name="code" placeholder="Paste your authorization code here..." required />
    <br>
    <button type="submit">&#x2705; Exchange Code &amp; Authorize Solomon</button>
  </form>
</div>
</body></html>`);
});

// POST /oauth/exchange — receives the pasted code, exchanges for tokens
app.post('/oauth/exchange', express.urlencoded({ extended: false }), async (req, res) => {
  const { code } = req.body;
  if (!code || !code.trim()) {
    return res.status(400).send('<h2>Error: No code provided. Go back and paste the code.</h2>');
  }
  console.log('[OAUTH] Exchanging code for tokens...');
  try {
    const tokenResp = await axios.post('https://oauth2.googleapis.com/token', {
      code: code.trim(),
      client_id: process.env.YOUTUBE_CLIENT_ID,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET,
      redirect_uri: 'http://localhost',
      grant_type: 'authorization_code'
    });
    const { refresh_token, access_token, expires_in } = tokenResp.data;
    console.log('[OAUTH] Token exchange successful!');
    if (refresh_token) {
      const envPath = path.join(__dirname, '.env');
      let envContent = fs.readFileSync(envPath, 'utf8');
      envContent = envContent.replace(/YOUTUBE_REFRESH_TOKEN=.*/, `YOUTUBE_REFRESH_TOKEN=${refresh_token}`);
      fs.writeFileSync(envPath, envContent);
      process.env.YOUTUBE_REFRESH_TOKEN = refresh_token;
      console.log('[OAUTH] Refresh token saved to .env');

      // Verify which channel was actually connected and surface it to Jed so he
      // immediately knows if he picked the wrong one (personal vs Building Shultz).
      let channelInfo = { title: '(could not fetch)', subs: '?', id: '?' };
      try {
        const chResp = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
          params: { part: 'snippet,statistics', mine: true },
          headers: { Authorization: `Bearer ${access_token}` },
          timeout: 10000
        });
        const ch = chResp.data?.items?.[0];
        if (ch) {
          channelInfo = {
            title: ch.snippet?.title || '(no title)',
            subs: ch.statistics?.subscriberCount || '?',
            id: ch.id || '?'
          };
        }
      } catch (chErr) {
        console.error('[OAUTH] channel verify failed:', chErr.message);
      }
      const isBrand = /building\s*shultz/i.test(channelInfo.title);
      const tgMsg = isBrand
        ? `\u2705 YouTube OAuth authorized to the *${channelInfo.title}* channel (${channelInfo.subs} subs). Refresh token saved. Video uploads + community posts enabled.`
        : `\u26a0\ufe0f YouTube OAuth saved BUT connected to *${channelInfo.title}* (${channelInfo.subs} subs) \u2014 this looks like the wrong channel. Re-run the auth flow and pick the Building Shultz brand channel during the picker step. URL: http://167.99.237.26:3000/oauth/start`;
      bot.sendMessage(OWNER_ID, tgMsg, { parse_mode: 'Markdown' }).catch(() => {});
      const banner = isBrand
        ? `<h1 style="color:green;">&#x2705; Authorized to ${channelInfo.title}</h1><p>${channelInfo.subs} subscribers. Refresh token saved. You can close this window.</p>`
        : `<h1 style="color:#b00;">&#x26A0;&#xFE0F; Wrong channel connected</h1><p>You connected <strong>${channelInfo.title}</strong> (${channelInfo.subs} subs). This is not the Building Shultz brand channel.</p><p><a href="/oauth/start">&#x2190; Try again</a> and pick Building Shultz during the channel picker step.</p>`;
      res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:560px;margin:60px auto;padding:20px;">${banner}</body></html>`);
    } else {
      res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:500px;margin:60px auto;padding:20px;">
        <h2>&#x26A0;&#xFE0F; No refresh token returned.</h2>
        <p>This can happen if the account was already authorized before. Try revoking access at <a href="https://myaccount.google.com/permissions">Google Account Permissions</a> and then re-authorizing.</p>
      </body></html>`);
    }
  } catch (err) {
    const errDetail = err.response?.data?.error_description || err.response?.data?.error || err.message;
    console.error('[OAUTH] Token exchange failed:', errDetail);
    res.status(500).send(`<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:500px;margin:60px auto;padding:20px;">
      <h2 style="color:red;">&#x274C; Token exchange failed</h2>
      <p><strong>Error:</strong> ${errDetail}</p>
      <p><a href="/oauth/start">&#x2190; Try again</a></p>
    </body></html>`);
  }
});

// Keep GET /oauth/callback as fallback (in case user tries the old URL)
app.get('/oauth/callback', (req, res) => {
  const { code } = req.query;
  if (code) {
    res.redirect(`/oauth/start?prefill=${encodeURIComponent(code)}`);
  } else {
    res.redirect('/oauth/start');
  }
});

// ── GUMROAD WEBHOOK ──────────────────────────────────────────────────────
// Gumroad's "Ping" webhook POSTs application/x-www-form-urlencoded on each sale.
// No HMAC signature on free-tier Ping — we gate access via a secret in the URL
// path so only Gumroad (with the right URL) can fire celebrations. Set the URL
// at https://app.gumroad.com/settings/advanced under "Ping".
const _gumroadSeenSales = new Set(); // dedup retried pings within a single bot lifetime
app.post('/webhooks/gumroad/:secret', express.urlencoded({ extended: true }), async (req, res) => {
  const expected = process.env.GUMROAD_WEBHOOK_SECRET;
  if (!expected || expected === 'PLACEHOLDER') {
    log('WARN', 'GUMROAD', 'Webhook hit but GUMROAD_WEBHOOK_SECRET not configured');
    return res.status(503).send('webhook not configured');
  }
  if (req.params.secret !== expected) {
    log('WARN', 'GUMROAD', 'Bad secret', { ip: req.ip });
    return res.status(403).send('forbidden');
  }
  const b = req.body || {};
  const saleId = b.sale_id || b.id || `${b.product_id || ''}-${b.sale_timestamp || Date.now()}`;
  if (_gumroadSeenSales.has(saleId)) {
    return res.status(200).send('duplicate ignored');
  }
  _gumroadSeenSales.add(saleId);
  if (_gumroadSeenSales.size > 500) {
    const keep = [..._gumroadSeenSales].slice(-250);
    _gumroadSeenSales.clear();
    keep.forEach(k => _gumroadSeenSales.add(k));
  }
  // Gumroad price is in cents (string) per their docs.
  const priceCents = parseInt(b.price || '0', 10);
  const currency = (b.currency || 'usd').toUpperCase();
  const amount = isNaN(priceCents) ? b.price : (priceCents / 100).toFixed(2);
  const product = b.product_name || b.permalink || '(unnamed product)';
  const buyer = b.full_name || b.email || '(buyer)';
  const quantity = b.quantity || '1';
  const refunded = b.refunded === 'true' || b.refunded === true;
  const test = b.test === 'true' || b.test === true;
  const header = refunded ? '↩️ *Refund processed*' : (test ? '🧪 *Test sale*' : '🎉 *NEW SALE!* 💰');
  const message = `${header}\n\n*Product:* ${product}\n*Amount:* ${currency} $${amount}${quantity !== '1' ? ` × ${quantity}` : ''}\n*Buyer:* ${buyer}`;
  bot.sendMessage(OWNER_ID, message, { parse_mode: 'Markdown' })
    .catch(() => bot.sendMessage(OWNER_ID, message.replace(/[*_`]/g, '')));
  log('INFO', 'GUMROAD', 'Sale celebrated', { product, amount, currency, test, refunded });
  activityLogger.logActivity('gumroad_sale', { summary: `${product} ${currency} $${amount}` });
  res.status(200).send('ok');
});

// ── LISTEN ───────────────────────────────────────────────────────────────
app.listen(parseInt(process.env.PORT || '3000'), '0.0.0.0', () => {
  log('INFO', 'SYSTEM', `Inject endpoint listening on port ${process.env.PORT || 3000}`);
  log('INFO', 'SYSTEM', 'OAuth: visit http://167.99.237.26:3000/oauth/start to authorize YouTube');
  if (process.env.GUMROAD_WEBHOOK_SECRET && process.env.GUMROAD_WEBHOOK_SECRET !== 'PLACEHOLDER') {
    log('INFO', 'SYSTEM', 'Gumroad webhook ready at /webhooks/gumroad/<secret>');
  }
});

// ── STARTUP MESSAGE ──────────────────────────────────────────────────────
setTimeout(() => {
  bot.sendMessage(OWNER_ID, '🔥 Solomon V4 online. Ready for commands.')
    .then(() => log('INFO', 'SYSTEM', 'Startup message sent to Jed'))
    .catch(err => log('ERROR', 'SYSTEM', 'Startup msg error', { error: err.message }));
}, 2000);

log('INFO', 'SYSTEM', 'Running. Waiting for messages...');
