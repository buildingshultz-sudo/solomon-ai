'use strict';
// klein-newsletter-watcher.js
// Detects newsletters from tradesmanclub@kleintools.com (the Klein Tools
// Tradesman Club marketing list -- a few of the emails hide a "reward link"
// that activates points if clicked, and the customer Jed has missed them in
// the past). When one lands:
//   1. Extract every link from BOTH the plain text and HTML body, dedupe.
//   2. Drop assets / mailto / tel / unsubscribe / preferences / pixel-style URLs.
//   3. Drop anything off-domain that isn't a marketing redirect (utm_*).
//   4. GET each remaining link with a real Chrome UA, follow redirects, 10s
//      timeout, 1.5s polite delay between requests.
//   5. Log each click to activity_log type='klein_newsletter_link_click'.
//   6. Telegram the owner one summary message per processed email.
//
// Idempotent per Gmail UID via mem('klein_processed', uid) marker -- so the
// 5-min email-triage poll never re-clicks the same email.
//
// Hook: scheduler.js's existing email triage loop calls processKleinEmail(em)
// once per new email. No new cron required.

const KLEIN_FROM     = 'tradesmanclub@kleintools.com';
const ALLOW_DOMAINS  = ['kleintools.com', 'kleintradesmanclub.com'];
const ASSET_EXT_RE   = /\.(png|jpe?g|gif|webp|svg|ico|bmp|css|js|woff2?|ttf|mp4|webm)(\?|$)/i;
const SKIP_PATH_RE   = /\/(unsubscribe|preferences|opt[-_]?out|update[-_]?profile|manage[-_]?prefs?|email[-_]?settings)\b/i;
const CLICK_DELAY_MS = 1500;
const REQ_TIMEOUT_MS = 10000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function _isKleinEmail(em) {
  return ((em && em.from_email) || '').toLowerCase().trim() === KLEIN_FROM;
}

function _extractLinks(htmlBody, textBody) {
  const urls = new Set();
  if (htmlBody) {
    const hrefRe = /href\s*=\s*["']([^"']+)["']/gi;
    let m;
    while ((m = hrefRe.exec(htmlBody)) !== null) {
      const raw = m[1].trim();
      if (raw) urls.add(raw);
    }
  }
  if (textBody) {
    const urlRe = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
    let m;
    while ((m = urlRe.exec(textBody)) !== null) {
      // Trim trailing punctuation common in plain text
      urls.add(m[0].replace(/[.,;:!?\)\]]+$/, ''));
    }
  }
  return [...urls];
}

function _shouldFollow(url) {
  try {
    if (!/^https?:\/\//i.test(url)) return false; // skip mailto:, tel:, #anchor, javascript:
    const u = new URL(url);
    if (ASSET_EXT_RE.test(u.pathname)) return false;
    if (SKIP_PATH_RE.test(u.pathname)) return false;
    const host = u.hostname.toLowerCase();
    // Allowlist: klein domains and subdomains
    if (ALLOW_DOMAINS.some(d => host === d || host.endsWith('.' + d))) return true;
    // Marketing redirect domains (Klein uses e.g. click.kleintools.com or third-party ESPs)
    // that carry utm_* params -- those generally land on the brand site after a redirect.
    if (u.searchParams.has('utm_source') || u.searchParams.has('utm_campaign') || u.searchParams.has('utm_medium')) return true;
    // Anything else: skip (don't accidentally hammer random tracking pixels or partner sites)
    return false;
  } catch (_) {
    return false;
  }
}

async function _click(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQ_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const resp = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br'
      },
      signal: ac.signal
    });
    // Drain body quickly to release the socket; we don't need the content.
    try { await resp.text(); } catch (_) {}
    return { ok: true, status: resp.status, final_url: resp.url, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, status: 0, error: String(e.message || e).slice(0, 200), ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

const _sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Process one email candidate. No-op for non-Klein emails. Idempotent per uid.
 *
 * @param {Object} email             From check_inbox: {uid, from_email, subject, body_text_full, body_html, ...}
 * @param {Object} ctx
 * @param {Object} ctx.db            better-sqlite3 instance (for activity_log)
 * @param {Object} ctx.mem           memory module with .get/.set
 * @param {Object} ctx.bot           TelegramBot instance with .sendMessage
 * @param {number} ctx.OWNER_ID      Owner chat id
 * @returns {Promise<{handled:boolean, reason?:string, attempted?:number, ok_count?:number}>}
 */
async function processKleinEmail(email, ctx) {
  if (!_isKleinEmail(email)) return { handled: false, reason: 'not klein' };
  const { db, mem, bot, OWNER_ID } = ctx || {};
  const uidKey = String(email.uid || email.subject || '');
  if (!uidKey) return { handled: false, reason: 'no uid' };
  if (mem && mem.get('klein_processed', uidKey)) return { handled: false, reason: 'already processed' };

  const html = email.body_html || '';
  const text = email.body_text_full || email.body_snippet || '';
  const allLinks = _extractLinks(html, text);
  const followable = allLinks.filter(_shouldFollow);

  console.log(`[KLEIN] uid=${uidKey} subj="${(email.subject || '').slice(0, 70)}" total_links=${allLinks.length} followable=${followable.length}`);

  const results = [];
  for (const url of followable) {
    const r = await _click(url);
    results.push({ url, ...r });
    console.log(`[KLEIN] click ${r.ok ? r.status : 'ERR'} ${url.slice(0, 100)} (${r.ms}ms)${r.error ? ' ' + r.error : ''}`);
    if (db) {
      try {
        db.prepare('INSERT INTO activity_log (type, summary) VALUES (?, ?)').run(
          'klein_newsletter_link_click',
          JSON.stringify({ uid: uidKey, url, status: r.status || 0, final_url: r.final_url || null, ok: r.ok, ms: r.ms }).slice(0, 800)
        );
      } catch (e) { console.error('[KLEIN] activity_log insert failed:', e.message); }
    }
    await _sleep(CLICK_DELAY_MS);
  }

  // Mark processed (whether or not any link was followed -- don't replay this uid).
  if (mem) {
    try { mem.set('klein_processed', uidKey, new Date().toISOString()); } catch (_) {}
  }

  const okCount = results.filter(r => r.ok && r.status < 400).length;
  if (bot && OWNER_ID) {
    const msg = followable.length === 0
      ? '✅ Klein newsletter detected — no followable reward links in this one.'
      : `✅ Klein newsletter detected — hidden reward link clicked automatically.\n(${okCount}/${followable.length} link${followable.length === 1 ? '' : 's'} OK)`;
    bot.sendMessage(OWNER_ID, msg).catch(() => {});
  }

  return { handled: true, attempted: followable.length, ok_count: okCount, total_links: allLinks.length };
}

module.exports = {
  processKleinEmail,
  // exported for unit testing / dry runs
  _extractLinks,
  _shouldFollow,
  _isKleinEmail,
  KLEIN_FROM,
  ALLOW_DOMAINS
};
