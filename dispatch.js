'use strict';
// dispatch.js — Solomon's intent classifier + router.
//
// Loads all templates from /root/solomon-v4/dispatch-templates/.
// classifyAndRoute(message, opts) → {template, confidence, inputs, decision, action_result}
//
// decision is one of:
//   "execute_direct"  (confidence ≥ EXECUTE_THRESHOLD, irreversible=false)
//   "consult_nathan"  (confidence between thresholds — silent consult then execute/abort)
//   "escalate_jed"    (no template, low confidence, or irreversible)
//
// SAFETY: in shadow mode (mem('dispatch','mode') === 'shadow') we run the full
// classify+route+nathan-consult pipeline but do NOT actually fire any handler —
// we log what would have happened. Default is shadow until Jed flips it to live.

require('dotenv').config({ path: '/root/solomon-v4/.env' });
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { consultNathan, IRREVERSIBLE_CATEGORIES, CAUTIOUS_CATEGORIES } = require('./nathan-bridge');

const TEMPLATES_DIR = path.join(__dirname, 'dispatch-templates');
const SAM_QUEUE_DIR = path.join(__dirname, 'sam-queue');
const SHADOW_LOG_PATH = path.join(__dirname, 'dispatch-shadow-log.json');
const MODEL = process.env.MODEL || 'claude-sonnet-4-6';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const EXECUTE_THRESHOLD = 0.85;
const CONSULT_THRESHOLD = 0.60;

// ── TEMPLATE LOADING ──────────────────────────────────────────────────────
let _templateCache = null;
let _templateCacheLoadedAt = 0;
function loadTemplates(force = false) {
  const now = Date.now();
  if (!force && _templateCache && (now - _templateCacheLoadedAt) < 60_000) return _templateCache;
  const templates = [];
  try {
    const files = fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.json'));
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(TEMPLATES_DIR, f), 'utf8');
        const t = JSON.parse(raw);
        if (t.id && t.handler) templates.push(t);
      } catch (e) {
        console.error('[DISPATCH] failed to load template', f, e.message);
      }
    }
  } catch (e) {
    console.error('[DISPATCH] templates dir read failed:', e.message);
  }
  _templateCache = templates;
  _templateCacheLoadedAt = now;
  return templates;
}

// ── MODE (shadow by default) ───────────────────────────────────────────────
function getMode(memOpt) {
  // memOpt is optional injected memory module; otherwise read .env override.
  if (memOpt) {
    const v = memOpt.get && memOpt.get('dispatch', 'mode');
    if (v === 'live' || v === 'shadow') return v;
  }
  return process.env.DISPATCH_MODE === 'live' ? 'live' : 'shadow';
}

// ── CLASSIFIER ─────────────────────────────────────────────────────────────
async function classifyMessage(message, templates) {
  // Compact catalogue for the model — keep it light. The model returns a
  // template id (or null), confidence 0..1, and a flat {var:value} inputs map.
  const catalogue = templates.map(t => ({
    id: t.id,
    description: t.description,
    handler: t.handler,
    required_inputs: t.required_inputs || [],
    triggers: t.trigger_examples || []
  }));

  const system =
`You are the dispatch classifier inside Solomon — Jed Shultz's Telegram chief-of-staff bot. Given Jed's message, pick the SINGLE best-matching pre-approved template from the catalogue (or null if nothing is a strong fit). Extract whatever inputs you can from the message; leave unknown ones blank.

Respond ONLY in compact JSON, no preamble, no code fences:
{"template_id": "<id_or_null>", "confidence": 0.0..1.0, "inputs": {"var": "value", ...}, "rationale": "one sentence"}

Confidence guidance:
- 0.90+  exact match, all required inputs extractable
- 0.70   probable match, may need Nathan to confirm interpretation
- 0.50   weak match, multiple plausible templates
- <0.40  no template fits — return template_id null

Templates catalogue:
${JSON.stringify(catalogue, null, 2)}`;

  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 600,
    system,
    messages: [{ role: 'user', content: message }]
  });
  const txt = (resp.content.find(b => b.type === 'text') || {}).text || '';
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return { template_id: null, confidence: 0, inputs: {}, rationale: 'classifier returned no JSON' };
  let parsed; try { parsed = JSON.parse(m[0]); } catch (_) { parsed = null; }
  if (!parsed) return { template_id: null, confidence: 0, inputs: {}, rationale: 'classifier JSON parse failed' };
  parsed.template_id = parsed.template_id || null;
  parsed.confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
  parsed.inputs = parsed.inputs || {};
  parsed.rationale = parsed.rationale || '';
  return parsed;
}

// ── ROUTER ─────────────────────────────────────────────────────────────────
function fillTemplate(promptTemplate, inputs) {
  return String(promptTemplate || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) =>
    (inputs && inputs[k] != null) ? String(inputs[k]) : `[[MISSING:${k}]]`
  );
}

function missingInputs(template, inputs) {
  const req = template.required_inputs || [];
  return req.filter(k => !inputs || inputs[k] == null || inputs[k] === '');
}

async function writeSamJob(template, inputs, filledPrompt, classification, nathanResult) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(SAM_QUEUE_DIR, `${ts}-${template.id}.json`);
  const job = {
    task: template.name,
    template_id: template.id,
    handler: 'sam',
    variables: inputs,
    filled_prompt: filledPrompt,
    priority: template.priority || 'normal',
    created: new Date().toISOString(),
    classifier: classification,
    nathan_consult: nathanResult || null,
    escalation_flag: false,
    status: 'pending'
  };
  fs.writeFileSync(file, JSON.stringify(job, null, 2));
  return { file, job };
}

function buildCalebPayload(template, inputs, filledPrompt, classification, nathanResult) {
  // The actual POST happens in caleb-relay.js — this just shapes the payload.
  return {
    task: template.name,
    template_id: template.id,
    handler: 'caleb',
    variables: inputs,
    filled_prompt: filledPrompt,
    step_by_step: template.caleb_steps || [],
    priority: template.priority || 'normal',
    created: new Date().toISOString(),
    classifier: classification,
    nathan_consult: nathanResult || null
  };
}

function appendShadowLog(entry) {
  let log = [];
  try {
    if (fs.existsSync(SHADOW_LOG_PATH)) log = JSON.parse(fs.readFileSync(SHADOW_LOG_PATH, 'utf8'));
    if (!Array.isArray(log)) log = [];
  } catch (_) { log = []; }
  log.push(entry);
  if (log.length > 500) log = log.slice(-500);
  try { fs.writeFileSync(SHADOW_LOG_PATH, JSON.stringify(log, null, 2)); } catch (_) {}
}

/**
 * The main entry point. opts.mem (memory module from bot.js) lets the dispatcher
 * read mem('dispatch','mode'). opts.executors is an optional map of handler →
 * async fn(template, inputs, filledPrompt, ctx) so this module stays decoupled
 * from bot.js. opts.dryRun = true forces shadow mode regardless of memory.
 */
async function classifyAndRoute(message, opts = {}) {
  const templates = loadTemplates(opts.forceReload);
  const classification = await classifyMessage(message, templates);
  const mode = opts.dryRun ? 'shadow' : getMode(opts.mem);

  let template = null;
  if (classification.template_id) {
    template = templates.find(t => t.id === classification.template_id) || null;
  }

  // ── DECISION TREE ──
  let decision, reason;
  const templateCategories = (template && Array.isArray(template.categories)) ? template.categories : [];
  const hasIrreversibleCategory = templateCategories.some(c => IRREVERSIBLE_CATEGORIES.has(c));
  const hasCautiousCategory = templateCategories.some(c => CAUTIOUS_CATEGORIES.has(c));
  if (!template) {
    decision = 'escalate_jed';
    reason = `No template matched (rationale: ${classification.rationale || 'n/a'})`;
  } else if (template.irreversible === true) {
    decision = 'escalate_jed';
    reason = `Template '${template.id}' is marked irreversible — Jed approval required`;
  } else if (missingInputs(template, classification.inputs).length > 0) {
    decision = 'escalate_jed';
    reason = `Missing required inputs: ${missingInputs(template, classification.inputs).join(', ')}`;
  } else if (template.handler === 'jed-escalate') {
    decision = 'escalate_jed';
    reason = `Template '${template.id}' always escalates to Jed`;
  } else if (hasIrreversibleCategory) {
    // financial / legal / irreversible / sensitive_pii — always Jed. We route
    // through consult_nathan so the bridge short-circuits + logs the would-be
    // consult, then bumps to escalate_jed.
    decision = 'consult_nathan';
    reason = `Template '${template.id}' has hard-safety category [${templateCategories.filter(c => IRREVERSIBLE_CATEGORIES.has(c)).join(',')}] — Jed approval required`;
  } else if (hasCautiousCategory) {
    // public_brand — Nathan sanity-checks but CAN authorize routine cases.
    decision = 'consult_nathan';
    reason = `Template '${template.id}' has cautious category [${templateCategories.filter(c => CAUTIOUS_CATEGORIES.has(c)).join(',')}] — Nathan sanity check first`;
  } else if (template.handler === 'nathan-consult') {
    decision = 'consult_nathan';
    reason = `Template '${template.id}' explicitly requires Nathan consultation`;
  } else if (classification.confidence >= EXECUTE_THRESHOLD) {
    decision = 'execute_direct';
    reason = `Confidence ${classification.confidence.toFixed(2)} ≥ ${EXECUTE_THRESHOLD}`;
  } else if (classification.confidence >= CONSULT_THRESHOLD) {
    decision = 'consult_nathan';
    reason = `Confidence ${classification.confidence.toFixed(2)} in ${CONSULT_THRESHOLD}..${EXECUTE_THRESHOLD} band`;
  } else {
    decision = 'escalate_jed';
    reason = `Confidence ${classification.confidence.toFixed(2)} below ${CONSULT_THRESHOLD}`;
  }

  // ── NATHAN CONSULT (if applicable) ──
  let nathanResult = null;
  if (decision === 'consult_nathan' && template) {
    const filled = fillTemplate(template.prompt_template, classification.inputs);
    nathanResult = await consultNathan({
      task: template.id,
      template_id: template.id,
      confidence: classification.confidence,
      context: `Jed message: "${message}". Inputs extracted: ${JSON.stringify(classification.inputs)}`,
      proposed_action: filled.slice(0, 1200),
      question: `Should Solomon proceed with this ${template.handler} action as drafted?`,
      categories: template.categories || []
    });
    if (nathanResult.must_escalate || nathanResult.recommendation === 'escalate_to_jed' || nathanResult.recommendation === 'abort') {
      decision = 'escalate_jed';
      reason = `Nathan: ${nathanResult.recommendation} — ${nathanResult.reasoning || (nathanResult.concerns || []).join('; ')}`;
    } else {
      // Nathan said proceed (possibly with modification)
      if (nathanResult.recommendation === 'modify' && nathanResult.modified_action) {
        // Stash the modified action; Solomon will use it
      }
      decision = 'execute_after_nathan';
      reason = `Nathan agreement ${nathanResult.agreement}: ${nathanResult.recommendation}`;
    }
  }

  // ── ACTION ──
  const filledPrompt = template ? fillTemplate(template.prompt_template, classification.inputs) : null;
  let actionResult = null;

  if (mode === 'shadow') {
    appendShadowLog({
      ts: new Date().toISOString(),
      message,
      classification,
      template_id: template?.id || null,
      decision,
      reason,
      nathan_result: nathanResult,
      would_have: template ? `route to ${template.handler}` : 'escalate to Jed'
    });
    actionResult = { mode: 'shadow', message: 'Logged to dispatch-shadow-log.json — no side effects.' };
  } else if (decision === 'escalate_jed') {
    actionResult = { mode: 'live', kind: 'escalate', summary: `This needs Nathan — ${reason}` };
  } else if (decision === 'execute_direct' || decision === 'execute_after_nathan') {
    const ctx = { classification, nathanResult, decision, reason };
    if (template.handler === 'sam') {
      const w = await writeSamJob(template, classification.inputs, filledPrompt, classification, nathanResult);
      actionResult = { mode: 'live', kind: 'sam_queued', file: w.file, job_id: path.basename(w.file, '.json') };
    } else if (template.handler === 'caleb') {
      actionResult = { mode: 'live', kind: 'caleb_payload', payload: buildCalebPayload(template, classification.inputs, filledPrompt, classification, nathanResult) };
    } else if (template.handler === 'solomon') {
      if (opts.executors && typeof opts.executors.solomon === 'function') {
        actionResult = { mode: 'live', kind: 'solomon_executed', result: await opts.executors.solomon(template, classification.inputs, filledPrompt, ctx) };
      } else {
        actionResult = { mode: 'live', kind: 'solomon_no_executor', summary: 'No solomon executor wired — bot.js must provide opts.executors.solomon' };
      }
    } else {
      actionResult = { mode: 'live', kind: 'unknown_handler', summary: `Unknown handler: ${template.handler}` };
    }
  }

  return {
    template,
    classification,
    confidence: classification.confidence,
    inputs: classification.inputs,
    decision,
    reason,
    filled_prompt: filledPrompt,
    nathan_consult: nathanResult,
    action_result: actionResult,
    mode
  };
}

module.exports = {
  classifyAndRoute,
  classifyMessage,
  loadTemplates,
  fillTemplate,
  missingInputs,
  EXECUTE_THRESHOLD,
  CONSULT_THRESHOLD
};
