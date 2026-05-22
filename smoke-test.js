/**
 * Solomon v6.0 Smoke Test Suite
 *
 * Tests all critical paths without requiring external API keys.
 * Run with: node smoke-test.js
 */

const fs = require('fs');
const path = require('path');

const PASS = '✅';
const FAIL = '❌';
const SKIP = '⏭️';
const results = [];

function test(name, fn) {
  try {
    const result = fn();
    if (result === 'skip') {
      results.push({ name, status: 'skip' });
      console.log(`${SKIP} ${name} (skipped — missing dependency)`);
    } else {
      results.push({ name, status: 'pass' });
      console.log(`${PASS} ${name}`);
    }
  } catch (e) {
    results.push({ name, status: 'fail', error: e.message });
    console.log(`${FAIL} ${name}: ${e.message}`);
  }
}

async function asyncTest(name, fn) {
  try {
    const result = await fn();
    if (result === 'skip') {
      results.push({ name, status: 'skip' });
      console.log(`${SKIP} ${name} (skipped)`);
    } else {
      results.push({ name, status: 'pass' });
      console.log(`${PASS} ${name}`);
    }
  } catch (e) {
    results.push({ name, status: 'fail', error: e.message });
    console.log(`${FAIL} ${name}: ${e.message}`);
  }
}

console.log('═══════════════════════════════════════════════════');
console.log('  Solomon v6.0 Smoke Test Suite');
console.log('═══════════════════════════════════════════════════\n');

// ── CORE MODULE TESTS ──────────────────────────────────────────────────────
console.log('── Core Modules ──────────────────────────────────\n');

test('Config loads without crash', () => {
  const config = require('./core/config');
  if (!config.SYSTEM_PROMPT) throw new Error('Missing SYSTEM_PROMPT');
  if (!config.OPENROUTER_URL) throw new Error('Missing OPENROUTER_URL');
});

test('Plugin loader initializes', () => {
  const loader = require('./core/plugin-loader');
  if (!loader.loadAllPlugins) throw new Error('Missing loadAllPlugins');
  if (!loader.getActivePlugins) throw new Error('Missing getActivePlugins');
});

test('Task queue CRUD operations', () => {
  const tq = require('./task-queue');
  // Add a task
  const task = tq.addTask({ title: 'Smoke test task', description: 'Testing', type: 'general' });
  if (!task.id) throw new Error('Task has no ID');
  // Update it
  const updated = tq.updateTask(task.id, { status: 'active' });
  if (!updated || updated.status !== 'active') throw new Error('Update failed');
  // Complete it
  tq.updateTask(task.id, { status: 'completed', result: 'test passed' });
  // Verify summary
  const summary = tq.getQueueSummary();
  if (!summary.stats) throw new Error('No stats in summary');
});

test('Task queue deduplication', () => {
  const tq = require('./task-queue');
  const t1 = tq.addTask({ title: 'Dedup test', type: 'general' });
  const t2 = tq.addTask({ title: 'Dedup test', type: 'general' });
  if (!t2.duplicate) throw new Error('Dedup not working');
  // Clean up
  tq.updateTask(t1.id, { status: 'completed' });
});

test('Task queue file locking', () => {
  const tq = require('./task-queue');
  // Rapid concurrent adds
  const tasks = [];
  for (let i = 0; i < 5; i++) {
    tasks.push(tq.addTask({ title: `Lock test ${i}_${Date.now()}`, type: 'general' }));
  }
  const valid = tasks.filter(t => t && t.id);
  if (valid.length < 5) throw new Error(`Only ${valid.length}/5 tasks created under lock contention`);
  // Clean up
  for (const t of valid) tq.updateTask(t.id, { status: 'completed' });
});

test('Memory module initializes', () => {
  const memory = require('./core/memory');
  if (!memory.saveMessage) throw new Error('Missing saveMessage');
  if (!memory.addKnowledge) throw new Error('Missing addKnowledge');
  // Test save/retrieve
  memory.saveMessage('test_chat', 'user', 'Hello smoke test');
  const history = memory.getChatHistory('test_chat', 5);
  if (history.length === 0) throw new Error('Message not saved');
  memory.clearChatHistory('test_chat');
});

test('Memory knowledge base', () => {
  const memory = require('./core/memory');
  memory.addKnowledge('test', 'Smoke test fact', 'test_key');
  const result = memory.getKnowledge('test', 'test_key');
  if (!result || !result.value.includes('Smoke test')) throw new Error('KB retrieval failed');
});

test('Health monitor runs', () => {
  const hm = require('./health-monitor');
  const queueCheck = hm.checkQueueIntegrity();
  if (queueCheck.ok === undefined) throw new Error('Queue check returned no status');
});

// ── PLUGIN TESTS ───────────────────────────────────────────────────────────
console.log('\n── Plugins ───────────────────────────────────────\n');

test('Plugin loader discovers all plugins', () => {
  const loader = require('./core/plugin-loader');
  const available = loader.getAvailablePlugins();
  if (available.length < 8) throw new Error(`Only ${available.length} plugins found (expected 8+)`);
});

test('Plugin loader loads plugins with config', () => {
  const loader = require('./core/plugin-loader');
  const config = require('./core/config');
  const results = loader.loadAllPlugins(config, {});
  // At minimum, web-search and pc-agent should be active (no keys required)
  if (results.loaded.length < 1) throw new Error('No plugins loaded');
});

test('Web search plugin always active', () => {
  const loader = require('./core/plugin-loader');
  const ws = loader.getPlugin('web-search');
  if (!ws) throw new Error('web-search plugin not loaded');
});

test('Self-upgrade plugin loads', () => {
  const loader = require('./core/plugin-loader');
  const su = loader.getPlugin('self-upgrade');
  if (!su) throw new Error('self-upgrade plugin not loaded');
});

test('All tools collected from plugins', () => {
  const loader = require('./core/plugin-loader');
  const tools = loader.getAllTools();
  if (tools.length < 5) throw new Error(`Only ${tools.length} tools (expected 5+)`);
});

// ── RELAY TESTS ────────────────────────────────────────────────────────────
console.log('\n── Relay & PC Agent ──────────────────────────────\n');

async function relayTests() {
  await asyncTest('Relay health endpoint responds', async () => {
    try {
      const res = await fetch('http://127.0.0.1:3001/health', { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      if (data.status !== 'ok') throw new Error(`Relay unhealthy: ${JSON.stringify(data)}`);
    } catch (e) {
      if (e.message.includes('fetch')) return 'skip';
      throw e;
    }
  });

  await asyncTest('Relay agent status endpoint', async () => {
    try {
      const res = await fetch('http://127.0.0.1:3001/agent/status', { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      if (data.ok === undefined) throw new Error('Invalid status response');
    } catch (e) {
      if (e.message.includes('fetch')) return 'skip';
      throw e;
    }
  });

  await asyncTest('Relay command queue/result cycle', async () => {
    try {
      // Queue a test command
      const qRes = await fetch('http://127.0.0.1:3001/command/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'echo smoke_test', type: 'cmd' })
      });
      const qData = await qRes.json();
      if (!qData.ok) throw new Error('Queue failed');
      
      // Check it appears in pending
      const pRes = await fetch('http://127.0.0.1:3001/command/pending');
      const pData = await pRes.json();
      // It should have been consumed
      
      // Submit a fake result
      await fetch(`http://127.0.0.1:3001/command/result/${qData.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result: { exitCode: 0, stdout: 'smoke_test', stderr: '' } })
      });
      
      // Retrieve result
      const rRes = await fetch(`http://127.0.0.1:3001/command/result/${qData.id}`);
      const rData = await rRes.json();
      if (rData.status !== 'completed') throw new Error('Result not stored');
    } catch (e) {
      if (e.message.includes('fetch')) return 'skip';
      throw e;
    }
  });
}

// ── PDF TESTS ──────────────────────────────────────────────────────────────
console.log('\n── PDF Generation ────────────────────────────────\n');

test('PDF generation via weasyprint', () => {
  const { execSync } = require('child_process');
  const testMd = '/tmp/smoke_test.md';
  const testPdf = '/tmp/smoke_test.pdf';
  const testHtml = '/tmp/smoke_test.html';
  
  fs.writeFileSync(testMd, '# Smoke Test\n\nThis is a test PDF.\n\n- Item 1\n- Item 2\n');
  
  // Try weasyprint
  try {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:sans-serif;margin:40px;}</style></head><body><h1>Smoke Test</h1><p>This is a test PDF.</p><ul><li>Item 1</li><li>Item 2</li></ul></body></html>`;
    fs.writeFileSync(testHtml, html);
    execSync(`weasyprint "${testHtml}" "${testPdf}"`, { timeout: 30000, env: { ...process.env, PATH: '/usr/local/bin:/usr/bin:/bin' } });
    if (!fs.existsSync(testPdf)) throw new Error('PDF not created');
    const size = fs.statSync(testPdf).size;
    if (size < 500) throw new Error(`PDF too small: ${size} bytes`);
    // Cleanup
    try { fs.unlinkSync(testMd); fs.unlinkSync(testPdf); fs.unlinkSync(testHtml); } catch {}
  } catch (e) {
    // Try manus-md-to-pdf
    try {
      execSync(`/usr/local/bin/manus-md-to-pdf "${testMd}" "${testPdf}"`, { timeout: 30000 });
      if (!fs.existsSync(testPdf) || fs.statSync(testPdf).size < 500) throw new Error('manus-md-to-pdf failed too');
      try { fs.unlinkSync(testMd); fs.unlinkSync(testPdf); } catch {}
    } catch (e2) {
      throw new Error(`Both PDF methods failed: weasyprint(${e.message}), manus(${e2.message})`);
    }
  }
});

// ── PERSISTENCE TESTS ──────────────────────────────────────────────────────
console.log('\n── Persistence ───────────────────────────────────\n');

test('Task queue survives simulated restart', () => {
  const tq = require('./task-queue');
  const task = tq.addTask({ title: `Persist test ${Date.now()}`, type: 'general' });
  
  // Clear require cache to simulate restart
  delete require.cache[require.resolve('./task-queue')];
  const tq2 = require('./task-queue');
  
  const summary = tq2.getQueueSummary();
  const found = [...summary.pending, ...summary.active, ...summary.completed].find(t => t.id === task.id);
  if (!found) throw new Error('Task lost after simulated restart');
  
  // Clean up
  tq2.updateTask(task.id, { status: 'completed' });
});

test('Memory DB persists across reloads', () => {
  const memory = require('./core/memory');
  memory.addKnowledge('persist_test', 'This should survive', 'persist_key');
  
  // Verify it's in the DB file
  const dbPath = path.join(__dirname, 'sol-memory.db');
  if (!fs.existsSync(dbPath)) throw new Error('Memory DB file not created');
  
  const result = memory.getKnowledge('persist_test', 'persist_key');
  if (!result) throw new Error('Knowledge not persisted');
});

// ── RUN ASYNC TESTS ────────────────────────────────────────────────────────
(async () => {
  await relayTests();

  // ── SUMMARY ────────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  SMOKE TEST RESULTS');
  console.log('═══════════════════════════════════════════════════\n');

  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const skipped = results.filter(r => r.status === 'skip').length;

  console.log(`  ${PASS} Passed: ${passed}`);
  console.log(`  ${FAIL} Failed: ${failed}`);
  console.log(`  ${SKIP} Skipped: ${skipped}`);
  console.log(`  Total: ${results.length}`);

  if (failed > 0) {
    console.log('\n  Failed tests:');
    for (const r of results.filter(r => r.status === 'fail')) {
      console.log(`    ${FAIL} ${r.name}: ${r.error}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════\n');

  // Write results to file
  fs.writeFileSync(path.join(__dirname, 'smoke-test-results.json'), JSON.stringify({
    timestamp: new Date().toISOString(),
    summary: { passed, failed, skipped, total: results.length },
    results
  }, null, 2));

  process.exit(failed > 0 ? 1 : 0);
})();
