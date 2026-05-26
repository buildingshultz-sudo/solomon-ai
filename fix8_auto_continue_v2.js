// fix8_auto_continue_v2.js — Add auto-continuation using line-number insertion
const fs = require('fs');
const path = '/root/solomon-v4/bot.js';
let lines = fs.readFileSync(path, 'utf8').split('\n');

// Fix 1: Increase tool loop from 8 to 25 iterations (line 516)
const loopLineIdx = lines.findIndex(l => l.includes('iterations < 8)'));
if (loopLineIdx !== -1) {
  lines[loopLineIdx] = lines[loopLineIdx].replace('iterations < 8)', 'iterations < 25)');
  console.log(`✅ Tool loop increased to 25 iterations (line ${loopLineIdx + 1})`);
} else {
  console.log('⚠️ Could not find tool loop limit line (may already be patched)');
}

// Fix 2: Replace lines 660-668 (section 7+8 + return) with auto-continuation logic
// Find the exact line "  // 7. Extract final text response"
const section7Idx = lines.findIndex(l => l.trim() === '// 7. Extract final text response');
if (section7Idx === -1) {
  console.error('ERROR: Could not find "// 7. Extract final text response"');
  process.exit(1);
}

// Find "return finalText;" after section 7
let returnIdx = -1;
for (let i = section7Idx; i < section7Idx + 20; i++) {
  if (lines[i] && lines[i].trim() === 'return finalText;') {
    returnIdx = i;
    break;
  }
}
if (returnIdx === -1) {
  console.error('ERROR: Could not find "return finalText;" after section 7');
  process.exit(1);
}

// Also find the closing "}" of askSolomon function (should be line after return)
const closingBraceIdx = returnIdx + 1;

// Replace lines from section7Idx to closingBraceIdx (inclusive) with new code
const newCode = [
  '  // 7. Extract final text response + AUTO-CONTINUATION',
  "  const textBlock = response.content.find(b => b.type === 'text');",
  "  const finalText = textBlock ? textBlock.text : '(Task queued \\u2014 will report back when done)';",
  '',
  '  // AUTO-CONTINUE: If Solomon used tools AND his text indicates work in progress,',
  '  // send the progress update to Telegram and keep working automatically.',
  '  const PROGRESS_INDICATORS = [',
  "    'installing', 'building', 'now ', 'next:', 'step ', 'working on',",
  "    'adding', 'creating', 'implementing', 'configuring', 'setting up',",
  "    'checkpoint', 'phase ', 'continuing', 'then i', 'after that',",
  "    'first,', 'second,', 'moving on', 'next step', 'now i'",
  '  ];',
  '  const lowerText = finalText.toLowerCase();',
  '  const isProgressUpdate = iterations > 0 && PROGRESS_INDICATORS.some(p => lowerText.includes(p));',
  '',
  '  // Use a module-level counter to prevent infinite self-continuation',
  '  if (!global._solContinuationCount) global._solContinuationCount = 0;',
  '  const MAX_CONTINUATIONS = 3;',
  '',
  '  if (isProgressUpdate && global._solContinuationCount < MAX_CONTINUATIONS) {',
  '    global._solContinuationCount++;',
  '    log(\'INFO\', \'AUTO-CONTINUE\', `Progress detected, continuing work (${global._solContinuationCount}/${MAX_CONTINUATIONS})`);',
  '',
  '    // Send progress to Telegram so Jed sees updates in real time',
  '    try {',
  '      await bot.sendMessage(OWNER_ID, finalText, { parse_mode: \'Markdown\' }).catch(() =>',
  '        bot.sendMessage(OWNER_ID, finalText)',
  '      );',
  '    } catch (_) {}',
  '',
  '    // Save progress to history and auto-inject continuation',
  "    messages.add('assistant', finalText);",
  "    messages.add('user', 'Continue working. Do not repeat what you just said — proceed to the next step.');",
  '',
  '    // Recursive call to keep working',
  "    const continueResult = await askSolomon('Continue working. Do not repeat what you just said \\u2014 proceed to the next step.');",
  '    global._solContinuationCount = 0;',
  '    return continueResult;',
  '  }',
  '',
  '  // Normal completion — reset counter',
  '  global._solContinuationCount = 0;',
  '',
  '  // 8. Save assistant response to history',
  "  messages.add('assistant', finalText);",
  "  activityLogger.setStatus('IDLE', '');",
  '  return finalText;',
  '}'
];

// Remove old lines and insert new ones
lines.splice(section7Idx, (closingBraceIdx - section7Idx + 1), ...newCode);

fs.writeFileSync(path, lines.join('\n'), 'utf8');
console.log(`✅ Auto-continuation logic added (replaced lines ${section7Idx + 1}-${closingBraceIdx + 1})`);
console.log('   - Progress updates sent to Telegram in real time');
console.log('   - Solomon auto-continues up to 3 times when mid-task');
console.log('   - Prevents infinite loops with global counter');
console.log('   - Tool loop now allows 25 iterations per turn');
