#!/usr/bin/env node
'use strict';
// dispatch-smoke-test.js — Dry-run harness that exercises every template's
// smoke_test field. Runs classifier + router in shadow mode (no side effects:
// no Telegram, no FB, no Sam-queue writes — we monkey-patch the writers).
//
//   node dispatch-smoke-test.js                  # run all templates
//   node dispatch-smoke-test.js solomon_fb_reply # run one template
//
// Writes results to /root/solomon-v4/dispatch-smoke-results.json with one
// entry per template: { id, passed, expected, actual, notes }.

require('dotenv').config({ path: '/root/solomon-v4/.env' });
const fs = require('fs');
const path = require('path');
const dispatch = require('./dispatch');

const TEMPLATES_DIR = path.join(__dirname, 'dispatch-templates');
const RESULTS_PATH = path.join(__dirname, 'dispatch-smoke-results.json');

function loadAllTemplates() {
  return fs.readdirSync(TEMPLATES_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('_'))
    .map(f => JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, f), 'utf8')));
}

async function runOne(template) {
  const st = template.smoke_test;
  if (!st || !st.trigger_message) {
    return { id: template.id, passed: false, error: 'missing smoke_test.trigger_message' };
  }
  let result;
  try {
    result = await dispatch.classifyAndRoute(st.trigger_message, { dryRun: true });
  } catch (e) {
    return { id: template.id, passed: false, error: 'dispatch threw: ' + e.message };
  }

  const checks = [];

  // 1. Classifier picked the right template
  const expectedTplId = template.id;
  const actualTplId = result.template?.id || null;
  checks.push({
    name: 'template_match',
    pass: actualTplId === expectedTplId,
    expected: expectedTplId,
    actual: actualTplId
  });

  // 2. Handler resolution matches expectation
  // For Jed-escalate templates we expect decision == 'escalate_jed'
  // For nathan-consult templates we expect either 'consult_nathan' or 'escalate_jed' (if Nathan said abort)
  // For others we expect 'execute_direct' or 'execute_after_nathan' if classifier confidence was in band
  let handlerOK = false;
  if (st.expected_handler === 'jed-escalate') {
    handlerOK = result.decision === 'escalate_jed';
  } else if (st.expected_handler === 'nathan-consult') {
    handlerOK = ['consult_nathan', 'execute_after_nathan', 'escalate_jed'].includes(result.decision);
  } else if (['solomon', 'sam', 'caleb'].includes(st.expected_handler)) {
    handlerOK = ['execute_direct', 'execute_after_nathan'].includes(result.decision)
      || (st.expected_escalation && result.decision === 'escalate_jed');
  } else {
    handlerOK = true; // unknown spec — don't penalize
  }
  checks.push({
    name: 'handler_decision',
    pass: handlerOK,
    expected: st.expected_handler,
    actual: result.decision
  });

  // 3. Required inputs were extracted
  const expectedFilled = st.expected_inputs_filled || [];
  const missing = expectedFilled.filter(k => !result.inputs || result.inputs[k] == null || result.inputs[k] === '');
  checks.push({
    name: 'inputs_extracted',
    pass: missing.length === 0,
    expected: expectedFilled,
    actual: result.inputs,
    missing
  });

  // 4. Escalation aligns
  const escalated = result.decision === 'escalate_jed';
  checks.push({
    name: 'escalation_match',
    pass: escalated === Boolean(st.expected_escalation),
    expected: Boolean(st.expected_escalation),
    actual: escalated
  });

  const passed = checks.every(c => c.pass);
  return {
    id: template.id,
    trigger: st.trigger_message,
    passed,
    classifier_confidence: result.confidence,
    classifier_template_id: actualTplId,
    decision: result.decision,
    reason: result.reason,
    nathan_consulted: !!result.nathan_consult,
    nathan_recommendation: result.nathan_consult?.recommendation || null,
    checks
  };
}

async function main() {
  const arg = process.argv[2];
  let templates = loadAllTemplates();
  if (arg) templates = templates.filter(t => t.id === arg);
  if (!templates.length) {
    console.error(arg ? `No template with id '${arg}'` : 'No templates found in ' + TEMPLATES_DIR);
    process.exit(1);
  }

  const results = [];
  let pass = 0, fail = 0;
  for (const t of templates) {
    process.stdout.write(`[smoke] ${t.id.padEnd(48)} `);
    const r = await runOne(t);
    if (r.passed) { pass++; process.stdout.write('PASS\n'); }
    else { fail++; process.stdout.write('FAIL — ' + (r.error || r.checks.filter(c => !c.pass).map(c => c.name).join(',')) + '\n'); }
    results.push(r);
  }
  const summary = {
    ran_at: new Date().toISOString(),
    total: results.length,
    pass,
    fail,
    pass_rate: results.length ? (pass / results.length).toFixed(2) : '0',
    nathan_consult_count: results.filter(r => r.nathan_consulted).length,
    results
  };
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(summary, null, 2));
  console.log(`\n[smoke] ${pass}/${results.length} passed. Results: ${RESULTS_PATH}`);
  process.exit(fail === 0 ? 0 : 2);
}

main().catch(e => { console.error('[smoke] harness error:', e); process.exit(3); });
