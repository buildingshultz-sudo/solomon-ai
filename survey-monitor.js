'use strict';
// survey-monitor.js — TradeQuote contractor survey response handler.
// dispatch_1780784789086. Called per-email by scheduler.js's existing IMAP triage
// loop (same pattern as the klein watcher) so it shares the one check_inbox poll
// and never races the UID tracker:
//   await survey.processSurveyEmail(em, { db, mem, bot, OWNER_ID })
// On a matching reply it: (2) auto-sends a thank-you, (3) extracts the 5 answers
// with Claude + Telegrams Nathan a structured report, (4) logs to master context.

const Anthropic = require('@anthropic-ai/sdk');
const { executeTool } = require('./tools.js');

const SURVEY_SUBJECT_RE = /5 honest questions from a fellow trades guy/i;
const SELF = String(process.env.SMTP_USER || 'buildingshultz@gmail.com').toLowerCase();
const AUTORESPOND = String(process.env.SURVEY_AUTORESPOND || 'true').toLowerCase() === 'true';
const MODEL = process.env.SURVEY_MODEL || 'claude-sonnet-4-5-20250929';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function isSurveyReply(em) {
  return !!(em && em.subject && SURVEY_SUBJECT_RE.test(em.subject));
}
function firstName(em) {
  const n = String((em && em.from_name) || '').trim();
  if (!n || n.includes('@') || /unknown/i.test(n)) return '';
  return n.split(/\s+/)[0].replace(/[^A-Za-z'-]/g, '');
}
function thankYouBody(name) {
  const hi = name ? `Hey ${name},` : 'Hey,';
  return `${hi} really appreciate you taking the time to respond — this kind of honest feedback is exactly what I need before I build anything. I'll be reviewing everything carefully. If anything else comes to mind or you have questions, don't hesitate to reply.\n\n— Jed Shultz, Valparaiso IN, buildingshultz@gmail.com`;
}

async function extractAnswers(body) {
  const out = { Q1: 'not answered', Q2: 'not answered', Q3: 'not answered', Q4: 'not answered', Q5: 'not answered', followups: 'none' };
  if (!body || !body.trim()) return out;
  try {
    const sys = [
      "You extract survey answers from a contractor's email reply. The 5 questions asked were:",
      "Q1: the last time you underquoted a job (what happened);",
      "Q2: your current quoting/estimating process;",
      "Q3: the biggest time drain in your business;",
      "Q4: if you could hand off one task, what would it be;",
      "Q5: whether you've tried any quoting/estimating software or tools.",
      'Return ONLY compact JSON: {"Q1":"","Q2":"","Q3":"","Q4":"","Q5":"","followups":""}.',
      'Each value = the contractor answer in their own words (concise) or "not answered" if that question was not addressed.',
      'followups = any question THEY asked Jed, or "none".'
    ].join(' ');
    const r = await anthropic.messages.create({
      model: MODEL, max_tokens: 700, system: sys,
      messages: [{ role: 'user', content: String(body).slice(0, 4000) }]
    });
    const txt = (r.content.find(b => b.type === 'text') || {}).text || '';
    const m = txt.match(/\{[\s\S]*\}/);
    if (m) { const j = JSON.parse(m[0]); for (const k of ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'followups']) if (j[k]) out[k] = String(j[k]).slice(0, 400); }
  } catch (e) { out._error = String(e.message).slice(0, 120); }
  return out;
}

function buildReport(em, a, sent, body) {
  const who = (em.from_name && !String(em.from_name).includes('@')) ? em.from_name : (em.from_email || 'unknown');
  return `📋 TradeQuote Survey Response — ${who}  ${em.date || new Date().toISOString()}\n` +
    `Q1 (Last underquote): ${a.Q1}\n` +
    `Q2 (Quoting process): ${a.Q2}\n` +
    `Q3 (Biggest time drain): ${a.Q3}\n` +
    `Q4 (Hand off one thing): ${a.Q4}\n` +
    `Q5 (Tried any tools): ${a.Q5}\n` +
    `Follow-up questions from them: ${a.followups}\n` +
    `Thank-you email: ${sent}\n` +
    `Raw reply: ${String(body).slice(0, 500)}`;
}

// Per-email entry point. Returns true if it handled a survey reply, else false.
async function processSurveyEmail(em, ctx) {
  if (!isSurveyReply(em)) return false;
  if (String((em.from_email) || '').toLowerCase() === SELF) return false; // ignore our own sent copies
  const { db, mem, bot, OWNER_ID } = ctx || {};
  const key = String(em.uid || (em.from_email + '|' + em.date));
  try { if (mem && mem.get('survey_handled', key)) return false; } catch (_) {}

  const body = em.body_text_full || em.body_snippet || '';
  const name = firstName(em);

  // STEP 2 — thank-you (auto, kill-switch SURVEY_AUTORESPOND).
  let sent = 'skipped (SURVEY_AUTORESPOND=false)';
  if (AUTORESPOND && em.from_email && em.from_email.includes('@')) {
    try {
      const subj = /^re:/i.test(em.subject) ? em.subject : ('Re: ' + em.subject);
      const r = await executeTool('send_email', { to: em.from_email, subject: subj, body: thankYouBody(name) });
      sent = (r && r.ok) ? 'sent' : ('failed: ' + (r && r.error));
    } catch (e) { sent = 'failed: ' + String(e.message).slice(0, 100); }
  }

  // STEP 3 — extract + report to Nathan (Telegram owner chat).
  const a = await extractAnswers(body);
  const report = buildReport(em, a, sent, body);
  try { if (bot && OWNER_ID) await bot.sendMessage(OWNER_ID, report); } catch (_) {}

  // STEP 4 — master-context summary (append-only, same as triage's REVENUE log).
  const who = (em.from_name && !String(em.from_name).includes('@')) ? em.from_name : (em.from_email || 'unknown');
  try {
    await executeTool('append_master_context', {
      section: 'GENERAL',
      entry: `TradeQuote survey reply from ${who}: thank-you ${sent}. Answered ${['Q1','Q2','Q3','Q4','Q5'].filter(k => a[k] && a[k] !== 'not answered').length}/5; followups: ${a.followups === 'none' ? 'none' : 'yes'}.`.slice(0, 950)
    });
  } catch (_) {}

  try { if (mem) mem.set('survey_handled', key, new Date().toISOString()); } catch (_) {}
  try { if (db) db.prepare('INSERT INTO activity_log (type, summary) VALUES (?, ?)').run('survey_response', `${who} | thankyou=${sent}`); } catch (_) {}
  return true;
}

module.exports = { processSurveyEmail, isSurveyReply, extractAnswers, thankYouBody, firstName, buildReport };
