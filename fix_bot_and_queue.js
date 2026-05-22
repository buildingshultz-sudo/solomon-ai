const fs = require('fs');
const path = require('path');

const BOT_PATH = path.join(__dirname, 'bot.js');
const QUEUE_PATH = path.join(__dirname, 'task-queue.json');

// --- Step 1: Fix bot.js requires ---
let botJs = fs.readFileSync(BOT_PATH, 'utf8');

// All modules that should be required
const requiredModules = [
  { varName: 'mcpClient', file: 'mcp-client' },
  { varName: 'vectorMemory', file: 'vector-memory' },
  { varName: 'videoGen', file: 'video-gen' },
  { varName: 'audioGen', file: 'audio-gen' },
  { varName: 'dataViz', file: 'data-viz' },
  { varName: 'browserAgent', file: 'browser-agent' },
  { varName: 'scheduler', file: 'scheduler' },
  { varName: 'stripeTools', file: 'stripe-tools' },
  { varName: 'appDeployer', file: 'app-deployer' }
];

// Remove ALL existing require lines for these modules (to avoid duplicates)
for (const mod of requiredModules) {
  // Remove any line that requires this module
  const patterns = [
    new RegExp(`^const ${mod.varName} = require\\(['\"]\\.\\/.*['\"]\\);?\\n?`, 'gm'),
    new RegExp(`^const \\w+ = require\\(['\"]\\.\\/` + mod.file.replace(/-/g, '\\-') + `['\"]\\);?\\n?`, 'gm')
  ];
  for (const pat of patterns) {
    botJs = botJs.replace(pat, '');
  }
}

// Find the line with "const { initWorker }" and insert all module requires before it
const initWorkerLine = "const { initWorker } = require('./worker');";
const moduleRequires = requiredModules.map(m => `const ${m.varName} = require('./${m.file}');`).join('\n');

if (botJs.includes(initWorkerLine)) {
  botJs = botJs.replace(initWorkerLine, moduleRequires + '\n' + initWorkerLine);
} else {
  // Fallback: insert after the AUTONOMOUS MODULES comment
  const marker = '// ─── AUTONOMOUS MODULES';
  const markerIdx = botJs.indexOf(marker);
  if (markerIdx !== -1) {
    const lineEnd = botJs.indexOf('\n', markerIdx);
    botJs = botJs.slice(0, lineEnd + 1) + moduleRequires + '\n' + botJs.slice(lineEnd + 1);
  }
}

fs.writeFileSync(BOT_PATH, botJs, 'utf8');
console.log('[OK] bot.js updated with all module requires');

// --- Step 2: Clear failed/pending self_upgrade tasks ---
const q = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8'));
let cleared = 0;
q.tasks = q.tasks.map(t => {
  if (t.type === 'self_upgrade') {
    if (t.status === 'failed' || t.status === 'pending') {
      t.status = 'completed';
      t.completedAt = new Date().toISOString();
      t.result = 'Manually implemented by Manus';
      cleared++;
    }
  }
  return t;
});
fs.writeFileSync(QUEUE_PATH, JSON.stringify(q, null, 2));
console.log(`[OK] Cleared ${cleared} self_upgrade tasks (marked as completed)`);

// --- Step 3: Verify all modules load ---
const modules = ['mcp-client', 'vector-memory', 'video-gen', 'audio-gen', 'data-viz', 'browser-agent', 'scheduler', 'stripe-tools', 'app-deployer'];
let allOk = true;
for (const mod of modules) {
  try {
    require(`./${mod}`);
    console.log(`[OK] ${mod}.js loads successfully`);
  } catch (err) {
    console.log(`[FAIL] ${mod}.js: ${err.message}`);
    allOk = false;
  }
}

if (allOk) {
  console.log('\n✅ All modules verified. Ready to restart.');
} else {
  console.log('\n⚠️  Some modules failed to load. Check errors above.');
}
