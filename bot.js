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
const { messages, tasks, mem, budget } = require('./memory');
const { TOOL_DEFINITIONS, executeTool } = require('./tools');

// ══ STRUCTURED LOGGING (Item 36) ═════════════════════════════════════════
const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function getLogFile() {
  const d = new Date();
  const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return path.join(LOG_DIR, `solomon-${ds}.log`);
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

// Rotate logs older than 7 days (runs every 6h)
function rotateLogs() {
  try {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    fs.readdirSync(LOG_DIR).filter(f => f.startsWith('solomon-') && f.endsWith('.log')).forEach(f => {
      const fp = path.join(LOG_DIR, f);
      if (fs.statSync(fp).mtimeMs < cutoff) { fs.unlinkSync(fp); log('INFO', 'SYSTEM', `Rotated old log: ${f}`); }
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
- ALWAYS remember important new info Jed tells you using the remember tool.
- MAX 3 retries on any failing task. After 3 fails: log it, tell Jed, move on.

FULL AUTONOMY GRANTED: Post to Facebook, queue tasks, manage files, run PC commands.
ALWAYS ASK FIRST: Purchases over $50, permanent file deletion, account changes.`;
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

// ── CORE LLM CALL ────────────────────────────────────────────────────────
async function askSolomon(userMessage) {
  // 1. Budget check first
  await checkBudget();

  // 2. Add user message to history
  messages.add('user', userMessage);

  // 3. Build conversation from DB (last 20 messages)
  const history = messages.getLast(20);

  // 4. Call Claude with tools
  let response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: buildSystemPrompt(),
    tools: TOOL_DEFINITIONS,
    messages: history
  });

  // 5. Log tokens to budget
  budget.log({
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    model: MODEL
  });

  // 6. Tool loop — max 8 iterations to prevent infinite loops
  let iterations = 0;
  while (response.stop_reason === 'tool_use' && iterations < 8) {
    iterations++;
    const toolUses = response.content.filter(b => b.type === 'tool_use');
    const toolResults = [];

    for (const tu of toolUses) {
      const result = await executeTool(tu.name, tu.input);
      log('INFO', 'TOOL', `${tu.name} result`, { result: JSON.stringify(result).slice(0,200) });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result)
      });
    }

    // Add assistant response and tool results to history
    const assistantMsg = { role: 'assistant', content: response.content };
    const toolResultMsg = { role: 'user', content: toolResults };

    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: buildSystemPrompt(),
      tools: TOOL_DEFINITIONS,
      messages: [...history, assistantMsg, toolResultMsg]
    });

    budget.log({
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      model: MODEL
    });
  }

  // 7. Extract final text response
  const textBlock = response.content.find(b => b.type === 'text');
  const finalText = textBlock ? textBlock.text : '(Task queued — will report back when done)';

  // 8. Save assistant response to history
  messages.add('assistant', finalText);

  return finalText;
}

// ── TELEGRAM MESSAGE HANDLER ─────────────────────────────────────────────
bot.on('message', async (msg) => {
  // Only respond to Jed
  if (msg.chat.id !== OWNER_ID) {
    bot.sendMessage(msg.chat.id, 'This is a private assistant. Unauthorized access logged.');
    return;
  }

  const text = msg.text || msg.caption || '';
  if (!text) return;

  log('INFO', 'MSG', `Jed: ${text.slice(0, 100)}`);

  // Show typing indicator
  bot.sendChatAction(msg.chat.id, 'typing').catch(() => {});

  try {
    const reply = await askSolomon(text);

    // Telegram max message length is 4096
    if (reply.length > 4000) {
      for (let i = 0; i < reply.length; i += 4000) {
        await bot.sendMessage(msg.chat.id, reply.slice(i, i + 4000), { parse_mode: 'Markdown' });
      }
    } else {
      await bot.sendMessage(msg.chat.id, reply, { parse_mode: 'Markdown' });
    }
  } catch (err) {
    log('ERROR', 'MSG', 'Message handler error', { error: err.message });
    const errorMsg = err.message.includes('budget')
      ? `🛑 Monthly budget limit reached. Use /budget to check.`
      : `❌ Error: ${err.message.slice(0, 200)}`;
    bot.sendMessage(msg.chat.id, errorMsg).catch(() => {});
  }
});

// ── COMMANDS ─────────────────────────────────────────────────────────────
bot.onText(/^\/tasks/, async (msg) => {
  if (msg.chat.id !== OWNER_ID) return;
  const all = tasks.getAll();
  if (!all.length) { bot.sendMessage(msg.chat.id, 'No tasks yet.'); return; }
  const text = all.map(t => `#${t.id} [${t.status}] ${t.title}`).join('\n');
  bot.sendMessage(msg.chat.id, `*Task Queue:*\n${text}`, { parse_mode: 'Markdown' });
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
  const pending = tasks.getPending();
  const budgetTotal = budget.getMonthTotal();
  bot.sendMessage(msg.chat.id,
    `*Solomon V4 Status*\n✅ Online\n🧠 Model: ${MODEL}\n📋 Tasks pending: ${pending.length}\n💰 Month spend: $${budgetTotal.toFixed(4)}\n⏱ Uptime: ${Math.floor(process.uptime() / 60)}m`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/^\/clear/, async (msg) => {
  if (msg.chat.id !== OWNER_ID) return;
  messages.clear();
  bot.sendMessage(msg.chat.id, '🧹 Conversation history cleared.');
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

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&access_type=offline` +
    `&prompt=consent`;

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
<p>Follow these steps to authorize Solomon to upload videos to your YouTube channel.</p>

<div class="step">
  <strong>Step 1 — Click the link below to authorize on Google:</strong>
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
    const { refresh_token, expires_in } = tokenResp.data;
    console.log('[OAUTH] Token exchange successful!');
    if (refresh_token) {
      const envPath = path.join(__dirname, '.env');
      let envContent = fs.readFileSync(envPath, 'utf8');
      envContent = envContent.replace(/YOUTUBE_REFRESH_TOKEN=.*/, `YOUTUBE_REFRESH_TOKEN=${refresh_token}`);
      fs.writeFileSync(envPath, envContent);
      process.env.YOUTUBE_REFRESH_TOKEN = refresh_token;
      console.log('[OAUTH] Refresh token saved to .env');
      bot.sendMessage(OWNER_ID, '\u2705 YouTube OAuth authorized! Refresh token saved. Video uploads are now enabled.').catch(() => {});
      res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:500px;margin:60px auto;padding:20px;">
        <h1 style="color:green;">&#x2705; YouTube Authorized!</h1>
        <p>Refresh token saved. Solomon can now upload videos to YouTube.</p>
        <p>You received a confirmation on Telegram. You can close this window.</p>
      </body></html>`);
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

// ── LISTEN ───────────────────────────────────────────────────────────────
app.listen(parseInt(process.env.PORT || '3000'), '0.0.0.0', () => {
  log('INFO', 'SYSTEM', `Inject endpoint listening on port ${process.env.PORT || 3000}`);
  log('INFO', 'SYSTEM', 'OAuth: visit http://167.99.237.26:3000/oauth/start to authorize YouTube');
});

// ── STARTUP MESSAGE ──────────────────────────────────────────────────────
setTimeout(() => {
  bot.sendMessage(OWNER_ID, '🔥 Solomon V4 online. Ready for commands.')
    .then(() => log('INFO', 'SYSTEM', 'Startup message sent to Jed'))
    .catch(err => log('ERROR', 'SYSTEM', 'Startup msg error', { error: err.message }));
}, 2000);

log('INFO', 'SYSTEM', 'Running. Waiting for messages...');
