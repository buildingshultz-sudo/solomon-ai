'use strict';
// caleb-playwright.js — Playwright executor for Caleb browser tasks.
// Lazy-requires playwright INSIDE launch() so the worker still runs (verify/ping)
// even before `npm i playwright` finishes. Persistent profile keeps logins.
//
// Safety (STEP 7): only navigates to URLs from the task payload (+ the fixed KDP
// domain for kdp tasks); never clicks Publish/Submit/Place order/Confirm purchase;
// 120s per-task hard timeout; missing file_path fails fast without opening a site.

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const USER_DATA_DIR = process.env.CALEB_PROFILE_DIR || 'C:\\Users\\Ashle\\caleb-browser-profile';
const CAPTURE_DIR = process.env.CALEB_CAPTURE_DIR || 'C:\\Users\\Ashle\\caleb-captures';
const REPORT_URL = process.env.CALEB_REPORT_URL || 'http://167.99.237.26:3000/caleb-result';
const SECRET = process.env.PC_RELAY_SECRET;
const DEFAULT_TIMEOUT = 30000;
const TASK_TIMEOUT_MS = 120000; // STEP 7: 2-minute hard cap per task
const IDLE_CLOSE_MS = 5 * 60 * 1000;

const FORBIDDEN_CLICK = [/\bpublish\b/i, /submit for review/i, /place order/i, /confirm purchase/i, /\bbuy now\b/i, /place your order/i];

function ensureDir(p) { try { fs.mkdirSync(p, { recursive: true }); } catch (_) {} }
function tsName(ext) { return `${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`; }

class PlaywrightExecutor {
  constructor() {
    this.context = null;
    this.idleTimer = null;
  }

  async launch() {
    if (this.context) { this._touchIdle(); return; }
    let chromium;
    try { ({ chromium } = require('playwright')); }
    catch (e) { throw new Error('playwright not installed yet — run `npm i playwright && npx playwright install chromium` in pc-relay'); }
    ensureDir(USER_DATA_DIR); ensureDir(CAPTURE_DIR);
    this.context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: false,          // headful so Jed can watch / intervene
      viewport: null,
      args: ['--start-maximized']
    });
    this.context.setDefaultTimeout(DEFAULT_TIMEOUT);
    this._touchIdle();
  }

  _touchIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => { this.close().catch(() => {}); }, IDLE_CLOSE_MS);
  }

  async _page() {
    const pages = this.context.pages();
    return pages.length ? pages[0] : await this.context.newPage();
  }

  async close() {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    if (this.context) { try { await this.context.close(); } catch (_) {} this.context = null; }
  }

  // STEP 3 — interim status POST to /caleb-result (Solomon Telegrams Jed).
  reportProgress(dispatchId, message, status) {
    if (!dispatchId || !SECRET) return;
    const payload = JSON.stringify({ dispatch_id: dispatchId, status: status || 'progress', summary: String(message).slice(0, 500) });
    let u; try { u = new URL(REPORT_URL); } catch (_) { return; }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'X-Secret': SECRET }, timeout: 8000
    }, res => { res.on('data', () => {}); res.on('end', () => {}); });
    req.on('error', () => {}); req.on('timeout', () => { try { req.destroy(); } catch (_) {} });
    req.write(payload); req.end();
  }

  async _shot(page, tag) {
    ensureDir(CAPTURE_DIR);
    const fp = path.join(CAPTURE_DIR, `${tag}_${tsName('png')}`);
    try { await page.screenshot({ path: fp, fullPage: true }); return fp; }
    catch (e) { try { await page.screenshot({ path: fp }); return fp; } catch (_) { return null; } }
  }

  // STEP 4 — route by task_type, wrapped in the 120s hard timeout (STEP 7).
  async execute(task) {
    await this.launch();
    let timer;
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error('task exceeded 120s'), { _timeout: true })), TASK_TIMEOUT_MS); });
    try {
      return await Promise.race([this._route(task), timeout]);
    } catch (e) {
      let shot = null;
      try { shot = await this._shot(await this._page(), 'error'); } catch (_) {}
      if (e._timeout) { try { await this.close(); } catch (_) {} return { status: 'timeout', worker_status: 'caleb_timeout', summary: 'task exceeded 120s — browser closed', screenshot: shot }; }
      return { status: 'error', worker_status: 'caleb_error', summary: ('error: ' + e.message).slice(0, 400), screenshot: shot };
    } finally { clearTimeout(timer); this._touchIdle(); }
  }

  async _route(task) {
    const tt = String(task.task_type || '').toLowerCase();
    if (tt === 'browser') return this._handleBrowser(task);
    if (tt === 'kdp') return this._handleKdp(task);
    if (tt === 'capture') return this._handleCapture(task);
    return { status: 'error', worker_status: 'caleb_error', summary: 'no playwright handler for task_type=' + tt };
  }

  // HANDLER 1 — general navigation
  async _handleBrowser(task) {
    const page = await this._page();
    if (task.url) await page.goto(task.url, { waitUntil: 'load' });
    const shot = await this._shot(page, 'browser');
    return { status: 'done', worker_status: 'caleb_done',
      summary: `browser: title='${(await page.title()).slice(0, 120)}' url=${page.url()} shot=${shot}`,
      screenshot: shot, title: await page.title(), url: page.url() };
  }

  // HANDLER 3 — capture
  async _handleCapture(task) {
    const page = await this._page();
    if (task.url) await page.goto(task.url, { waitUntil: 'load' });
    await page.waitForTimeout(Number.isFinite(task.wait_ms) ? task.wait_ms : 2000);
    ensureDir(CAPTURE_DIR);
    const fp = path.join(CAPTURE_DIR, `capture_${tsName('png')}`);
    await page.screenshot({ path: fp, fullPage: true });
    return { status: 'done', worker_status: 'caleb_done', summary: `capture saved: ${fp} (url=${page.url()})`, screenshot: fp, url: page.url() };
  }

  // HANDLER 2 — KDP upload (navigation only up to the upload field; never submits).
  async _handleKdp(task) {
    const dispatchId = task.dispatch_id;
    // STEP 7: missing file → fail fast, do NOT open KDP.
    if (task.file_path && !fs.existsSync(task.file_path)) {
      return { status: 'error', worker_status: 'caleb_error', summary: `file_path not found on disk: ${task.file_path} (KDP not opened)` };
    }
    const page = await this._page();
    this.reportProgress(dispatchId, '🤖 KDP: opening kdp.amazon.com');
    await page.goto('https://kdp.amazon.com', { waitUntil: 'load' });

    // Login detection → report needs_login immediately. KDP shows a BRANDED
    // "Sign in with your Amazon login" page that doesn't always use the
    // /ap/signin URL or #ap_email ids, so detect by sign-in TEXT + fields too.
    const url = page.url();
    let loginText = 0;
    try { loginText = await page.getByText(/sign in with your amazon|enter mobile number or email|create your kdp account/i).count(); } catch (_) {}
    const loginFields = await page.locator('#ap_email, input[name="email"], #ap_password, input[type="password"]').count();
    const loginish = /signin|\/ap[\/_]|register\b/i.test(url) || loginText > 0 || loginFields > 0;
    if (loginish) {
      const shot = await this._shot(page, 'kdp_login');
      return { status: 'needs_login', worker_status: 'caleb_needs_login', summary: `KDP requires login — sign in manually in the open window. shot=${shot}`, screenshot: shot };
    }

    this.reportProgress(dispatchId, '🤖 KDP: searching bookshelf for "' + (task.book_title || '') + '"');
    try { await page.goto('https://kdp.amazon.com/en_US/bookshelf', { waitUntil: 'load' }); } catch (_) {}
    await page.waitForTimeout(2500); // let the bookshelf SPA / any login redirect settle
    // KDP redirects logged-out users to the sign-in page HERE (not on the first
    // page), so re-check login before concluding the book is missing.
    {
      let lt = 0; try { lt = await page.getByText(/sign in with your amazon|enter mobile number or email|create your kdp account/i).count(); } catch (_) {}
      const lf = await page.locator('#ap_email, input[name="email"], input[type="password"]').count();
      if (/signin|\/ap[\/_]|register\b/i.test(page.url()) || lt > 0 || lf > 0) {
        const shot = await this._shot(page, 'kdp_login');
        return { status: 'needs_login', worker_status: 'caleb_needs_login', summary: `KDP requires login — sign in manually in the open window, then re-dispatch. shot=${shot}`, screenshot: shot };
      }
    }
    // Best-effort: locate the book row by title text (KDP DOM is dynamic — tune as needed).
    const title = task.book_title || '';
    const titleLoc = title ? page.getByText(title, { exact: false }).first() : null;
    if (titleLoc && (await titleLoc.count()) === 0) {
      const shot = await this._shot(page, 'kdp_notfound');
      return { status: 'error', worker_status: 'caleb_error', summary: `book "${title}" not found on bookshelf (logged in, but no matching title). shot=${shot}`, screenshot: shot };
    }

    // Navigate Manage title → Paperback → Continue setup (best-effort, guarded clicks).
    await this._safeClickByText(page, ['Manage title', 'Manage', 'Edit paperback', 'Paperback Content']);
    this.reportProgress(dispatchId, '🤖 KDP: reached title management');
    await this._safeClickByText(page, ['Paperback']);
    await this._safeClickByText(page, ['Continue setup', 'Edit paperback Content', 'Paperback Content']);

    const section = String(task.kdp_section || 'cover').toLowerCase();
    this.reportProgress(dispatchId, `🤖 KDP: navigating to ${section} upload`);
    // Find the file input for the section (do NOT submit/publish).
    const fileInput = page.locator('input[type="file"]').first();
    const haveInput = (await fileInput.count()) > 0;
    if (!haveInput) {
      const shot = await this._shot(page, 'kdp_noupload');
      return { status: 'error', worker_status: 'caleb_error', summary: `reached KDP ${section} step but no file <input> found (DOM may differ — needs selector tuning). shot=${shot}`, screenshot: shot };
    }
    // TEST MODE: confirm we reached the upload field. Only set the file if explicitly allowed.
    if (task.do_upload === true && task.file_path) {
      await fileInput.setInputFiles(task.file_path);
      this.reportProgress(dispatchId, '🤖 KDP: file attached, waiting for upload confirmation');
      try { await page.getByText(/upload(ed|ing)? (complete|success)|successfully uploaded/i).first().waitFor({ timeout: 60000 }); } catch (_) {}
      const shot = await this._shot(page, 'kdp_uploaded');
      return { status: 'done', worker_status: 'caleb_done', summary: `KDP ${section} upload attempted for ${task.file_path}. shot=${shot} (NOT submitted/published — Jed reviews + publishes)`, screenshot: shot };
    }
    const shot = await this._shot(page, 'kdp_upload_ready');
    return { status: 'done', worker_status: 'caleb_done', summary: `KDP ${section}: reached the upload field (test mode — no file set, nothing submitted). shot=${shot}`, screenshot: shot };
  }

  // Guarded click: refuses money/irreversible buttons (STEP 7).
  async _safeClickByText(page, candidates) {
    for (const c of candidates) {
      if (FORBIDDEN_CLICK.some(re => re.test(c))) throw Object.assign(new Error('refused forbidden click: ' + c), { _forbidden: true });
      try {
        const loc = page.getByRole('button', { name: new RegExp(c, 'i') }).first();
        if ((await loc.count()) > 0) { await loc.click({ timeout: 8000 }); return true; }
        const link = page.getByText(new RegExp(c, 'i')).first();
        if ((await link.count()) > 0) { await link.click({ timeout: 8000 }); return true; }
      } catch (_) { /* try next candidate */ }
    }
    return false;
  }
}

module.exports = { PlaywrightExecutor };
