'use strict';
// heartbeat-health.js — Solomon V4 self-healing ops layer.
//
// WHY A NEW PROCESS (not an edit to scheduler.js):
//   scheduler.js is in CORE_PROTECTED_PATHS (tools.js) and must not be modified.
//   The existing 5-min liveness pulse (_heartbeat() 'ok' write in bot.js) and the
//   T0-G offline monitor (scheduler.js ~L1989) BOTH stay exactly as they are.
//   This process ADDS the real health checks + self-heal on its own 5-min cron,
//   and is deliberately complementary — it does NOT re-alert "solomon-v4 offline"
//   (the scheduler monitor already owns that) to avoid duplicate Telegrams.
//
// SAFETY ENVELOPE:
//   • Auto-acts ONLY on reversible ops (pm2 restart of a downed, non-crash-looping
//     proc). Confidence-gated by the EXISTING dispatch ladder (EXECUTE_THRESHOLD).
//   • NEVER auto-performs elevated/irreversible actions (UAC, money, publish,
//     delete, kill -9). Those ESCALATE to Jed with one recommended next step.
//   • Exception-only Telegram: silent when everything passes.
//   • Every self-heal action is written to activity_log (type='self_heal').

require('dotenv').config();
const cron = require('node-cron');
const axios = require('axios');
const { execFile } = require('child_process');
const TelegramBot = require('node-telegram-bot-api');

const { db, mem, budget } = require('./memory');
const { EXECUTE_THRESHOLD, CONSULT_THRESHOLD } = require('./dispatch');
const fs = require('fs');
const path = require('path');
const SAM_QUEUE_DIR = '/root/solomon-v4/sam-queue';

// In-memory alert dedup (resets on restart) so a sustained outage doesn't spam.
const _alertDedup = new Map();
function _shouldAlert(key, minMs) {
  const last = _alertDedup.get(key) || 0;
  if (Date.now() - last < minMs) return false;
  _alertDedup.set(key, Date.now());
  return true;
}
let logActivity;
try { logActivity = require('./activity-logger').logActivity; } catch (_) {}
// Fallback writer if activity-logger doesn't export logActivity — uses the
// VERIFIED activity_log schema (type, tool_name, status, summary, metadata).
if (typeof logActivity !== 'function') {
  logActivity = (type, o = {}) => {
    try {
      db.prepare(`INSERT INTO activity_log (type, tool_name, status, summary, metadata)
        VALUES (?, ?, ?, ?, ?)`).run(type, o.toolName || null, o.status || 'ok',
        o.summary || null, o.metadata ? JSON.stringify(o.metadata) : null);
    } catch (_) {}
  };
}

const OWNER_ID = parseInt(process.env.OWNER_CHAT_ID);
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

// Config (all verified against .env / live infra during fact-check):
const APP_HEALTH = [
  { name: 'tradequote-ai', url: 'http://127.0.0.1:4001/health' },
  { name: 'imminav',       url: 'http://127.0.0.1:4002/health' },
  { name: 'ruralroute',    url: 'http://127.0.0.1:4003/health' },
];
const PC_RELAY_URL = process.env.PC_RELAY_URL;          // VPS→PC relay base
const PC_RELAY_SECRET = process.env.PC_RELAY_SECRET;
// Absolute pm2 path — under PM2 the child PATH can be stripped, and a bare
// 'pm2' that fails to resolve would falsely read as "pm2 unreadable". Override
// via PM2_BIN env (set in ecosystem.config.js).
const PM2_BIN = process.env.PM2_BIN || 'pm2';
const BUDGET_ALERT = parseFloat(process.env.MONTHLY_BUDGET_ALERT || '50');
const BUDGET_HARD = parseFloat(process.env.MONTHLY_BUDGET_HARD_STOP || '100');
// Procs we will auto-restart when simply 'down'. (Restart is reversible.)
// pm2-logrotate is a pm2 module — left to pm2 itself.
const RESTART_ELIGIBLE = new Set([
  'solomon-v4', 'solomon-scheduler', 'solomon-dashboard', 'solomon-mcp',
  'tradequote-ai', 'imminav', 'ruralroute',
  'buildingshultz-site', 'shultzenterprises-site',
]);
// A proc is "crash-looping" (→ escalate, don't auto-restart) if it has restarted
// a lot AND is currently not stably online. We snapshot restart_time between ticks.
const _lastRestart = new Map();

// ── helpers ───────────────────────────────────────────────────────────────
function pm2List() {
  return new Promise((resolve) => {
    execFile(PM2_BIN, ['jlist'], { maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(null);
      try { resolve(JSON.parse(stdout)); } catch (_) { resolve(null); }
    });
  });
}
function pm2Restart(name) {
  return new Promise((resolve) => {
    execFile(PM2_BIN, ['restart', name, '--update-env'], { maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => resolve(!err));
  });
}
async function tgEscalate(title, detail, recommend) {
  const msg = `🚨 *Solomon health — needs you*\n*${title}*\n${detail}\n\n*Recommended next step:* ${recommend}`;
  await bot.sendMessage(OWNER_ID, msg, { parse_mode: 'Markdown' })
    .catch(() => bot.sendMessage(OWNER_ID, msg.replace(/[*_`]/g, '')).catch(() => {}));
}

// ── CHECK 1: all PM2 procs online (+ self-heal downed, escalate crash-loops) ─
async function checkPm2(list, findings, heals) {
  if (!list) { findings.push('pm2 jlist unreadable'); return; }
  for (const p of list) {
    const name = p.name;
    const status = p.pm2_env && p.pm2_env.status;
    const restarts = (p.pm2_env && p.pm2_env.restart_time) || 0;
    if (status === 'online') { _lastRestart.set(name, restarts); continue; }
    // Down. Decide: auto-restart vs escalate (crash-loop = a Decision for Jed).
    const prev = _lastRestart.get(name);
    const looping = prev != null && (restarts - prev) >= 3; // ≥3 restarts since last tick
    const confidence = looping ? 0.40 : 0.95;               // reuse dispatch ladder gate
    if (!RESTART_ELIGIBLE.has(name) || confidence < EXECUTE_THRESHOLD) {
      findings.push(`${name} is ${status} (restarts=${restarts}${looping ? ', CRASH-LOOPING' : ''})`);
      await tgEscalate(
        `${name} is ${status}`,
        looping ? `It is crash-looping (${restarts} restarts) — auto-restart would just mask the cause.`
                : `Not in the auto-restart allowlist.`,
        looping ? `SSH in and \`pm2 logs ${name} --err --lines 50\` to find why it dies, then fix + restart.`
                : `Decide whether to \`pm2 restart ${name}\` manually.`
      );
      logActivity('self_heal', { status: 'escalated', summary: `${name} ${status} → escalated to Jed`,
        metadata: { proc: name, restarts, looping } });
      continue;
    }
    // Auto-heal: reversible restart.
    const ok = await pm2Restart(name);
    heals.push(`restarted ${name} (was ${status})`);
    logActivity('self_heal', { status: ok ? 'ok' : 'failed',
      summary: `auto-restarted ${name} (was ${status}, conf=${confidence})`,
      metadata: { proc: name, action: 'pm2_restart', ok } });
    if (!ok) {
      findings.push(`auto-restart of ${name} FAILED`);
      await tgEscalate(`Auto-restart of ${name} failed`,
        `${name} was ${status}; \`pm2 restart\` returned an error.`,
        `SSH in and inspect \`pm2 logs ${name}\` — the process may need a manual fix.`);
    }
    _lastRestart.set(name, restarts);
  }
}

// ── CHECK 2: app /health endpoints return 200 ───────────────────────────────
async function checkAppHealth(findings) {
  for (const a of APP_HEALTH) {
    try {
      const r = await axios.get(a.url, { timeout: 4000, validateStatus: () => true });
      if (r.status !== 200) findings.push(`${a.name} /health → ${r.status}`);
    } catch (e) {
      // Unreachable usually means the proc is down — checkPm2 handles the restart;
      // here we only record the symptom (no duplicate escalation).
      findings.push(`${a.name} /health unreachable (${e.code || e.message})`);
    }
  }
}

// ── CHECK 3: PC relay reachable + version + READ-ONLY INVARIANT holds ────────
// Version-agnostic: works for BOTH 1.2.0 (all D: writes 405) and 1.3.0 (footage
// still 405; only D:\Solomon\reports\ is writable). We probe a FOOTAGE path, which
// must return 405 in either version. We never write to the reports\ carve-out
// (no side effects from a health check).
async function checkRelay(findings, surfaced) {
  if (!PC_RELAY_URL || PC_RELAY_URL === 'PLACEHOLDER') { findings.push('PC_RELAY_URL not configured'); return; }
  const H = { 'X-Secret': PC_RELAY_SECRET };
  let version = 'unknown';
  try {
    const s = await axios.get(`${PC_RELAY_URL}/status`, { headers: H, timeout: 5000, validateStatus: () => true });
    if (s.status !== 200) { surfaced.relay = `relay /status → ${s.status}`; return; } // reachable-but-bad: WARN only
    version = (s.data && s.data.relay_version) || 'unknown';
    surfaced.relay = `relay ${version} reachable`;
    // PART 2: caleb-worker liveness via the relay's heartbeat field.
    const cw = (s.data && s.data.caleb_worker) || null;
    surfaced.caleb_worker = cw ? `alive=${cw.alive} hb=${cw.heartbeat_age_s}s pid=${cw.child_pid}` : 'field absent';
    if (cw && cw.alive === false && _shouldAlert('caleb_worker_dead', 30 * 60000)) {
      findings.push(`caleb-worker DOWN (heartbeat ${cw.heartbeat_age_s}s stale)`);
      await tgEscalate('Caleb worker DOWN',
        `caleb-worker heartbeat is stale (${cw.heartbeat_age_s}s old, >120s threshold). Caleb dispatches will stall.`,
        `The relay supervisor should auto-respawn it within seconds. If still down, restart the PC relay.`);
    }
  } catch (e) {
    // Unreachable: could be PC offline / network. WARN-level, not an escalation.
    surfaced.relay = `relay unreachable (${e.code || e.message})`;
    return;
  }
  // Read-only invariant probe (footage path must be refused).
  try {
    const probe = `D:\\B ROLL FOOTAGE\\__healthcheck_readonly_probe__.txt`;
    const w = await axios.post(`${PC_RELAY_URL}/file/write?path=${encodeURIComponent(probe)}`,
      'health-probe', { headers: H, timeout: 5000, validateStatus: () => true });
    if (w.status !== 405) {
      // SECURITY: footage is no longer read-only. Irreversible-risk → escalate hard.
      findings.push(`READ-ONLY INVARIANT BROKEN: footage write returned ${w.status} (expected 405)`);
      await tgEscalate('PC relay read-only invariant BROKEN',
        `POST /file/write to a D:\\B ROLL FOOTAGE path returned *${w.status}* (must be 405). Footage may be writable.`,
        `Do NOT run footage jobs. SSH/relay: confirm pc-relay.js version + the D: read-only gate immediately.`);
    }
  } catch (_) { /* probe network error already implied by unreachable path above */ }
}

// ── CHECK 4: campaign on the correct day ────────────────────────────────────
// FACT-CHECK: there is NO stored "day counter" to drift — dayIndex is COMPUTED
// from mem campaign/start_date each tick. So we validate the anchor's sanity
// instead of "correcting a counter". Misconfig = a Decision → escalate.
function checkCampaign(findings) {
  if (mem.get('campaign', 'active') !== 'true') return; // idle: nothing to check
  const startStr = mem.get('campaign', 'start_date');
  if (!startStr) {
    findings.push('campaign active but start_date missing');
    return tgEscalate('Campaign active but has no start_date',
      'Auto-posting is on but `mem campaign/start_date` is empty, so dayIndex cannot be computed.',
      'Set the campaign start date (e.g. `/campaign start 2026-06-04`) or stop the campaign.');
  }
  const start = new Date(startStr + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dayIndex = Math.round((today - start) / 86400000) + 1;
  if (dayIndex < 1 || dayIndex > 30) {
    findings.push(`campaign dayIndex out of range: ${dayIndex} (start=${startStr})`);
    return tgEscalate('Campaign day out of range',
      `Computed dayIndex=${dayIndex} from start_date=${startStr} — outside 1..30.`,
      dayIndex > 30 ? 'Campaign likely complete — `/campaign stop`.' : 'Fix start_date.');
  }
  // Healthy: dayIndex in range. (Slot auto-fire is already owned by the scheduler
  // watcher; we don't double-fire here.)
}

// ── CHECK 5: Anthropic spend under cap with headroom ────────────────────────
function checkBudget(findings) {
  let spend = 0;
  try {
    const r = db.prepare(`SELECT COALESCE(SUM(cost_usd),0) s FROM budget
      WHERE created_at >= date('now','start of month')`).get();
    spend = r.s || 0;
  } catch (e) { findings.push('budget query failed: ' + e.message); return; }
  if (spend >= BUDGET_HARD) {
    findings.push(`MONTHLY SPEND OVER HARD CAP: $${spend.toFixed(2)} ≥ $${BUDGET_HARD}`);
    tgEscalate('Anthropic spend hit the hard cap',
      `Month-to-date spend is *$${spend.toFixed(2)}* (hard cap $${BUDGET_HARD}). Continuing spends money.`,
      'Decide: raise MONTHLY_BUDGET_HARD_STOP, throttle usage, or pause spend-heavy jobs.');
  } else if (spend >= BUDGET_ALERT) {
    // Heads-up tier — a soft Decision. One Telegram (not silent), no auto-action.
    findings.push(`spend past alert tier: $${spend.toFixed(2)} ≥ $${BUDGET_ALERT} (cap $${BUDGET_HARD})`);
  }
  // else: silent (healthy headroom).
}

// ── CHECK: dispatch-chain health (PART 2 — no transitive trust) ──────────────
// Asserts ground truth on the dispatch queue: (a) nothing stuck in 'queued' past
// 30 min, (b) every 'done' dispatch is backed by an activity_log artifact — a
// 'done' with NO corroborating log row is CLAIMED-UNVERIFIED, never trusted.
function checkDispatchHealth(findings, surfaced) {
  let files = [];
  try { files = fs.readdirSync(SAM_QUEUE_DIR).filter(f => /^dispatch_.*\.json$/.test(f)); } catch (_) { return; }
  const now = Date.now();
  const stuck = [], unverified = [];
  for (const f of files) {
    let j; try { j = JSON.parse(fs.readFileSync(path.join(SAM_QUEUE_DIR, f), 'utf8')); } catch (_) { continue; }
    const id = j.id || f;
    const ageMin = j.timestamp_ct ? (now - new Date(j.timestamp_ct).getTime()) / 60000 : 0;
    if (j.status === 'queued' && ageMin > 30) stuck.push(`${id}(${Math.round(ageMin)}m)`);
    if (j.status === 'done') {
      let hasArtifact = false;
      try { hasArtifact = !!db.prepare('SELECT 1 FROM activity_log WHERE summary LIKE ? LIMIT 1').get('%' + id + '%'); } catch (_) {}
      if (!hasArtifact) unverified.push(id);
    }
  }
  surfaced.dispatch = `stuck>30m:${stuck.length} done-unverified:${unverified.length}`;
  if (stuck.length && _shouldAlert('stuck_queued', 30 * 60000)) {
    findings.push(`${stuck.length} dispatch(es) stuck in queued >30m: ${stuck.slice(0, 5).join(', ')}`);
  }
  if (unverified.length && _shouldAlert('claimed_unverified', 60 * 60000)) {
    findings.push(`${unverified.length} dispatch(es) DONE with NO activity_log artifact → claimed-unverified: ${unverified.slice(0, 5).join(', ')}`);
  }
}

// ── ORCHESTRATION ───────────────────────────────────────────────────────────
async function runHealthChecks() {
  const findings = [];   // anything not-healthy (drives exception-only alert)
  const heals = [];      // auto-heal actions taken this tick
  const surfaced = {};   // informational (e.g. relay version) — surfaced, not alerted
  try {
    const list = await pm2List();
    await checkPm2(list, findings, heals);
    await checkAppHealth(findings);
    await checkRelay(findings, surfaced);
    await checkCampaign(findings);
    checkBudget(findings);
    checkDispatchHealth(findings, surfaced);
  } catch (e) {
    findings.push('health-check crashed: ' + e.message);
  }

  if (heals.length) {
    logActivity('self_heal', { status: 'ok', summary: `tick self-heals: ${heals.join('; ')}`,
      metadata: { heals } });
  }
  // Exception-only: silent on all-pass. Telegram a digest only if there are
  // findings that were NOT already individually escalated above. (Per-item hard
  // escalations already messaged Jed; this digest covers WARN-tier symptoms.)
  if (findings.length) {
    const body = `⚠️ *Solomon health digest*\n` +
      findings.map(f => `• ${f}`).join('\n') +
      (heals.length ? `\n\n_Auto-healed:_ ${heals.join('; ')}` : '') +
      (surfaced.relay ? `\n_Relay:_ ${surfaced.relay}` : '');
    await bot.sendMessage(OWNER_ID, body, { parse_mode: 'Markdown' })
      .catch(() => bot.sendMessage(OWNER_ID, body.replace(/[*_`]/g, '')).catch(() => {}));
  }
  // Always write a compact health row so a future monitor can see we ran.
  logActivity('health_check', {
    status: findings.length ? 'warn' : 'ok',
    summary: findings.length ? `${findings.length} finding(s)` : 'all checks pass',
    metadata: { findings, heals, relay: surfaced.relay || null },
  });
}

// Run once on boot, then every 5 minutes.
runHealthChecks();
cron.schedule('*/5 * * * *', runHealthChecks);
console.log('[solomon-health] self-healing ops layer started — checks every 5 min');
