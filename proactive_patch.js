/**
 * Solomon Proactive Messaging Patch
 * 
 * Applies to bot.js:
 * - Adds internal HTTP server on port 4000 for Python backend callbacks
 * - Handles /notify, /question, /milestone, /error endpoints
 * - Delivers messages to Jed via Telegram immediately
 * 
 * Run: node proactive_patch.js
 */

const fs = require('fs');
const path = require('path');

const BOT_FILE = '/root/solomon-bot/bot.js';
const CREWAI_FILE = '/root/solomon-bot/crewai_backend_main.py';

// ── PATCH 1: Add internal HTTP server to bot.js ────────────────────────────
const BOT_INTERNAL_SERVER = `
// ── INTERNAL CALLBACK SERVER (for Python CrewAI backend) ──────────────────
// Listens on port 4000 for proactive notifications from the CrewAI backend
const http = require('http');
const internalServer = http.createServer(async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405); res.end('Method Not Allowed'); return;
  }
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const data = JSON.parse(body);
      const { type, message, title, pdf_path, md_path, task_id } = data;
      const chatId = OWNER_ID;

      if (req.url === '/notify/complete') {
        // Task completed — send PDF if available
        const caption = \`✅ *\${title || 'Task Complete'}*\n\n\${(message || '').slice(0, 900)}\`;
        if (pdf_path && fs.existsSync(pdf_path)) {
          await bot.sendDocument(chatId, pdf_path, { caption, parse_mode: 'Markdown' });
        } else if (md_path && fs.existsSync(md_path)) {
          await bot.sendDocument(chatId, md_path, { caption: caption + '\\n_(PDF unavailable, sending markdown)_', parse_mode: 'Markdown' });
        } else {
          await bot.sendMessage(chatId, caption, { parse_mode: 'Markdown' });
        }
      } else if (req.url === '/notify/question') {
        // Sol needs Jed's input
        await bot.sendMessage(chatId,
          \`❓ *Sol needs your input:*\\n\\n\${message || 'Please respond to continue.'}\`,
          { parse_mode: 'Markdown' });
      } else if (req.url === '/notify/milestone') {
        // Significant milestone reached
        await bot.sendMessage(chatId,
          \`🏆 *Milestone:* \${title || ''}\\n\\n\${message || ''}\`,
          { parse_mode: 'Markdown' });
      } else if (req.url === '/notify/error') {
        // Error requiring human intervention
        await bot.sendMessage(chatId,
          \`🚨 *Action needed:* \${title || 'Error'}\\n\\n\${message || ''}\\n\\nPlease advise.\`,
          { parse_mode: 'Markdown' });
      } else if (req.url === '/notify/blocked') {
        // Task is blocked
        await bot.sendMessage(chatId,
          \`🚫 *Blocked: \${title || 'Task'}*\\n\\n\${message || ''}\\n\\nThis task needs your input to proceed.\`,
          { parse_mode: 'Markdown' });
      } else {
        // Generic notification
        await bot.sendMessage(chatId, message || 'Notification from Sol.', { parse_mode: 'Markdown' });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      console.error('[INTERNAL-SERVER] Error:', e.message);
      res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  });
});
internalServer.listen(4000, '127.0.0.1', () => {
  console.log('[BOT] Internal callback server listening on port 4000');
});
// ── END INTERNAL CALLBACK SERVER ───────────────────────────────────────────
`;

// ── PATCH 2: Add /notify endpoint to crewai_backend_main.py ───────────────
const CREWAI_NOTIFY_ENDPOINT = `
@app.route('/proactive/notify', methods=['POST'])
def proactive_notify():
    """
    Send a proactive notification to Jed via the bot's internal callback server.
    Body: { type: 'complete'|'question'|'milestone'|'error'|'blocked', 
            title: str, message: str, pdf_path: str, md_path: str }
    """
    import requests as req_lib
    data = request.get_json() or {}
    notify_type = data.get('type', 'generic')
    url_map = {
        'complete': 'http://127.0.0.1:4000/notify/complete',
        'question': 'http://127.0.0.1:4000/notify/question',
        'milestone': 'http://127.0.0.1:4000/notify/milestone',
        'error': 'http://127.0.0.1:4000/notify/error',
        'blocked': 'http://127.0.0.1:4000/notify/blocked',
    }
    target_url = url_map.get(notify_type, 'http://127.0.0.1:4000/notify/generic')
    try:
        resp = req_lib.post(target_url, json=data, timeout=10)
        return jsonify({'ok': True, 'delivered': resp.status_code == 200})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

`;

// ── APPLY PATCHES ──────────────────────────────────────────────────────────
let botCode = fs.readFileSync(BOT_FILE, 'utf8');
let crewaiCode = fs.readFileSync(CREWAI_FILE, 'utf8');

// Check if already patched
if (botCode.includes('Internal callback server listening on port 4000')) {
  console.log('[PATCH] bot.js already has internal server — skipping');
} else {
  // Insert before the final console.log('[BOT] Solomon v6.0 fully initialized')
  const insertBefore = "console.log('[BOT] Solomon v6.0 fully initialized. Awaiting commands.');";
  if (botCode.includes(insertBefore)) {
    botCode = botCode.replace(insertBefore, BOT_INTERNAL_SERVER + '\n' + insertBefore);
    fs.writeFileSync(BOT_FILE, botCode, 'utf8');
    console.log('[PATCH] bot.js patched with internal callback server on port 4000');
  } else {
    // Append at end before module.exports or at very end
    botCode += '\n' + BOT_INTERNAL_SERVER;
    fs.writeFileSync(BOT_FILE, botCode, 'utf8');
    console.log('[PATCH] bot.js patched (appended internal server)');
  }
}

// Patch crewai backend
if (crewaiCode.includes('/proactive/notify')) {
  console.log('[PATCH] crewai_backend_main.py already has /proactive/notify — skipping');
} else {
  // Insert before the if __name__ == '__main__': block
  const insertBeforePy = "if __name__ == '__main__':";
  if (crewaiCode.includes(insertBeforePy)) {
    crewaiCode = crewaiCode.replace(insertBeforePy, CREWAI_NOTIFY_ENDPOINT + '\n' + insertBeforePy);
    fs.writeFileSync(CREWAI_FILE, crewaiCode, 'utf8');
    console.log('[PATCH] crewai_backend_main.py patched with /proactive/notify endpoint');
  } else {
    crewaiCode += '\n' + CREWAI_NOTIFY_ENDPOINT;
    fs.writeFileSync(CREWAI_FILE, crewaiCode, 'utf8');
    console.log('[PATCH] crewai_backend_main.py patched (appended)');
  }
}

console.log('[PATCH] All patches applied. Restart solomon-bot and solomon-crewai to activate.');
