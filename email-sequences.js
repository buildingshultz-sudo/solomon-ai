'use strict';
// email-sequences.js — T0-C post-purchase drip templates.
//
// ── NATHAN REVIEW PENDING ────────────────────────────────────────────────
// All 4 templates below are FLAGGED for Nathan review before going live. The
// EMAIL_SEQUENCE_ACTIVE env var gates whether the scheduler actually SENDS
// these (true) or just Telegrams a preview to Jed (false, default).
//
// Voice spec from T0-C: direct, blue-collar, no fluff. Signature line:
// "Be Inspired. Stay Humble. And Build."
//
// Schedule (offsets from Day 0):
//   Day 0  — thank you + download confirm
//   Day 3  — value check-in with reply invitation
//   Day 7  — review request (Amazon or Gumroad based on product)
//   Day 14 — upsell (Tough Guys → Blueprint @ $19; Blueprint → Skool invite)

const SIGNATURE = 'Be Inspired. Stay Humble. And Build.\n— Jed\nbuildingshultz.com';

// Product detection from slug — Tough Guys variants vs Blueprint variants.
function classifyProduct(productSlug) {
  const s = (productSlug || '').toLowerCase();
  if (/(tough[-_]?guys|ihjobd|motivation[-_]?for)/.test(s)) return 'tough_guys';
  if (/(blueprint|ygmuv|builders?[-_]?ai)/.test(s)) return 'blueprint';
  return 'unknown';
}

function reviewLinkForProduct(product) {
  // Tough Guys lives on KDP (Amazon); Blueprint lives on Gumroad.
  if (product === 'tough_guys') return 'https://www.amazon.com/dp/B0XXXXXXXX'; // TODO: replace with real ASIN once KDP lists
  if (product === 'blueprint')  return 'https://shultzbuilds.gumroad.com/l/ygmuv';
  return 'https://shultzbuilds.gumroad.com';
}

function upsellForProduct(product) {
  if (product === 'tough_guys') {
    return {
      url: 'https://shultzbuilds.gumroad.com/l/ygmuv',
      pitch: 'The Builder\'s AI Blueprint',
      detail: 'The playbook I used to teach myself AI without a CS degree — practical, blue-collar, ship-your-first-tool-by-the-weekend kind of stuff. $19 with code TOUGHGUYS.'
    };
  }
  if (product === 'blueprint') {
    return {
      url: 'https://www.skool.com/buildingshultz', // TODO: replace with real Skool URL when live
      pitch: 'The Building Shultz community',
      detail: 'Where the guys who actually ship their first AI tool hang out. Free to join, real builders only. No gurus.'
    };
  }
  return null;
}

// Render the Day 0 / 3 / 7 / 14 email for a given purchase row.
// Returns { subject, body, html? } — body is plain text.
function renderEmail(row) {
  const product = classifyProduct(row.product_slug);
  const name = (row.buyer_name || '').split(' ')[0] || 'friend';

  switch (row.current_step) {
    // ─── Day 0 — thank you + download confirm ────────────────────────────
    case 0:
      return {
        subject: 'Got it — and thank you.',
        body: [
          `${name},`,
          '',
          'Quick note: your purchase came through and the download link should already be in your Gumroad receipt. If you can\'t find it, hit reply and I\'ll send it straight over.',
          '',
          'No fluff, no upsell here. Just: thanks. You voted with your wallet, that means more than you know.',
          '',
          'I\'ll check in a few days to see how it\'s landing.',
          '',
          SIGNATURE
        ].join('\n')
      };

    // ─── Day 3 — value check-in + reply invite ───────────────────────────
    case 1:
      return {
        subject: 'How\'s it sitting with you?',
        body: [
          `${name},`,
          '',
          'Three days in. Question: did anything in there actually land for you, or did it sit on your reading list?',
          '',
          'Honest answers — either way — help me write better stuff next time. Hit reply with a sentence or two. I read everything.',
          '',
          'If you got even one useful idea out of it, that\'s a win. If you didn\'t, tell me why and I\'ll send you something that does.',
          '',
          SIGNATURE
        ].join('\n')
      };

    // ─── Day 7 — review request ──────────────────────────────────────────
    case 2: {
      const reviewUrl = reviewLinkForProduct(product);
      return {
        subject: 'A favor — 30 seconds',
        body: [
          `${name},`,
          '',
          'A week in. If you got something out of the purchase, would you drop a quick review?',
          '',
          `Here: ${reviewUrl}`,
          '',
          'Doesn\'t have to be long. One sentence is plenty. Reviews are how guys like me — no marketing budget, no agency, just a workshop and a laptop — get the next reader to take a chance.',
          '',
          'If it wasn\'t for you, no hard feelings. Just hit reply and tell me what fell flat.',
          '',
          SIGNATURE
        ].join('\n')
      };
    }

    // ─── Day 14 — upsell ─────────────────────────────────────────────────
    case 3: {
      const up = upsellForProduct(product);
      if (!up) {
        // Unknown product — close the sequence cleanly without a pitch.
        return {
          subject: 'Last note from me',
          body: [
            `${name},`,
            '',
            'Two weeks in. Last note from this sequence — I\'ll get out of your inbox.',
            '',
            'If anything in the purchase ended up useful, that means a lot. If you want to stay in the loop on new stuff, the YouTube channel (Building Shultz) is the main spot.',
            '',
            'Appreciate you.',
            '',
            SIGNATURE
          ].join('\n')
        };
      }
      return {
        subject: `Two weeks in — one more thing`,
        body: [
          `${name},`,
          '',
          'Two weeks in. Last note from this sequence — but one thing worth flagging:',
          '',
          `${up.pitch}.`,
          '',
          up.detail,
          '',
          `Here if you want it: ${up.url}`,
          '',
          'Either way — appreciate you giving the first thing a shot.',
          '',
          SIGNATURE
        ].join('\n')
      };
    }

    default:
      return null;
  }
}

// Step → days until the next email (null = sequence complete).
const STEP_OFFSETS = { 0: 3, 1: 4, 2: 7, 3: null };

module.exports = { renderEmail, classifyProduct, STEP_OFFSETS, SIGNATURE };
