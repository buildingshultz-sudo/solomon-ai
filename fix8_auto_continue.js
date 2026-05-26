// fix8_auto_continue.js — Add auto-continuation so Solomon doesn't stop mid-task
const fs = require('fs');
const path = '/root/solomon-v4/bot.js';
let code = fs.readFileSync(path, 'utf8');

// Fix 1: Increase tool loop from 8 to 25 iterations
code = code.replace(
  "while ((response.stop_reason === 'tool_use' || response.stop_reason === 'pause_turn') && iterations < 8)",
  "while ((response.stop_reason === 'tool_use' || response.stop_reason === 'pause_turn') && iterations < 25)"
);

// Fix 2: Add auto-continuation after the tool loop ends.
// When Solomon sends a progress update (not a final answer), send it to Telegram
// and then automatically continue the conversation with "Continue working."

const oldFinalExtract = `  // ─────────────────────────────────────────────────────────────────────────
  // 7. Extract final text response
  const textBlock = response.content.find(b => b.type === 'text');
  const finalText = textBlock ? textBlock.text : '(Task queued — will report back when done)';
  // 8. Save assistant response to history
  messages.add('assistant', finalText);
  activityLogger.setStatus('IDLE', '');
  return finalText;
}`;

const newFinalExtract = `  // ─────────────────────────────────────────────────────────────────────────
  // 7. Extract final text response + AUTO-CONTINUATION
  const textBlock = response.content.find(b => b.type === 'text');
  const finalText = textBlock ? textBlock.text : '(Task queued — will report back when done)';

  // AUTO-CONTINUE: If Solomon used tools this turn AND his final text indicates
  // work is still in progress, send the progress update and keep working.
  const PROGRESS_INDICATORS = [
    'installing', 'building', 'now ', 'next:', 'step ', 'working on',
    'adding', 'creating', 'implementing', 'configuring', 'setting up',
    'checkpoint', 'phase ', 'continuing', 'then i', 'after that'
  ];
  const lowerText = finalText.toLowerCase();
  const isProgressUpdate = iterations > 0 && PROGRESS_INDICATORS.some(p => lowerText.includes(p));
  const MAX_CONTINUATIONS = 3; // Prevent infinite self-talk

  if (isProgressUpdate && (!this._continuationCount || this._continuationCount < MAX_CONTINUATIONS)) {
    // Send progress to Telegram so Jed sees what's happening
    try {
      await bot.sendMessage(OWNER_ID, finalText, { parse_mode: 'Markdown' }).catch(() => 
        bot.sendMessage(OWNER_ID, finalText)
      );
    } catch (_) {}
    log('INFO', 'AUTO-CONTINUE', \`Sending progress update and continuing work (continuation \${(this._continuationCount || 0) + 1}/\${MAX_CONTINUATIONS})\`);
    
    // Save to history and auto-continue
    messages.add('assistant', finalText);
    messages.add('user', 'Continue working. Do not repeat what you just said — proceed to the next step.');
    
    // Track continuation count
    if (!this._continuationCount) this._continuationCount = 1;
    else this._continuationCount++;
    
    // Recursive call to keep working
    const continueResult = await askSolomon('Continue working. Do not repeat what you just said — proceed to the next step.');
    this._continuationCount = 0; // Reset after completion
    return continueResult;
  }

  // Reset continuation counter on normal completion
  if (typeof this !== 'undefined' && this._continuationCount) this._continuationCount = 0;

  // 8. Save assistant response to history
  messages.add('assistant', finalText);
  activityLogger.setStatus('IDLE', '');
  return finalText;
}`;

if (code.includes(oldFinalExtract)) {
  code = code.replace(oldFinalExtract, newFinalExtract);
  fs.writeFileSync(path, code, 'utf8');
  console.log('✅ Auto-continuation added to bot.js');
  console.log('   - Tool loop increased from 8 to 25 iterations');
  console.log('   - Progress updates sent to Telegram automatically');
  console.log('   - Solomon auto-continues up to 3 times when mid-task');
  console.log('   - Prevents infinite loops with MAX_CONTINUATIONS = 3');
} else {
  console.error('ERROR: Could not find the exact text block to replace.');
  console.error('Searching for partial match...');
  if (code.includes('// 7. Extract final text response')) {
    console.log('Found section 7 header. The surrounding code may have changed.');
  }
  process.exit(1);
}
