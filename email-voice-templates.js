'use strict';
// email-voice-templates.js — T0-F autoresponse templates for inbound email.
//
// ── NATHAN REVIEW PENDING ────────────────────────────────────────────────
// All 5 templates below are FLAGGED for Nathan review before going live.
// EMAIL_TRIAGE_AUTORESPOND gates whether the scheduler actually SENDS (true)
// or just drafts to email_triage_drafts + Telegrams Jed (false, default).
//
// Voice: direct, blue-collar, no fluff. Signature line:
// "Be Inspired. Stay Humble. And Build."

const SIGNATURE = '\n\nBe Inspired. Stay Humble. And Build.\n— Jed\nbuildingshultz.com';

// Pick a template_id from intent + light email-content keyword check.
function chooseTemplate(intent, from, subject, snippet) {
  if (intent !== 'ROUTINE' && intent !== 'MEDIUM') return null; // HIGH never autoresponds
  const hay = `${from || ''} ${subject || ''} ${snippet || ''}`.toLowerCase();
  if (/(press|podcast|interview|feature.*you|write.*about you|story on)/.test(hay)) return 'press_interview';
  if (/(refund|download.*issue|can'?t access|missing receipt|never received|broken link)/.test(hay)) return 'customer_support';
  if (/(partner|affiliate|collab|sponsor|brand deal|promo code for)/.test(hay)) return 'partnership';
  if (/(thank|thanks|appreciate|great work|love your)/.test(hay)) return 'generic_thanks';
  return 'short_answer'; // generic "I got your email" reply
}

// Render a draft for the given template_id. Returns { subject, body } or null.
function renderDraft(template_id, em) {
  const from = em.from_name || em.from_email || 'there';
  const firstName = String(from).split(/[\s@]/)[0];
  const subjPrefix = em.subject && !/^re:/i.test(em.subject) ? `Re: ${em.subject}` : (em.subject || 'Re: your message');

  switch (template_id) {
    case 'generic_thanks':
      return {
        subject: subjPrefix,
        body: `${firstName},\n\nGot it — appreciate you taking the time to write. Means more than you know.\n\nIf there's something specific you need from me, hit reply and I'll get to it.` + SIGNATURE
      };

    case 'short_answer':
      return {
        subject: subjPrefix,
        body: `${firstName},\n\nGot your email — short version: I'll need to look at this properly when I'm at a desk. If it's time-sensitive, say so and I'll bump it up the stack. Otherwise expect a real reply inside a couple business days.` + SIGNATURE
      };

    case 'press_interview':
      return {
        subject: subjPrefix,
        body: `${firstName},\n\nThanks for reaching out. Press / interview requests I handle in a batch — usually a Friday afternoon block.\n\nSend over the topic angle, your outlet, and a couple proposed dates. If we're a fit, I'll lock a 30-min window.\n\nNot a great fit for "tell me your story" stuff — I'm more useful on a specific question (AI for tradesmen, building a software business as a non-CS guy, that kind of thing).` + SIGNATURE
      };

    case 'customer_support':
      return {
        subject: subjPrefix,
        body: `${firstName},\n\nGot your support note — sorry for the friction.\n\nIf this is about a download link, check your Gumroad receipt email first (sometimes filters catch it). Still missing? Reply with the email you used at checkout and I'll resend within a business day.\n\nIf this is a refund request, Gumroad's "Library" tab has a one-click refund button for the first 30 days. After 30 days, reply here and I'll handle it manually.` + SIGNATURE
      };

    case 'partnership':
      return {
        subject: subjPrefix,
        body: `${firstName},\n\nThanks for reaching out. Quick honesty: I'm selective about partnerships — gotta fit the audience (tradesmen, makers, small-business builders) and the values (no hype, no get-rich-quick, no AI-replaces-humans angle).\n\nIf that lines up, send over: the product/service, the actual ask (affiliate / sponsor / co-promo / something else), and a one-line "why us specifically." I'll get back inside the week.` + SIGNATURE
      };

    default:
      return null;
  }
}

// HIGH-tier signals: legal, financial, family, $ > 500, .gov/lawyer/IRS domains, threats.
// Returns true if any HIGH signal trips.
function detectHighTier({ from, subject, snippet }) {
  const hay = `${from || ''} ${subject || ''} ${snippet || ''}`.toLowerCase();
  // Domains: .gov, IRS, lawyer/attorney, court
  if (/(@[\w.-]+\.gov\b|irs\.gov|@.*\.(law|legal)\.|attorney|lawyer|court|subpoena)/.test(hay)) return 'gov_or_legal_domain';
  // Family signals (Tasia / kids by name) — extreme caution
  if (/(tasia|kids|school nurse|principal|pediatrician|hospital|er\b)/.test(hay)) return 'family_signal';
  // $ amount > 500 anywhere in subject/snippet
  const dollar = hay.match(/\$\s*([\d,]+(?:\.\d+)?)/);
  if (dollar) {
    const amt = parseFloat(dollar[1].replace(/,/g, ''));
    if (amt > 500) return `dollar_amount_${amt}`;
  }
  // Threats / disputes
  if (/(lawsuit|sue you|chargeback|fraud|threat|complaint|cease.?and.?desist)/.test(hay)) return 'threat_or_dispute';
  // Financial keywords without $ explicit
  if (/(wire transfer|bank account|routing number|w-9|w9|1099|tax form)/.test(hay)) return 'financial_keyword';
  return null;
}

module.exports = { chooseTemplate, renderDraft, detectHighTier, SIGNATURE };
