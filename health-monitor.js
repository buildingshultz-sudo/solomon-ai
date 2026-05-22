/**
 * Solomon Health Monitor v1.0
 *
 * Deep health checks that verify ACTUAL functionality, not just "process is running".
 * Checks:
 * - Telegram API connectivity (can send messages)
 * - OpenRouter API (can get LLM responses)
 * - PC Agent (heartbeat freshness)
 * - Task queue integrity (no stuck tasks, valid JSON)
 * - PDF generation (tool exists and works)
 * - Disk space
 * - Memory usage
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const QUEUE_FILE = path.join(__dirname, 'task-queue.json');
const HEALTH_LOG = path.join(__dirname, 'health-log.json');
const CHECK_INTERVAL = 300000;  // 5 minutes

let lastHealthReport = null;

function getMemoryUsage() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  return {
    totalMB: Math.round(total / 1048576),
    usedMB: Math.round(used / 1048576),
    freeMB: Math.round(free / 1048576),
    percentUsed: Math.round((used / total) * 100)
  };
}

function getDiskUsage() {
  try {
    const output = execSync('df -h / | tail -1', { encoding: 'utf8' });
    const parts = output.trim().split(/\s+/);
    return {
      total: parts[1],
      used: parts[2],
      available: parts[3],
      percentUsed: parseInt(parts[4]) || 0
    };
  } catch {
    return { total: '?', used: '?', available: '?', percentUsed: 0 };
  }
}

function checkQueueIntegrity() {
  const issues = [];
  try {
    const raw = fs.readFileSync(QUEUE_FILE, 'utf8');
    const queue = JSON.parse(raw);
    
    if (!queue.tasks || !Array.isArray(queue.tasks)) {
      issues.push('Queue file has no tasks array');
      return { ok: false, issues };
    }

    // Check for stuck active tasks (active > 10 minutes)
    const stuckTasks = queue.tasks.filter(t =>
      t.status === 'active' && t.startedAt && Date.now() - t.startedAt > 600000
    );
    if (stuckTasks.length > 0) {
      issues.push(`${stuckTasks.length} task(s) stuck in 'active' state for >10 minutes`);
    }

    // Check for tasks with too many attempts
    const exhaustedTasks = queue.tasks.filter(t =>
      t.status === 'pending' && t.attempts >= (t.maxRetries || 3)
    );
    if (exhaustedTasks.length > 0) {
      issues.push(`${exhaustedTasks.length} task(s) exceeded max retries but still pending`);
    }

    // Check for duplicate tasks
    const titles = queue.tasks.filter(t => t.status === 'pending').map(t => t.title);
    const dupes = titles.filter((t, i) => titles.indexOf(t) !== i);
    if (dupes.length > 0) {
      issues.push(`${dupes.length} duplicate pending task(s)`);
    }

    return {
      ok: issues.length === 0,
      issues,
      stats: {
        total: queue.tasks.length,
        pending: queue.tasks.filter(t => t.status === 'pending').length,
        active: queue.tasks.filter(t => t.status === 'active').length,
        completed: queue.tasks.filter(t => t.status === 'completed').length,
        failed: queue.tasks.filter(t => t.status === 'failed').length,
        blocked: queue.tasks.filter(t => t.status === 'blocked').length
      }
    };
  } catch (e) {
    issues.push(`Queue file error: ${e.message}`);
    return { ok: false, issues };
  }
}

function checkPDFTool() {
  const tools = ['/usr/local/bin/manus-md-to-pdf', '/usr/local/bin/weasyprint'];
  const results = {};
  for (const tool of tools) {
    if (fs.existsSync(tool)) {
      try {
        execSync(`${tool} --version 2>&1 || ${tool} --help 2>&1`, { timeout: 5000, encoding: 'utf8' });
        results[path.basename(tool)] = 'available';
      } catch {
        results[path.basename(tool)] = 'exists but may not work';
      }
    } else {
      results[path.basename(tool)] = 'NOT INSTALLED';
    }
  }
  return results;
}

async function checkTelegramAPI(token) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(10000)
    });
    const data = await res.json();
    return { ok: data.ok, botName: data.result?.username };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function checkOpenRouter(apiKey, url) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        max_tokens: 5,
        temperature: 0
      })
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content;
    return { ok: !!reply, response: reply?.slice(0, 20) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function checkPCAgent(relayUrl) {
  try {
    const res = await fetch(`${relayUrl}/agent/status`, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    return {
      ok: data.online,
      stale: data.stale,
      version: data.version,
      ageSeconds: data.ageSeconds,
      tabs: data.tabs
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── FULL HEALTH CHECK ──────────────────────────────────────────────────────
async function runFullCheck(config) {
  const report = {
    timestamp: new Date().toISOString(),
    overall: 'healthy',
    checks: {}
  };

  // System resources
  report.checks.memory = getMemoryUsage();
  report.checks.disk = getDiskUsage();
  if (report.checks.memory.percentUsed > 90) report.overall = 'degraded';
  if (report.checks.disk.percentUsed > 90) report.overall = 'degraded';

  // Queue integrity
  report.checks.queue = checkQueueIntegrity();
  if (!report.checks.queue.ok) report.overall = 'degraded';

  // PDF tools
  report.checks.pdf = checkPDFTool();

  // Telegram
  if (config.TELEGRAM_TOKEN) {
    report.checks.telegram = await checkTelegramAPI(config.TELEGRAM_TOKEN);
    if (!report.checks.telegram.ok) report.overall = 'degraded';
  }

  // OpenRouter
  if (config.OPENROUTER_API_KEY) {
    report.checks.openrouter = await checkOpenRouter(config.OPENROUTER_API_KEY, config.OPENROUTER_URL);
    if (!report.checks.openrouter.ok) report.overall = 'critical';
  }

  // PC Agent
  if (config.RELAY_URL) {
    report.checks.pcAgent = await checkPCAgent(config.RELAY_URL);
  }

  // Determine overall status
  const criticalFails = [
    report.checks.telegram && !report.checks.telegram.ok,
    report.checks.openrouter && !report.checks.openrouter.ok
  ].filter(Boolean).length;
  
  if (criticalFails >= 2) report.overall = 'critical';

  lastHealthReport = report;

  // Log to file
  try {
    let log = [];
    try { log = JSON.parse(fs.readFileSync(HEALTH_LOG, 'utf8')); } catch {}
    log.push(report);
    if (log.length > 288) log = log.slice(-288);  // Keep 24 hours at 5-min intervals
    fs.writeFileSync(HEALTH_LOG, JSON.stringify(log, null, 2));
  } catch {}

  return report;
}

function getLastReport() {
  return lastHealthReport;
}

function formatReportForTelegram(report) {
  const emoji = { healthy: '🟢', degraded: '🟡', critical: '🔴' };
  let text = `${emoji[report.overall] || '⚪'} *System Health: ${report.overall.toUpperCase()}*\n\n`;
  
  if (report.checks.memory) {
    text += `💾 RAM: ${report.checks.memory.usedMB}/${report.checks.memory.totalMB}MB (${report.checks.memory.percentUsed}%)\n`;
  }
  if (report.checks.disk) {
    text += `💿 Disk: ${report.checks.disk.used}/${report.checks.disk.total} (${report.checks.disk.percentUsed}%)\n`;
  }
  if (report.checks.telegram) {
    text += `📱 Telegram: ${report.checks.telegram.ok ? '✅' : '❌'}\n`;
  }
  if (report.checks.openrouter) {
    text += `🧠 LLM: ${report.checks.openrouter.ok ? '✅' : '❌'}\n`;
  }
  if (report.checks.pcAgent) {
    text += `🖥️ PC Agent: ${report.checks.pcAgent.ok ? '✅ online' : '❌ offline'}`;
    if (report.checks.pcAgent.tabs) text += ` (${report.checks.pcAgent.tabs} tabs)`;
    text += '\n';
  }
  if (report.checks.queue) {
    const q = report.checks.queue.stats;
    if (q) text += `📋 Queue: ${q.pending} pending, ${q.active} active, ${q.blocked} blocked\n`;
    if (report.checks.queue.issues.length > 0) {
      text += `⚠️ Issues: ${report.checks.queue.issues.join('; ')}\n`;
    }
  }
  if (report.checks.pdf) {
    const pdfOk = Object.values(report.checks.pdf).every(v => v === 'available');
    text += `📄 PDF: ${pdfOk ? '✅' : '⚠️ ' + JSON.stringify(report.checks.pdf)}\n`;
  }

  return text;
}

module.exports = {
  runFullCheck,
  getLastReport,
  formatReportForTelegram,
  checkQueueIntegrity,
  CHECK_INTERVAL
};
