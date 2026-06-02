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
const { dispatchThresholds, db } = require('./memory');

const TEMPLATES_DIR = path.join(__dirname, 'dispatch-templates');
const SAM_QUEUE_DIR = path.join(__dirname, 'sam-queue');
const SHADOW_LOG_PATH = path.join(__dirname, 'dispatch-shadow-log.json');
const MODEL = process.env.MODEL || 'claude-sonnet-4-6';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// T0-B: per-template threshold overrides (auto-tuned weekly from jed_patterns).
// EXECUTE_THRESHOLD is the global default; getExecuteThreshold(template_id)
// returns the per-template override if one exists in dispatch_thresholds.
const EXECUTE_THRESHOLD = 0.85;
const CONSULT_THRESHOLD = 0.60;
function getExecuteThreshold(template_id) {
  try { return dispatchThresholds.get(template_id); } catch (_) { return EXECUTE_THRESHOLD; }
}

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

# Step 1 — INTENT classification (BEFORE matching keywords)

Classify Jed's INTENT first, then match. Keywords overlap heavily between lookup / build / action templates — use the rubric below, not keyword matching.

**LOOKUP intent** — Jed wants to RETRIEVE existing information from somewhere Solomon already knows. Verbs: "what is", "show me", "give me", "find", "where is", "when did", "how many", "remind me", "resend", "what's the status of", "look up", "check", "tell me". Result is read-only — no new state, no posts, no sends. Examples:
- "what is the LLC confirmation number"        -> simple_query (or check_budget / status_check if dedicated)
- "resend the YouTube OAuth URL"                -> simple_query
- "when did we last post on Facebook"           -> simple_query
- "show me my open tasks"                       -> simple_query (or /tasks slash command if dedicated)
- "what's my YouTube subscriber count"          -> simple_query (or send_morning_brief if dedicated)

**BUILD intent** — Jed wants Sam (Claude Code, that's me) to write/ship/fix CODE or a feature. Verbs: "build me", "add", "create a tool", "wire up", "implement", "fix the bug", "make it so", "ship", "scaffold". Result modifies code on the VPS. Examples:
- "build me a /reminders slash command"         -> sam_build_feature
- "add a Stripe audit tool"                     -> sam_build_feature

**ACTION intent** — Jed wants Solomon to DO something with a side effect (post, send, reply, launch, generate). Verbs: "post", "send", "reply", "launch", "stop", "generate", "draft and send". Result is a Telegram / FB / email / image / etc. with a real-world effect. Examples:
- "send an email to john@..."                   -> solomon_send_email
- "post this to all socials: ..."               -> solomon_cross_post
- "generate a book cover image"                 -> solomon_generate_image

**Tiebreaker when intent is ambiguous**: prefer LOOKUP over BUILD or ACTION (cheapest fallback if you're unsure). Choosing lookup when Jed wanted build = he says "no, build it" — cheap recovery. Choosing build when he wanted lookup = unnecessary code change. So when in doubt, lookup.

**Trap to avoid**: keyword overlap. "Can you find me a Stripe audit" is a LOOKUP ("find me" = retrieve), even though "Stripe audit" matches sam_stripe_audit's trigger. Look at the VERB, not the noun. "FIND the Stripe audit" = look it up; "RUN the Stripe audit" = action.

# Step 2 — Pick the right LOOKUP template

If the lookup hits a DEDICATED template, use it (more specific):
- "budget" / "API spend" / "how close to hard stop" → solomon_check_budget
- "status" / "are you up" / "system check" → solomon_status_check
- "brief" / "scorecard" / "morning rundown" → solomon_send_morning_brief
- "tasks" / "my open tasks" / "what's on my list" → (slash command /tasks handles this; if dispatched as natural language, falls into simple_query)

Otherwise the catch-all is **simple_query** — for everything lookup-shaped that doesn't have a dedicated template. Extract Jed's question verbatim into the "question" input field.

# Step 3 — Confidence rubric (be decisive — under-confidence wastes a Nathan API call)

Score **0.90 or higher** when ALL of:
- The intent is unambiguous (one template clearly matches, others are far weaker).
- Every required input is extractable from the message — or the template has no required inputs.
- The phrasing matches one of the template's trigger_examples in shape OR uses an obvious synonym ("get me X" ≈ "give me X" ≈ "send me X" ≈ "show me X").
- Jed is the implied actor (he said "do X" / "run X" / "show me X") — not a hypothetical question about whether to do X.
- No safety category is triggered by Jed's wording (no money, legal, irreversible, PII).

Score **0.85–0.89** when the template match is clearly best, all required inputs are present, but the phrasing is novel enough that one human reviewer in ten might disagree.

Score **0.60–0.84** when there's a probable match but: one required input is partly inferred, OR two templates could fit and you're picking the better one, OR the phrasing is genuinely ambiguous.

Score **0.40–0.59** when the message could plausibly hit a template but is weak — pick the closest template_id anyway so Nathan can decide.

Score **below 0.40** OR set template_id to null only when no template is a credible fit. Don't force a match into a template that doesn't actually serve the request.

# Decisive tiebreakers (apply in order)

1. If the message names a slash command equivalent ("status", "stats", "brief", "budget", "launch", "stop the campaign", "generate <prompt>", etc.) — match the corresponding template at 0.95+ confidence. These are deterministic.
2. If the message explicitly addresses an agent by name ("sam: ...", "caleb: ...", "ask nathan ...") — that's strong signal for sam_*/caleb_*/nathan_* templates respectively. Bump by +0.10.
3. If the message contains money amounts, legal verbs ("file", "sign", "transfer", "publish"), or anything irreversible — DO NOT inflate confidence; let the safety category gate handle it. Match to the appropriate jed_escalate_* template at high confidence.
4. If two templates fit equally well, prefer the one whose required_inputs are 100% extractable from the message.

# Few-shot anchors (match the shape, not just the exact wording)

Jed: "what's my API budget at this month?"        → {"template_id":"solomon_check_budget","confidence":0.96,"inputs":{},"rationale":"explicit budget query, no inputs needed"}
Jed: "send me the morning brief"                   → {"template_id":"solomon_send_morning_brief","confidence":0.96,"inputs":{},"rationale":"on-demand brief, no inputs"}
Jed: "generate a moody jobsite at sunrise"         → {"template_id":"solomon_generate_image","confidence":0.95,"inputs":{"prompt":"moody jobsite at sunrise"},"rationale":"image gen request, prompt cleanly extractable"}
Jed: "stop the campaign"                            → {"template_id":"solomon_campaign_stop","confidence":0.96,"inputs":{},"rationale":"verbatim campaign-stop"}
Jed: "post this to all socials: <content>"          → {"template_id":"solomon_cross_post","confidence":0.93,"inputs":{"content":"<content>"},"rationale":"explicit cross-post phrasing; content trivially extracted"}
Jed: "reply to FB comment 99 on building_shultz with: thanks brother" → {"template_id":"solomon_fb_reply","confidence":0.94,"inputs":{"page":"building_shultz","comment_id":"99","reply_text":"thanks brother"},"rationale":"all three inputs explicit"}
Jed: "publish the kdp book"                         → {"template_id":"jed_escalate_kdp_publish","confidence":1.00,"inputs":{},"rationale":"irreversible — always Jed"}
Jed: "should I elect s-corp yet?"                   → {"template_id":"future_solomon_s_corp_threshold","confidence":0.88,"inputs":{},"rationale":"financial/legal advisory — routes via Nathan to Jed"}
Jed: "what's up?"                                   → {"template_id":null,"confidence":0.10,"inputs":{},"rationale":"conversational, no template"}

# Templates catalogue
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
// Question pre-detector. Fires when a message is unambiguously a question and
// is NOT phrased as a task request. Returns null if not a question; otherwise
// returns a short reason string that the caller surfaces via decision='direct_answer'.
// Bot.js consumes 'direct_answer' the same way it consumes consult_nathan /
// escalate_jed: fall through to askSolomon().
const QUESTION_WH_STARTS = /^\s*(how|what|why|when|where|who|whom|whose|which|can|could|should|would|will|is|are|am|was|were|do|does|did|has|have|had)\b/i;
const QUESTION_TASK_OVERRIDE = /\b(build me|build a|add a|create a|set up|fix the|fix that|update the|update my|send|post|email|run|deploy|publish|generate|launch|schedule|cancel|delete|remove|kill|restart|reboot|reset|rotate)\b/i;
function detectDirectAnswer(message) {
  if (!message || typeof message !== 'string') return null;
  const trimmed = message.trim();
  if (!trimmed) return null;
  const endsWithQ = /\?\s*$/.test(trimmed);
  const startsWithWh = QUESTION_WH_STARTS.test(trimmed);
  if (!endsWithQ && !startsWithWh) return null;
  // Override: if the message also has explicit task intent ("can you build me X?", "could you send Y?"),
  // let the normal classifier route it — it's a task request phrased as a question.
  if (QUESTION_TASK_OVERRIDE.test(trimmed)) return null;
  return endsWithQ ? 'ends-with-? (no task verb)' : 'wh-word start (no task verb)';
}

async function classifyAndRoute(message, opts = {}) {
  // ── DIRECT-ANSWER PRE-STEP ──
  // Cheap detector that short-circuits the LLM classifier when the message is
  // clearly a question (and not a task phrased as one). Saves a Claude call +
  // keeps Telegram chat snappy for "how do I X?"-style asks.
  const directReason = detectDirectAnswer(message);
  if (directReason) {
    try {
      db.prepare(`INSERT INTO activity_log (type, summary) VALUES (?, ?)`).run(
        'direct_answer',
        JSON.stringify({ question: message.slice(0, 280), reason: directReason })
      );
    } catch (_) {}
    return {
      decision: 'direct_answer',
      template: null,
      template_id: null,
      classification: { template_id: null, confidence: null, inputs: {}, rationale: 'question pre-detector: ' + directReason },
      reason: directReason,
      action_result: null,
      mode: opts.dryRun ? 'shadow' : getMode(opts.mem)
    };
  }

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
  } else if (classification.confidence >= getExecuteThreshold(template.id)) {
    const thr = getExecuteThreshold(template.id);
    decision = 'execute_direct';
    reason = `Confidence ${classification.confidence.toFixed(2)} ≥ ${thr.toFixed(2)} (template-specific)`;
  } else if (classification.confidence >= CONSULT_THRESHOLD) {
    const thr = getExecuteThreshold(template.id);
    decision = 'consult_nathan';
    reason = `Confidence ${classification.confidence.toFixed(2)} in ${CONSULT_THRESHOLD}..${thr.toFixed(2)} band`;
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
