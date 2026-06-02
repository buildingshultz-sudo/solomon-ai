'use strict';
// caleb-runner.js -- Playwright-driven executor for the Caleb task queue.
//
// Polls C:\Users\Ashle\Solomon\caleb-queue\ for *.json files, claims each,
// launches Chromium via Playwright (using a captured storageState matching
// auth_context), walks the structured caleb_steps[] array, screenshots
// between every step, writes a *.result.json sidecar, moves the job to
// processed/ or failed/. Optional `powershell` action runs shell commands
// (with a denylist guard — see CALEB_RUNNER_SECURITY.md).
//
// Pure ASCII. Configurable via env. Designed to run as the user (NOT SYSTEM)
// per the T3 security recommendation. See CALEB_RUNNER_SECURITY.md.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

let playwright;
try { playwright = require('playwright'); }
catch (e) {
  console.error('[FATAL] playwright not installed. Run: npm install playwright && npx playwright install chromium');
  process.exit(1);
}

// ── CONFIG (all env-driven) ─────────────────────────────────────────────────
const QUEUE_DIR     = process.env.CALEB_QUEUE_DIR    || 'C:\\Users\\Ashle\\Solomon\\caleb-queue';
const AUTH_DIR      = process.env.CALEB_RUNNER_AUTH_DIR || 'C:\\Users\\Ashle\\Solomon\\auth-states';
const POLL_MS       = parseInt(process.env.CALEB_RUNNER_POLL_MS || '5000', 10);
const HEADLESS_DEF  = String(process.env.CALEB_RUNNER_HEADLESS || 'false').toLowerCase() === 'true';
const LOG_PATH      = path.join(QUEUE_DIR, 'caleb-runner.log');
const LOG_ROLL_MAX  = 10 * 1024 * 1024; // 10 MB
const ACT_JOURNAL   = path.join(QUEUE_DIR, 'activity-journal.jsonl'); // pulled by Solomon when checking status
const CHROME_USER_DATA = process.env.CHROME_USER_DATA_DIR || 'C:\\Users\\Ashle\\AppData\\Local\\Google\\Chrome\\User Data';

const SUBDIRS = ['in-progress', 'processed', 'failed', 'screenshots', 'downloads'];
for (const sub of SUBDIRS) try { fs.mkdirSync(path.join(QUEUE_DIR, sub), { recursive: true }); } catch (_) {}
try { fs.mkdirSync(AUTH_DIR, { recursive: true }); } catch (_) {}

// ── LOGGING ─────────────────────────────────────────────────────────────────
function rollLogIfBig() {
  try {
    const s = fs.statSync(LOG_PATH);
    if (s.size > LOG_ROLL_MAX) fs.renameSync(LOG_PATH, LOG_PATH + '.1');
  } catch (_) {}
}
function logLine(level, msg, extra) {
  rollLogIfBig();
  const line = `${new Date().toISOString()} [${level}] ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}\n`;
  try { fs.appendFileSync(LOG_PATH, line, 'utf8'); } catch (_) {}
  process.stdout.write(line);
}
function journal(entry) {
  try { fs.appendFileSync(ACT_JOURNAL, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n', 'utf8'); }
  catch (_) {}
}

// ── SECURITY: powershell denylist ──────────────────────────────────────────
// Bare-minimum sanity check. NOT a comprehensive sandbox — task-file authors
// can still do plenty of damage. The full security model is in
// CALEB_RUNNER_SECURITY.md. Patterns are case-insensitive regex.
const DANGEROUS_PATTERNS = [
  /remove[-_]item\s+[^;]*\\windows/i,
  /\bformat\b\s+[a-z]:/i,
  /\bcipher\b\s+\/w/i,
  /\bbcdedit\b/i,
  /\breg\s+delete\s+hk(lm|cr|u)/i,
  /\bstop[-_]computer\b/i,
  /\brestart[-_]computer\b/i,
  /\bshutdown\b\s+/i,
  /\bdiskpart\b/i,
  /\bclear[-_]disk\b/i,
  /set-itemproperty\s+hk(lm|cu|cr):/i,
  /invoke-webrequest\s+[^|;]*\|\s*invoke-expression/i, // curl|iex remote exec
  /\biex\b\s*\(/i,                                      // IEX(... constructs
  /downloadstring\s*\(/i                                // Net.WebClient... downloadstring|iex
];
function isDangerous(cmd) {
  if (!cmd || typeof cmd !== 'string') return { dangerous: true, reason: 'empty or non-string command' };
  for (const re of DANGEROUS_PATTERNS) if (re.test(cmd)) return { dangerous: true, reason: 're=' + re.toString() };
  return { dangerous: false };
}

// ── AUTH RESOLUTION ────────────────────────────────────────────────────────
// auth_context values map to either a storageState JSON (for plain
// Playwright contexts) OR to chrome_profile (use the user's real Chrome via
// launchPersistentContext + CHROME_USER_DATA_DIR).
function resolveAuth(auth_context) {
  if (!auth_context) return { type: 'none' };
  if (auth_context === 'chrome_profile') return { type: 'persistent', user_data_dir: CHROME_USER_DATA };
  const stateFile = path.join(AUTH_DIR, `.pw_state_${auth_context}.json`);
  if (fs.existsSync(stateFile)) return { type: 'storage_state', state_file: stateFile };
  return { type: 'missing', expected_at: stateFile, auth_context };
}

// Auto-kill any running Chrome before launching with the user's profile.
// Mirrors setup-yt-pw.ps1's auto-kill. Only matters for chrome_profile auth.
async function killRunningChrome() {
  try {
    const { stdout } = await execAsync('powershell -NoProfile -Command "Get-Process chrome -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id"', { timeout: 5000 });
    const pids = (stdout || '').trim().split(/\r?\n/).filter(Boolean);
    if (!pids.length) return { killed: 0 };
    await execAsync('powershell -NoProfile -Command "Stop-Process -Name chrome -Force -ErrorAction SilentlyContinue"', { timeout: 5000 });
    await new Promise(r => setTimeout(r, 800));
    return { killed: pids.length };
  } catch (e) { return { killed: 0, error: e.message }; }
}

// ── PLAYWRIGHT LAUNCH ──────────────────────────────────────────────────────
async function launchBrowserFor(task, auth) {
  const headless = task.headless != null ? !!task.headless : HEADLESS_DEF;
  if (auth.type === 'persistent') {
    await killRunningChrome();
    const ctx = await playwright.chromium.launchPersistentContext(auth.user_data_dir, {
      headless,
      channel: 'chrome',
      args: ['--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled']
    });
    const page = ctx.pages()[0] || await ctx.newPage();
    return { browser: null, context: ctx, page, kind: 'persistent' };
  }
  const browser = await playwright.chromium.launch({ headless });
  const ctxOpts = {};
  if (auth.type === 'storage_state') ctxOpts.storageState = auth.state_file;
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  return { browser, context, page, kind: auth.type };
}

// ── STEP EXECUTOR ──────────────────────────────────────────────────────────
async function runStep(idx, step, ctx, taskState) {
  const { page, downloadsDir, screensDir, task } = taskState;
  const result = { idx, action: step.action, params: { ...step }, ok: false, started_at: new Date().toISOString() };
  delete result.params.action;
  const t0 = Date.now();

  try {
    switch (step.action) {
      case 'navigate': {
        const url = step.url;
        if (!url) throw new Error('navigate: url required');
        const resp = await page.goto(url, { waitUntil: step.wait_until || 'networkidle', timeout: step.timeout_ms || 30000 });
        result.http_status = resp ? resp.status() : null;
        result.final_url = page.url();
        break;
      }
      case 'click': {
        const locator = await resolveLocator(page, step);
        await locator.click({ timeout: step.timeout_ms || 10000 });
        if (step.wait_for_selector) await page.waitForSelector(step.wait_for_selector, { timeout: 10000 });
        break;
      }
      case 'type': {
        const locator = await resolveLocator(page, step);
        if (step.delay) await locator.type(step.text || '', { delay: step.delay });
        else            await locator.fill(step.text || '');
        break;
      }
      case 'key': {
        if (!step.key) throw new Error('key: key required');
        await page.keyboard.press(step.key);
        break;
      }
      case 'wait': {
        if (step.ms != null)            await page.waitForTimeout(step.ms);
        else if (step.for_selector)     await page.waitForSelector(step.for_selector, { timeout: step.timeout_ms || 30000 });
        else if (step.for_url_includes) await page.waitForURL(u => u.toString().includes(step.for_url_includes), { timeout: step.timeout_ms || 30000 });
        else throw new Error('wait: needs ms | for_selector | for_url_includes');
        break;
      }
      case 'screenshot': {
        const name = (step.name || `manual-${idx}`).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
        const out = step.path || path.join(screensDir, `${String(idx).padStart(3, '0')}-${name}.png`);
        await page.screenshot({ path: out, fullPage: step.full_page !== false, type: 'png' });
        result.path = out;
        break;
      }
      case 'export': {
        // Pattern: caller already triggered the download prep; this step
        // awaits the actual file landing via Playwright's download event.
        const expectedPath = step.path;
        if (!expectedPath) throw new Error('export: path required');
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: step.timeout_ms || 60000 }),
          step.trigger_selector ? page.locator(step.trigger_selector).click() : Promise.resolve()
        ]);
        await download.saveAs(expectedPath);
        const stats = fs.statSync(expectedPath);
        result.path = expectedPath;
        result.bytes = stats.size;
        result.suggested_filename = download.suggestedFilename();
        break;
      }
      case 'read_dom': {
        const locator = await resolveLocator(page, step);
        let value;
        if (step.attr) value = await locator.first().getAttribute(step.attr);
        else           value = await locator.first().textContent();
        result.value = value;
        if (step.into) taskState.scratch[step.into] = value;
        break;
      }
      case 'assert': {
        const left  = step.value;
        const right = step.expected;
        let pass = false;
        switch (step.condition || 'equals') {
          case 'equals':   pass = left === right; break;
          case 'contains': pass = typeof left === 'string' && typeof right === 'string' && left.includes(right); break;
          case 'matches':  pass = typeof left === 'string' && new RegExp(right).test(left); break;
          default: throw new Error('assert: unknown condition ' + step.condition);
        }
        result.condition = step.condition || 'equals';
        result.pass = pass;
        if (!pass) throw new Error(`assertion failed: ${JSON.stringify(left)} ${step.condition || 'equals'} ${JSON.stringify(right)}`);
        break;
      }
      case 'powershell': {
        const cmd = step.command;
        const guard = isDangerous(cmd);
        // Log BEFORE running so audit trail survives even if the command kills us.
        journal({ kind: 'powershell_pre', task_id: task.task_id, step: idx, command: cmd, dangerous_check: guard });
        logLine('PS-EXEC', `task=${task.task_id} step=${idx} cmd_first_120="${(cmd || '').slice(0, 120)}"`);
        if (guard.dangerous) {
          throw new Error(`powershell refused by denylist: ${guard.reason}`);
        }
        const psCmd = `powershell -NoProfile -NonInteractive -Command "${String(cmd).replace(/"/g, '\\"')}"`;
        const timeout = step.timeout_ms || 60000;
        try {
          const { stdout, stderr } = await execAsync(psCmd, { timeout, maxBuffer: 4 * 1024 * 1024 });
          result.stdout = step.capture_output === false ? '(captured: false)' : (stdout || '').slice(0, 20000);
          result.stderr = (stderr || '').slice(0, 4000);
          result.exit_code = 0;
          journal({ kind: 'powershell_post', task_id: task.task_id, step: idx, exit: 0, stdout_first_500: (stdout || '').slice(0, 500) });
        } catch (e) {
          result.exit_code = e.code != null ? e.code : 1;
          result.stdout = (e.stdout || '').slice(0, 4000);
          result.stderr = (e.stderr || '').slice(0, 4000);
          journal({ kind: 'powershell_post', task_id: task.task_id, step: idx, exit: result.exit_code, error: (e.message || '').slice(0, 300) });
          throw new Error(`powershell exit ${result.exit_code}: ${(e.stderr || e.message || '').slice(0, 200)}`);
        }
        break;
      }
      default:
        throw new Error('unknown action: ' + step.action);
    }
    result.ok = true;
  } catch (e) {
    result.ok = false;
    result.error = (e.message || String(e)).slice(0, 600);
  }

  result.duration_ms = Date.now() - t0;
  result.finished_at = new Date().toISOString();

  // Between-step viewport screenshot (skip for powershell — no browser frame).
  if (step.action !== 'powershell') {
    try {
      const sname = `step-${String(idx).padStart(3, '0')}-after-${step.action}.jpg`;
      const spath = path.join(screensDir, sname);
      await page.screenshot({ path: spath, fullPage: false, type: 'jpeg', quality: 60 });
      result.screenshot = spath;
    } catch (_) { /* page may have closed mid-action; not fatal */ }
  }
  return result;
}

async function resolveLocator(page, step) {
  if (step.text)     return page.getByText(step.text, { exact: !!step.exact_text });
  if (step.role)     return page.getByRole(step.role, step.role_name ? { name: step.role_name } : undefined);
  if (step.label)    return page.getByLabel(step.label);
  if (step.selector) return page.locator(step.selector);
  throw new Error('locator: need one of {text, role, label, selector}');
}

// ── TASK PROCESSOR ─────────────────────────────────────────────────────────
function pickNextJob() {
  const files = fs.readdirSync(QUEUE_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('.') && !f.endsWith('.result.json') && !f.endsWith('.error.json'))
    .sort();
  return files.length ? files[0] : null;
}

async function processOne() {
  const fname = pickNextJob();
  if (!fname) return false;
  const src = path.join(QUEUE_DIR, fname);
  const claim = path.join(QUEUE_DIR, 'in-progress', fname);
  try { fs.renameSync(src, claim); }
  catch (e) { logLine('WARN', `claim failed: ${fname}: ${e.message}`); return false; }

  let task;
  try { task = JSON.parse(fs.readFileSync(claim, 'utf8')); }
  catch (e) {
    logLine('ERROR', `parse failed: ${fname}: ${e.message}`);
    moveToFailed(claim, fname, { stage: 'parse', error: e.message });
    return true;
  }

  const taskId = task.task_id || fname.replace(/\.json$/, '');
  const screensDir = path.join(QUEUE_DIR, 'screenshots', taskId);
  const downloadsDir = path.join(QUEUE_DIR, 'downloads', taskId);
  fs.mkdirSync(screensDir, { recursive: true });
  fs.mkdirSync(downloadsDir, { recursive: true });

  const auth_context = task.auth_context || (Array.isArray(task.caleb_steps) && task.caleb_steps.length === 0 ? 'none' : null);
  const auth = resolveAuth(auth_context);

  const summary = {
    task_id: taskId,
    status: 'failed',
    started_at: new Date().toISOString(),
    finished_at: null,
    duration_ms: 0,
    auth_context,
    auth_resolution: { type: auth.type, expected_at: auth.expected_at || null, state_file: auth.state_file || null },
    steps: [],
    final_screenshot: null,
    error: null
  };
  journal({ kind: 'task_start', task_id: taskId, auth_context, auth_type: auth.type });
  logLine('TASK', `start ${taskId} auth_context=${auth_context} auth_type=${auth.type}`);

  // Auth-missing short-circuit.
  if (auth.type === 'missing') {
    const msg = `auth state missing for context "${auth.auth_context}" at ${auth.expected_at}. Run the matching setup-<context>-pw.ps1 capture script first.`;
    logLine('ERROR', msg);
    summary.error = { stage: 'auth', message: msg };
    summary.status = 'auth_missing';
    summary.finished_at = new Date().toISOString();
    summary.duration_ms = Date.now() - new Date(summary.started_at).getTime();
    writeResultSidecar(claim, fname, summary);
    moveToFailed(claim, fname, summary.error);
    journal({ kind: 'task_end', task_id: taskId, status: 'auth_missing' });
    return true;
  }

  // Detect plain-string steps (old schema) vs structured action steps (new schema).
  const steps = Array.isArray(task.caleb_steps) ? task.caleb_steps : [];
  const structured = steps.every(s => s && typeof s === 'object' && typeof s.action === 'string');
  if (!structured && steps.length) {
    const msg = `task uses plain-English caleb_steps (${steps.length} strings). caleb-runner requires structured {action, ...params} steps. See CALEB_RUNNER_SECURITY.md / schema doc. This task needs to be re-encoded (or run manually) before the runner can execute it.`;
    logLine('ERROR', msg);
    summary.error = { stage: 'schema', message: msg, sample_step: steps[0] };
    summary.status = 'schema_mismatch';
    summary.finished_at = new Date().toISOString();
    summary.duration_ms = Date.now() - new Date(summary.started_at).getTime();
    writeResultSidecar(claim, fname, summary);
    moveToFailed(claim, fname, summary.error);
    journal({ kind: 'task_end', task_id: taskId, status: 'schema_mismatch' });
    return true;
  }

  let driver = null;
  let lastError = null;
  const taskState = { task, screensDir, downloadsDir, scratch: {} };
  try {
    if (steps.some(s => s.action !== 'powershell')) {
      driver = await launchBrowserFor(task, auth);
      taskState.page = driver.page;
      taskState.context = driver.context;
    }

    for (let i = 0; i < steps.length; i++) {
      const stepRes = await runStep(i, steps[i], driver, taskState);
      summary.steps.push(stepRes);
      logLine(stepRes.ok ? 'STEP' : 'STEP-FAIL', `${taskId} #${i} ${stepRes.action} ${stepRes.duration_ms}ms${stepRes.ok ? '' : ' err=' + (stepRes.error || '').slice(0, 120)}`);
      if (!stepRes.ok) {
        lastError = { step_idx: i, message: stepRes.error };
        break;
      }
    }
    if (!lastError) summary.status = 'completed';
    else            summary.status = 'failed';
  } catch (e) {
    lastError = { step_idx: summary.steps.length, message: e.message, stack: (e.stack || '').slice(0, 1500) };
    summary.status = 'failed';
    logLine('ERROR', `task ${taskId} runtime: ${e.message}`);
  } finally {
    try {
      if (taskState.page && !taskState.page.isClosed()) {
        const finalShot = path.join(screensDir, '999-final.jpg');
        await taskState.page.screenshot({ path: finalShot, fullPage: false, type: 'jpeg', quality: 60 }).catch(() => {});
        summary.final_screenshot = finalShot;
      }
    } catch (_) {}
    try { if (driver && driver.context) await driver.context.close().catch(() => {}); } catch (_) {}
    try { if (driver && driver.browser) await driver.browser.close().catch(() => {}); } catch (_) {}
  }

  summary.error = lastError;
  summary.finished_at = new Date().toISOString();
  summary.duration_ms = Date.now() - new Date(summary.started_at).getTime();

  writeResultSidecar(claim, fname, summary);

  if (summary.status === 'completed') {
    moveToProcessed(claim, fname);
  } else {
    moveToFailed(claim, fname, summary.error);
  }
  journal({ kind: 'task_end', task_id: taskId, status: summary.status, duration_ms: summary.duration_ms, steps: summary.steps.length });
  logLine('TASK', `end ${taskId} status=${summary.status} duration=${summary.duration_ms}ms steps=${summary.steps.length}`);
  return true;
}

function writeResultSidecar(claimPath, fname, summary) {
  const baseDir = path.dirname(claimPath);
  const sidecar = path.join(baseDir, fname.replace(/\.json$/, '.result.json'));
  try { fs.writeFileSync(sidecar, JSON.stringify(summary, null, 2), 'utf8'); } catch (e) { logLine('WARN', 'sidecar write failed: ' + e.message); }
}
function moveToProcessed(claimPath, fname) {
  const dest = path.join(QUEUE_DIR, 'processed', fname);
  try { fs.renameSync(claimPath, dest); }
  catch (e) { logLine('WARN', 'move-to-processed failed: ' + e.message); }
  // Also move the sidecar
  try { fs.renameSync(claimPath.replace(/\.json$/, '.result.json'), dest.replace(/\.json$/, '.result.json')); } catch (_) {}
}
function moveToFailed(claimPath, fname, err) {
  const dest = path.join(QUEUE_DIR, 'failed', fname);
  try { fs.renameSync(claimPath, dest); } catch (_) {}
  try {
    const errFile = dest.replace(/\.json$/, '.error.json');
    fs.writeFileSync(errFile, JSON.stringify({ at: new Date().toISOString(), ...err }, null, 2), 'utf8');
  } catch (_) {}
  // Move sidecar if it exists
  try { fs.renameSync(claimPath.replace(/\.json$/, '.result.json'), dest.replace(/\.json$/, '.result.json')); } catch (_) {}
}

// ── MAIN LOOP ──────────────────────────────────────────────────────────────
logLine('BOOT', `caleb-runner starting host=${os.hostname()} pid=${process.pid} queue=${QUEUE_DIR} headless=${HEADLESS_DEF} poll=${POLL_MS}ms`);
journal({ kind: 'boot', host: os.hostname(), pid: process.pid, headless_default: HEADLESS_DEF });

let _running = false;
async function tick() {
  if (_running) return; // re-entrancy guard
  _running = true;
  try {
    let processed = 0;
    while (await processOne()) {
      processed++;
      if (processed >= 5) break; // soft cap per tick
    }
  } catch (e) {
    logLine('ERROR', 'tick exception: ' + e.message);
  } finally {
    _running = false;
  }
}
tick(); // first pass immediately
setInterval(tick, POLL_MS);

process.on('SIGINT',  () => { logLine('BOOT', 'SIGINT — exiting');  journal({ kind: 'shutdown', reason: 'SIGINT' });  process.exit(0); });
process.on('SIGTERM', () => { logLine('BOOT', 'SIGTERM — exiting'); journal({ kind: 'shutdown', reason: 'SIGTERM' }); process.exit(0); });
process.on('uncaughtException',  (e) => logLine('FATAL', 'uncaughtException: ' + e.message));
process.on('unhandledRejection', (e) => logLine('FATAL', 'unhandledRejection: ' + (e && e.message || e)));
