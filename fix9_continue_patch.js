// fix9_continue_patch.js — Two targeted fixes for auto-continuation
const fs = require('fs');
const path = '/root/solomon-v4/bot.js';
let code = fs.readFileSync(path, 'utf8');

// Fix 1: Remove "iterations > 0" requirement from auto-continue.
// This was preventing auto-continue when Solomon says "Working on it" 
// but the hallucination guard ran the tools (not the main loop).
const old1 = "const isProgressUpdate = iterations > 0 && PROGRESS_INDICATORS.some(p => lowerText.includes(p));";
const new1 = "const isProgressUpdate = PROGRESS_INDICATORS.some(p => lowerText.includes(p));";

if (code.includes(old1)) {
  code = code.replace(old1, new1);
  console.log('✅ Fix 1: Removed iterations > 0 requirement — auto-continue now fires on progress text alone');
} else {
  console.log('⚠️ Fix 1: Could not find exact match for iterations > 0 condition');
}

// Fix 2: Add "starting" and "working on it" to progress indicators
const oldIndicators = "    'first,', 'second,', 'moving on', 'next step', 'now i'";
const newIndicators = "    'first,', 'second,', 'moving on', 'next step', 'now i',\n    'starting now', 'working on it', 'i\\'ll confirm', 'will report', 'let me'";

if (code.includes(oldIndicators)) {
  code = code.replace(oldIndicators, newIndicators);
  console.log('✅ Fix 2: Added more progress indicators');
} else {
  console.log('⚠️ Fix 2: Could not find indicators line to extend');
}

fs.writeFileSync(path, code, 'utf8');
console.log('Done. Verifying syntax...');
