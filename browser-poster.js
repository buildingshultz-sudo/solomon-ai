'use strict';
// browser-poster.js -- Playwright-driven posting for platforms whose public
// APIs cannot post (YouTube Community, Instagram feed). Headless by default,
// loads a captured storageState JSON (NOT credentials -- captured once by
// Jed via capture_{yt,ig}_pw_auth.js + scp'd up, gitignored on the VPS).
//
// Module exports:
//   postYouTubeCommunity({ text, image_path?, channel_id? }, opts?)
//   postInstagram({ caption, image_path }, opts?)
//
// Each returns { ok, post_url?, screenshot_path, pre_screenshot_path, error?, code? }
// where code is one of:
//   'AUTH_MISSING'   -- .pw_state_<platform>.json not on disk
//   'AUTH_EXPIRED'   -- Playwright landed on a sign-in URL
//   'TIMEOUT'        -- Playwright timeout (transient, retried once already)
//   'NETWORK'        -- net::ERR_* network failure (transient, retried once)
//   'SELECTOR'       -- Could not find a needed control after fallbacks (DOM drift)
//   'UNKNOWN'        -- anything else
//
// Screenshots: written to /root/solomon-v4/posts/screenshots/<ISO>-<platform>-<step>.png.
// Pre-submit + post-submit shots saved for audit; gitignored on the VPS.
//
// DOES NOT touch tools.js. tools.js wiring is a separate approval-gated change.

const fs = require('fs');
const path = require('path');

const STATE_DIR  = process.env.PW_STATE_DIR  || '/root/solomon-v4';
const SHOTS_DIR  = process.env.PW_SHOTS_DIR  || path.join(STATE_DIR, 'posts', 'screenshots');
const UA         = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function _ensureShotsDir() {
  try { if (!fs.existsSync(SHOTS_DIR)) fs.mkdirSync(SHOTS_DIR, { recursive: true }); } catch (_) {}
}
function _shotPath(platform, suffix) {
  _ensureShotsDir();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(SHOTS_DIR, `${ts}-${platform}-${suffix}.png`);
}

// Tag a thrown error so the top-level retry logic can decide whether to bail.
function _tagError(e) {
  const m = String(e && e.message || e);
  if (/Timeout|TimeoutError|timed out/i.test(m)) e.code = 'TIMEOUT';
  else if (/net::ERR_|ENETUNREACH|ECONNREFUSED|ECONNRESET|EAI_AGAIN/i.test(m)) e.code = 'NETWORK';
  else if (!e.code) e.code = 'UNKNOWN';
  return e;
}

async function _openContext(platform, opts) {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch (e) { const err = new Error('playwright not installed: ' + e.message); err.code = 'UNKNOWN'; throw err; }
  const statePath = path.join(STATE_DIR, `.pw_state_${platform}.json`);
  if (!fs.existsSync(statePath)) {
    const err = new Error(`auth state missing at ${statePath} -- run capture_${platform === 'youtube' ? 'yt' : 'ig'}_pw_auth on Jed's PC first`);
    err.code = 'AUTH_MISSING';
    throw err;
  }
  const headless = opts && opts.headless !== undefined ? opts.headless : true;
  const browser = await chromium.launch({ headless, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({
    storageState: statePath,
    userAgent: UA,
    viewport: { width: 1366, height: 900 }
  });
  // Surface page console + network errors in our process log for debugging.
  context.on('weberror', err => console.error(`[browser-poster ${platform}] weberror:`, String(err.error()).slice(0, 200)));
  return { browser, context, statePath };
}

// Try a list of locators in order; click the first that resolves within `each` ms.
// Returns true on click success, false if nothing matched. Doesn't throw on
// individual misses so the caller can build a multi-strategy chain cleanly.
async function _tryClick(page, locators, each = 4000) {
  for (const sel of locators) {
    try {
      const loc = page.locator(sel).first();
      await loc.waitFor({ state: 'visible', timeout: each });
      await loc.click({ timeout: each });
      return { ok: true, selector: sel };
    } catch (_) { /* try next */ }
  }
  return { ok: false };
}

// Try a list of locators; type into the first one that's writable.
async function _tryFill(page, locators, value, each = 4000) {
  for (const sel of locators) {
    try {
      const loc = page.locator(sel).first();
      await loc.waitFor({ state: 'visible', timeout: each });
      await loc.click({ timeout: each });
      await loc.fill('');
      // contenteditable divs sometimes ignore fill -- keyboard.type as fallback.
      try { await loc.fill(value, { timeout: 2000 }); }
      catch (_) { await page.keyboard.type(value, { delay: 8 }); }
      return { ok: true, selector: sel };
    } catch (_) { /* try next */ }
  }
  return { ok: false };
}

// ── YOUTUBE COMMUNITY POST ────────────────────────────────────────────────
async function _doYouTube(page, { text, image_path }) {
  // 1. Land on YouTube Studio. If we get bounced to accounts.google.com the
  //    storageState has lapsed and the user needs to re-capture.
  await page.goto('https://studio.youtube.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (/accounts\.google\.com/.test(page.url())) {
    const err = new Error('YouTube auth state expired -- re-run capture_yt_pw_auth.js on PC');
    err.code = 'AUTH_EXPIRED';
    throw err;
  }

  // 2. Navigate directly to the channel community page when we can extract
  //    the channel id from the post-landing URL. Falls back to clicking the
  //    Create -> Post nav if direct nav doesn't work.
  let onCommunity = false;
  const chMatch = page.url().match(/\/channel\/(UC[\w-]+)/);
  if (chMatch) {
    try {
      await page.goto(`https://studio.youtube.com/channel/${chMatch[1]}/community`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      onCommunity = true;
    } catch (_) {}
  }

  // 3. Open the post composer. On the community tab there's usually a
  //    persistent text-input area; otherwise we click Create -> Post.
  if (!onCommunity) {
    const created = await _tryClick(page, [
      'ytcp-button#create-icon',
      'button[aria-label*="Create" i]',
      'button:has(svg[aria-label*="Create" i])',
      '#create-icon'
    ]);
    if (!created.ok) { const err = new Error('Could not find Create button'); err.code = 'SELECTOR'; throw err; }
    const opened = await _tryClick(page, [
      'text=/^Post$/i',
      'text=/^New post$/i',
      'text=/^Create post$/i',
      '[role="menuitem"]:has-text("Post")'
    ]);
    if (!opened.ok) { const err = new Error('Could not find Post menu item'); err.code = 'SELECTOR'; throw err; }
  }

  // 4. Fill the composer.
  const filled = await _tryFill(page, [
    'div[contenteditable="true"][aria-label*="post" i]',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]'
  ], text);
  if (!filled.ok) { const err = new Error('Could not find post composer'); err.code = 'SELECTOR'; throw err; }

  // 5. Optional image attach.
  if (image_path) {
    if (!fs.existsSync(image_path)) { const err = new Error('image_path not found: ' + image_path); err.code = 'UNKNOWN'; throw err; }
    try {
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(image_path, { timeout: 8000 });
    } catch (_) { /* not all post types support images; continue text-only */ }
  }

  // 6. Pre-submit screenshot.
  const preShot = _shotPath('youtube', 'pre');
  try { await page.screenshot({ path: preShot, fullPage: false }); } catch (_) {}

  // 7. Submit.
  const submitted = await _tryClick(page, [
    'ytcp-button:has-text("Post"):not(:has-text("comments"))',
    'button:has-text("Post"):not(:has-text("comments"))',
    'button[aria-label*="Post" i]:not([aria-label*="cancel" i])',
    '[role="button"]:has-text("Post")'
  ], 6000);
  if (!submitted.ok) { const err = new Error('Could not find final Post submit button'); err.code = 'SELECTOR'; throw err; }

  // 8. Give YT a moment to process + take post-submit screenshot.
  await page.waitForTimeout(3500);
  const postShot = _shotPath('youtube', 'post');
  try { await page.screenshot({ path: postShot, fullPage: false }); } catch (_) {}

  return { ok: true, post_url: page.url(), pre_screenshot_path: preShot, screenshot_path: postShot };
}

// ── INSTAGRAM FEED POST ───────────────────────────────────────────────────
async function _doInstagram(page, { caption, image_path }) {
  if (!image_path) { const err = new Error('Instagram feed posts require image_path'); err.code = 'UNKNOWN'; throw err; }
  if (!fs.existsSync(image_path)) { const err = new Error('image_path not found: ' + image_path); err.code = 'UNKNOWN'; throw err; }

  // 1. Land on instagram.com home.
  await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (/accounts\/login/.test(page.url())) {
    const err = new Error('Instagram auth state expired -- re-run capture_ig_pw_auth.js on PC');
    err.code = 'AUTH_EXPIRED';
    throw err;
  }

  // 2. Click the "New post" entry point (left nav).
  const opened = await _tryClick(page, [
    'svg[aria-label="New post"]',
    'a[href*="/create/"]',
    'div[role="button"]:has(svg[aria-label="New post"])',
    'span:has-text("Create")'
  ]);
  if (!opened.ok) { const err = new Error('Could not find Instagram New post button'); err.code = 'SELECTOR'; throw err; }

  // 3. The hidden file input accepts setInputFiles without opening native picker.
  let fileInputSet = false;
  try {
    const fileInput = page.locator('input[type="file"][accept*="image"], input[type="file"]').first();
    await fileInput.waitFor({ state: 'attached', timeout: 8000 });
    await fileInput.setInputFiles(image_path, { timeout: 8000 });
    fileInputSet = true;
  } catch (_) {}
  if (!fileInputSet) {
    // Some IG variants require clicking a "Select from computer" button first.
    await _tryClick(page, [
      'button:has-text("Select from computer")',
      '[role="button"]:has-text("Select from computer")'
    ], 6000);
    try {
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(image_path, { timeout: 8000 });
      fileInputSet = true;
    } catch (_) {}
  }
  if (!fileInputSet) { const err = new Error('Could not attach image to Instagram composer'); err.code = 'SELECTOR'; throw err; }

  // 4. Click through crop / filter screens (two Next buttons).
  for (let i = 0; i < 2; i++) {
    const nx = await _tryClick(page, [
      'div[role="button"]:has-text("Next")',
      'button:has-text("Next")'
    ], 8000);
    if (!nx.ok) { const err = new Error('Could not find Next button (step ' + (i + 1) + ')'); err.code = 'SELECTOR'; throw err; }
    await page.waitForTimeout(800);
  }

  // 5. Fill caption.
  const captionOk = await _tryFill(page, [
    'div[role="textbox"][aria-label*="caption" i]',
    'div[contenteditable="true"][aria-label*="caption" i]',
    'textarea[aria-label*="caption" i]',
    'div[contenteditable="true"][aria-describedby]'
  ], caption);
  if (!captionOk.ok) { const err = new Error('Could not find Instagram caption field'); err.code = 'SELECTOR'; throw err; }

  // 6. Pre-submit screenshot.
  const preShot = _shotPath('instagram', 'pre');
  try { await page.screenshot({ path: preShot, fullPage: false }); } catch (_) {}

  // 7. Share.
  const shared = await _tryClick(page, [
    'div[role="button"]:has-text("Share")',
    'button:has-text("Share")'
  ], 8000);
  if (!shared.ok) { const err = new Error('Could not find Share button'); err.code = 'SELECTOR'; throw err; }

  // 8. Wait for confirmation toast / "Your post has been shared".
  try {
    await page.waitForSelector('text=/Your post has been shared|Post shared/i', { timeout: 30000 });
  } catch (_) { /* not always visible; rely on URL/screenshot */ }
  await page.waitForTimeout(2000);
  const postShot = _shotPath('instagram', 'post');
  try { await page.screenshot({ path: postShot, fullPage: false }); } catch (_) {}

  return { ok: true, post_url: page.url(), pre_screenshot_path: preShot, screenshot_path: postShot };
}

// Top-level wrapper: opens browser, runs the platform-specific flow, closes
// browser, retries once on TIMEOUT or NETWORK codes only. Auth-expired,
// auth-missing, and selector errors are surfaced immediately (retrying won't help).
async function _runWithRetry(platform, runner, opts) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let browser, context;
    try {
      ({ browser, context } = await _openContext(platform, opts));
      const page = await context.newPage();
      const result = await runner(page);
      try { await context.close(); } catch (_) {}
      try { await browser.close(); } catch (_) {}
      return result;
    } catch (e) {
      try { if (context) await context.close(); } catch (_) {}
      try { if (browser) await browser.close(); } catch (_) {}
      lastErr = _tagError(e);
      const transient = lastErr.code === 'TIMEOUT' || lastErr.code === 'NETWORK';
      if (attempt < 2 && transient) {
        console.warn(`[browser-poster ${platform}] attempt ${attempt} transient (${lastErr.code}), retrying once`);
        continue;
      }
      break;
    }
  }
  return {
    ok: false,
    code: (lastErr && lastErr.code) || 'UNKNOWN',
    error: (lastErr && lastErr.message) || 'unknown error',
    screenshot_path: null,
    pre_screenshot_path: null
  };
}

async function postYouTubeCommunity(input, opts) {
  if (!input || !input.text || typeof input.text !== 'string' || !input.text.trim()) {
    return { ok: false, code: 'UNKNOWN', error: 'text required (non-empty string)' };
  }
  return _runWithRetry('youtube', (page) => _doYouTube(page, input), opts || {});
}

async function postInstagram(input, opts) {
  if (!input || !input.caption || typeof input.caption !== 'string') {
    return { ok: false, code: 'UNKNOWN', error: 'caption required (string)' };
  }
  if (!input.image_path || typeof input.image_path !== 'string') {
    return { ok: false, code: 'UNKNOWN', error: 'image_path required (local file on VPS)' };
  }
  return _runWithRetry('instagram', (page) => _doInstagram(page, input), opts || {});
}

module.exports = {
  postYouTubeCommunity,
  postInstagram,
  // Exposed for sanity-test scripts; not part of the stable API.
  _openContext,
  STATE_DIR,
  SHOTS_DIR
};
