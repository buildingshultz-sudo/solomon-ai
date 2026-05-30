'use strict';
// nathan-bridge.js — Solomon → Nathan (Claude API) consultation bridge.
//
// Solomon calls consultNathan() when his confidence on a known template is
// 60–85% (silent consult) or whenever a template explicitly requires
// nathan-consult. Below 60% confidence Solomon escalates to Jed BEFORE
// calling Nathan — Nathan is for sharpening a known decision, not for
// inventing a new one from scratch.
//
// Hard safety rules:
//   • Solomon never impersonates Jed to Nathan — sender is always "solomon".
//   • Nathan cannot authorize FINANCIAL, LEGAL, or IRREVERSIBLE actions —
//     those always escalate to Jed regardless of Nathan's recommendation.
//   • If Nathan disagrees with the proposed action (agreement < 0.6 or
//     concerns are non-empty for an irreversible-class action), Solomon
//     abandons the action and flags Jed.
//   • Every consultation is appended to nathan-consult-log.json so Jed
//     can read the full audit trail.

require('dotenv').config({ path: '/root/solomon-v4/.env' });
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const LOG_PATH = path.join(__dirname, 'nathan-consult-log.json');
const MASTER_CONTEXT_PATH = path.join(__dirname, 'shultz_master_context.md');
const MODEL = process.env.MODEL || 'claude-sonnet-4-6';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// HARD: Nathan cannot authorize — always short-circuit straight to Jed.
// Per spec: financial, legal, irreversible. Plus sensitive_pii (Tasia/kids) which
// is too personal to ever auto-route. Public_brand goes in CAUTIOUS below — Nathan
// CAN authorize a routine FB reply / cross-post but is asked to sanity-check first.
const IRREVERSIBLE_CATEGORIES = new Set([
  'financial',      // bank transfers, payments, billing changes
  'legal',          // LLC filings, signed documents, contracts
  'irreversible',   // KDP publish, account deletion, password rotation
  'sensitive_pii'   // health, family, anything that touches Tasia / kids
]);

// SOFT: forces a Nathan consult even at high confidence, but Nathan CAN authorize.
// Used for brand-facing actions where we want a sanity check on tone / content
// without blocking Jed's explicit requests.
const CAUTIOUS_CATEGORIES = new Set([
  'public_brand'    // FB/IG/YT posts, comment replies, anything outward-facing
]);

function loadMasterContext() {
  try { return fs.readFileSync(MASTER_CONTEXT_PATH, 'utf8'); }
  catch (_) { return '(master context file missing)'; }
}

function appendLog(entry) {
  let log = [];
  try {
    if (fs.existsSync(LOG_PATH)) log = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'));
    if (!Array.isArray(log)) log = [];
  } catch (_) { log = []; }
  log.push(entry);
  // Cap log at 500 entries — older ones get rotated to a dated file.
  if (log.length > 500) {
    const cutoff = log.slice(0, log.length - 500);
    const stamp = new Date().toISOString().slice(0, 10);
    try { fs.writeFileSync(path.join(__dirname, `nathan-consult-log.${stamp}.json`), JSON.stringify(cutoff, null, 2)); } catch (_) {}
    log = log.slice(-500);
  }
  try { fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2)); } catch (e) {
    console.error('[NATHAN-BRIDGE] log append failed:', e.message);
  }
}

/**
 * Consult Nathan about a proposed action.
 *
 * @param {Object} query
 * @param {string} query.task                 short label (e.g. "fb_reply_draft")
 * @param {number} query.confidence           Solomon's confidence (0..1)
 * @param {string} query.context              free-text situational context
 * @param {string} query.proposed_action      what Solomon plans to do
 * @param {string} query.question             specific question for Nathan
 * @param {string[]} [query.categories]       any of IRREVERSIBLE_CATEGORIES that apply
 * @param {string} [query.template_id]        which template triggered this
 *
 * @returns {Promise<Object>} {
 *   agreement: 0..1,
 *   recommendation: "proceed" | "modify" | "abort" | "escalate_to_jed",
 *   modified_action: string|null,
 *   concerns: string[],
 *   reasoning: string,
 *   must_escalate: boolean      // true if categories include an irreversible one
 *                               //  regardless of Nathan's recommendation
 * }
 */
async function consultNathan(query) {
  const started = Date.now();
  const categories = Array.isArray(query.categories) ? query.categories : [];
  const isIrreversible = categories.some(c => IRREVERSIBLE_CATEGORIES.has(c));

  // Short-circuit: anything in an irreversible category must escalate to Jed.
  // We STILL log the would-be consultation so Jed can see what Solomon was
  // about to ask, but we do not actually call the API.
  if (isIrreversible) {
    const entry = {
      ts: new Date().toISOString(),
      template_id: query.template_id || null,
      sender: 'solomon',
      task: query.task,
      confidence: query.confidence,
      context: query.context,
      proposed_action: query.proposed_action,
      question: query.question,
      categories,
      bridge_action: 'short_circuit_irreversible',
      duration_ms: 0,
      result: { agreement: 0, recommendation: 'escalate_to_jed', modified_action: null,
                concerns: ['Action is in an irreversible category (' + categories.join(',') + ') — Nathan cannot authorize this.'],
                reasoning: 'Hard safety rail — financial/legal/irreversible/sensitive_pii/public_brand always go to Jed.',
                must_escalate: true }
    };
    appendLog(entry);
    return entry.result;
  }

  const systemPrompt =
`You are Nathan — the Claude chat strategist on the Shultz Enterprises team. You are NOT Jedidiah. The caller is *Solomon*, the Telegram-bot operator running on the VPS. Solomon is asking you for a quick second opinion on a proposed action.

CONTEXT (from /root/solomon-v4/shultz_master_context.md — the single source of truth):
${loadMasterContext()}

YOUR ROLE WHEN SOLOMON ASKS:
- You sharpen Solomon's decision on a KNOWN template. You do NOT invent new strategy from scratch — if Solomon needs new strategy, tell him to escalate to Jed.
- You filter every decision through Jed's mission: does this serve the Tuesday vision? More family time, less computer time?
- You push back when something feels off — concerns matter even if you ultimately agree.
- You NEVER authorize: financial moves, legal filings, irreversible actions, anything touching Tasia/kids/PII, or anything posted to a public Building Shultz channel. If Solomon proposes any of those, recommend escalate_to_jed.
- You respond ONLY in compact JSON, no preamble, no markdown. Schema:
  {"agreement": 0..1, "recommendation": "proceed" | "modify" | "abort" | "escalate_to_jed", "modified_action": "if modify, the revised action; else null", "concerns": ["short bullet", ...], "reasoning": "1-2 sentences"}`;

  const userBody = JSON.stringify({
    sender: 'solomon',
    task: query.task,
    template_id: query.template_id || null,
    confidence: query.confidence,
    context: query.context,
    proposed_action: query.proposed_action,
    question: query.question,
    categories
  }, null, 2);

  let result, raw, err;
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 800,
      system: systemPrompt,
      messages: [{ role: 'user', content: userBody }]
    });
    raw = (resp.content.find(b => b.type === 'text') || {}).text || '';
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Nathan did not return JSON');
    result = JSON.parse(m[0]);
    // Normalize fields
    if (typeof result.agreement !== 'number') result.agreement = 0.5;
    if (!result.recommendation) result.recommendation = 'escalate_to_jed';
    if (!Array.isArray(result.concerns)) result.concerns = [];
    if (typeof result.modified_action !== 'string') result.modified_action = null;
    if (typeof result.reasoning !== 'string') result.reasoning = '';
    result.must_escalate = false;
  } catch (e) {
    err = e.message;
    // If Nathan errors out, fail safe → escalate to Jed.
    result = {
      agreement: 0,
      recommendation: 'escalate_to_jed',
      modified_action: null,
      concerns: ['Nathan bridge call failed: ' + err],
      reasoning: 'API error — failing safe to Jed.',
      must_escalate: true
    };
  }

  const entry = {
    ts: new Date().toISOString(),
    template_id: query.template_id || null,
    sender: 'solomon',
    task: query.task,
    confidence: query.confidence,
    context: query.context,
    proposed_action: query.proposed_action,
    question: query.question,
    categories,
    bridge_action: err ? 'api_error' : 'consulted',
    duration_ms: Date.now() - started,
    raw_response: raw ? raw.slice(0, 4000) : null,
    error: err || null,
    result
  };
  appendLog(entry);
  return result;
}

module.exports = { consultNathan, IRREVERSIBLE_CATEGORIES, CAUTIOUS_CATEGORIES };
