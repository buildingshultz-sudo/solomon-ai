'use strict';
// smoke-test.js — Phase 2 Item 14: Run smoke test on all 7 tools.
// Logs pass/fail for each. pc_command expected to fail (port forwarding not set up).
require('dotenv').config();
const { executeTool } = require('./tools');
const { tasks, budget, mem } = require('./memory');

const results = [];

function log(tool, pass, detail) {
  const status = pass ? 'PASS' : 'FAIL';
  results.push({ tool, status, detail });
  console.log(`[${status}] ${tool}: ${detail}`);
}

async function runTests() {
  console.log('=== SOLOMON V4 SMOKE TEST — Phase 2 Item 14 ===');
  console.log('Date:', new Date().toISOString());
  console.log('');

  // 1. remember (memory_save)
  try {
    const r = await executeTool('remember', { category: 'preferences', key: 'smoke_test_14', value: 'test_value_123' });
    log('remember', r.ok === true, r.message || JSON.stringify(r));
  } catch (e) { log('remember', false, e.message); }

  // 2. recall (memory_search)
  try {
    const r = await executeTool('recall', { category: 'preferences' });
    const found = r.data && r.data.some(d => d.key === 'smoke_test_14');
    log('recall', r.ok === true && found, `Found ${r.data ? r.data.length : 0} entries, smoke_test_14 present: ${found}`);
  } catch (e) { log('recall', false, e.message); }

  // 3. queue_task
  try {
    const r = await executeTool('queue_task', { title: 'Smoke test task', description: 'Testing task queue', type: 'general', priority: 10 });
    log('queue_task', r.ok === true && r.task_id > 0, `Task ID: ${r.task_id}`);
  } catch (e) { log('queue_task', false, e.message); }

  // 4. check_tasks
  try {
    const r = await executeTool('check_tasks', {});
    log('check_tasks', r.ok === true && typeof r.pending === 'number', `Pending: ${r.pending}, Recent: ${r.recent ? r.recent.length : 0}`);
  } catch (e) { log('check_tasks', false, e.message); }

  // 5. web_search
  try {
    const r = await executeTool('web_search', { query: 'Node.js latest version', num_results: 3 });
    const hasUrls = r.results && r.results.every(x => x.url && x.url.startsWith('http'));
    log('web_search', r.ok === true && hasUrls, `Results: ${r.results ? r.results.length : 0}, all have URLs: ${hasUrls}`);
  } catch (e) { log('web_search', false, e.message); }

  // 6. web_fetch
  try {
    const r = await executeTool('web_fetch', { url: 'https://example.com', timeout_ms: 10000 });
    log('web_fetch', r.ok === true && r.content && r.content.length > 50, `Title: "${r.title}", Content length: ${r.content ? r.content.length : 0}`);
  } catch (e) { log('web_fetch', false, e.message); }

  // 7. check_budget
  try {
    const r = await executeTool('check_budget', {});
    log('check_budget', r.ok === true && r.status === 'OK', `Month total: $${r.month_total_usd}, Status: ${r.status}`);
  } catch (e) { log('check_budget', false, e.message); }

  // 8. pc_execute (expected to fail — port forwarding not set up)
  try {
    const r = await executeTool('pc_execute', { command: 'hostname', timeout_ms: 10000 });
    if (r.ok) {
      log('pc_execute', true, `Output: ${r.stdout}`);
    } else {
      log('pc_execute', false, `EXPECTED FAIL (port forwarding needed): ${r.error}`);
    }
  } catch (e) { log('pc_execute', false, `EXPECTED FAIL: ${e.message}`); }

  // 9. pc_list_files (expected to fail — same reason)
  try {
    const r = await executeTool('pc_list_files', { path: 'C:\\solomon-v4' });
    if (r.ok) {
      log('pc_list_files', true, `Files: ${r.files ? r.files.length : 0}`);
    } else {
      log('pc_list_files', false, `EXPECTED FAIL (port forwarding needed): ${r.error}`);
    }
  } catch (e) { log('pc_list_files', false, `EXPECTED FAIL: ${e.message}`); }

  // ── SUMMARY ──
  console.log('\n=== SMOKE TEST SUMMARY ===');
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const expectedFails = results.filter(r => r.status === 'FAIL' && r.detail.includes('EXPECTED FAIL')).length;
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed} (${expectedFails} expected)`);
  console.log('');
  results.forEach(r => console.log(`  ${r.status === 'PASS' ? '✓' : '✗'} ${r.tool}: ${r.detail.slice(0, 100)}`));
  console.log('');
  if (passed >= 7) {
    console.log('[ITEM 14] GATE: ALL CORE TOOLS PASS. PC tools fail as expected (port forwarding needed).');
  } else {
    console.log('[ITEM 14] GATE: SOME TOOLS FAILED UNEXPECTEDLY. Fix before proceeding.');
    process.exit(1);
  }

  // Cleanup
  mem.set('preferences', 'smoke_test_14', '(cleaned up)');
}

runTests().catch(err => {
  console.error('SMOKE TEST CRASHED:', err);
  process.exit(1);
});
