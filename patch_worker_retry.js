/**
 * patch_worker_retry.js
 * Patches executeSelfUpgradeTask in worker.js to:
 * 1. Pass the previous error message back to GPT-4o on retry
 * 2. Add a strong system instruction preventing duplicate declarations
 * 3. Store lastSyntaxError on the task object so retries have context
 *
 * Run on VPS: node /root/solomon-bot/patch_worker_retry.js
 */
const fs = require('fs');
const path = require('path');

const WORKER_FILE = path.join(__dirname, 'worker.js');
let code = fs.readFileSync(WORKER_FILE, 'utf8');

// ─── FIND THE EXACT STRINGS TO REPLACE ────────────────────────────────────────

// 1. Replace the system prompt in the callLLM call (the one-liner system message)
const OLD_SYSTEM_PROMPT = `{ role: 'system', content: 'You are a senior Node.js developer. Output ONLY raw JavaScript code. No markdown formatting, no explanation text, no code fences. Just the code.' }`;

const NEW_SYSTEM_PROMPT = `{ role: 'system', content: \`You are a senior Node.js developer writing a standalone Node.js module.

CRITICAL RULES — MUST FOLLOW:
1. Output ONLY raw JavaScript code. No markdown, no explanation, no code fences, no \\\`\\\`\\\` blocks.
2. This is a NEW MODULE FILE. Do NOT copy or redeclare functions from other files (bot.js, worker.js, etc.).
3. Every function name in this file must be UNIQUE — no duplicate const/function/let/var declarations.
4. End the file with a module.exports = { ... } block exporting all public functions.
5. Do NOT use 'export default' or ES module syntax — use CommonJS require/module.exports only.
6. Do NOT redeclare variables that are already declared in the same scope.
7. If you need a helper function, define it ONCE only.\`}`;

if (!code.includes(OLD_SYSTEM_PROMPT)) {
  console.error('ERROR: Could not find the system prompt string to replace. Aborting.');
  console.error('Looking for:', OLD_SYSTEM_PROMPT.slice(0, 80));
  process.exit(1);
}
code = code.replace(OLD_SYSTEM_PROMPT, NEW_SYSTEM_PROMPT);
console.log('✅ Replaced system prompt with strict no-duplicate-declaration rules');

// 2. Replace the codeGenPrompt construction to include previous error context
const OLD_CODEGEN_PROMPT = `    // Step 2: Generate the code via LLM
    const codeGenPrompt = \`You are an expert Node.js developer. You are upgrading the Solomon autonomous bot.
TASK: \${description}
\${currentCode ? \`CURRENT FILE CONTENTS (\${resolvedTargetFile}):\\n\\\`\\\`\\\`javascript\\n\${currentCode.slice(0, 8000)}\\n\\\`\\\`\\\`\\n\` : 'This is a new file.'}
REQUIREMENTS:
- Write production-ready Node.js code
- Keep existing functionality intact (don't break what works)
- Add clear comments for new code
- Use modern JavaScript (async/await, ES2020+)
- Handle errors gracefully
- The bot runs on Node.js v20 on Ubuntu 22.04
- Available globals: fetch (native), fs, path, child_process
- If modifying an existing file, output the COMPLETE file (not just the changes)
OUTPUT: Return ONLY the complete JavaScript code. No markdown, no explanation, no \\\`\\\`\\\` blocks. Just raw JavaScript.\`;
    advanceStep(task.id, 'Generating code via GPT-4o...');
    const generatedCode = await callLLM([
      { role: 'system', content: 'You are a senior Node.js developer. Output ONLY raw JavaScript code. No markdown formatting, no explanation text, no code fences. Just the code.' },
      { role: 'user', content: codeGenPrompt }
    ]);`;

const NEW_CODEGEN_PROMPT = `    // Step 2: Generate the code via LLM
    // Include previous error context if this is a retry
    const previousError = task.lastSyntaxError || task.failReason || null;
    const isRetry = (task.attempts || 0) > 0 && previousError;
    const errorContext = isRetry
      ? \`\\n\\nPREVIOUS ATTEMPT FAILED WITH THIS ERROR:\\n\${previousError}\\n\\nYou MUST fix this error. Common causes:\\n- Duplicate function/variable declarations (use unique names)\\n- Missing or extra closing braces\\n- Using 'export' instead of 'module.exports'\\n- Redeclaring a name that appears twice in the same file\\nCarefully check your output for any identifier declared more than once.\\n\`
      : '';

    const codeGenPrompt = \`You are an expert Node.js developer. You are upgrading the Solomon autonomous bot.
TASK: \${description}
\${currentCode ? \`CURRENT FILE CONTENTS (\${resolvedTargetFile}):\\n\\\`\\\`\\\`javascript\\n\${currentCode.slice(0, 8000)}\\n\\\`\\\`\\\`\\n\` : 'This is a NEW file — write it from scratch.'}
REQUIREMENTS:
- Write production-ready Node.js code
- Keep existing functionality intact (don't break what works)
- Add clear comments for new code
- Use modern JavaScript (async/await, ES2020+)
- Handle errors gracefully
- The bot runs on Node.js v20 on Ubuntu 22.04
- Available globals: fetch (native), fs, path, child_process
- If modifying an existing file, output the COMPLETE file (not just the changes)
- For NEW files: end with module.exports = { ...all public functions }
- NEVER declare the same function or variable name twice in the same file
- NEVER use duplicate const/let/var/function declarations\${errorContext}
OUTPUT: Return ONLY the complete JavaScript code. No markdown, no explanation, no \\\`\\\`\\\` blocks. Just raw JavaScript.\`;
    advanceStep(task.id, \`Generating code via GPT-4o\${isRetry ? ' (retry with error context)' : ''}...\`);
    const generatedCode = await callLLM([
      ${NEW_SYSTEM_PROMPT},
      { role: 'user', content: codeGenPrompt }
    ]);`;

if (!code.includes(OLD_CODEGEN_PROMPT)) {
  // Try a more targeted replacement — just the callLLM call part
  console.log('Full replacement not found, trying targeted approach...');
  
  // Replace just the callLLM messages array
  const OLD_CALLLM = `    const generatedCode = await callLLM([
      { role: 'system', content: 'You are a senior Node.js developer. Output ONLY raw JavaScript code. No markdown formatting, no explanation text, no code fences. Just the code.' },
      { role: 'user', content: codeGenPrompt }
    ]);`;
  
  const NEW_CALLLM = `    const generatedCode = await callLLM([
      ${NEW_SYSTEM_PROMPT},
      { role: 'user', content: codeGenPrompt }
    ]);`;
  
  if (!code.includes(OLD_CALLLM)) {
    console.error('ERROR: Cannot find callLLM block either. Manual inspection needed.');
    process.exit(1);
  }
  code = code.replace(OLD_CALLLM, NEW_CALLLM);
  console.log('✅ Replaced callLLM system prompt (targeted approach)');
  
  // Now inject the error context into the codeGenPrompt separately
  const OLD_PROMPT_START = `    // Step 2: Generate the code via LLM
    const codeGenPrompt = \`You are an expert Node.js developer. You are upgrading the Solomon autonomous bot.
TASK: \${description}`;
  
  const NEW_PROMPT_START = `    // Step 2: Generate the code via LLM
    // Include previous error context if this is a retry
    const previousError = task.lastSyntaxError || task.failReason || null;
    const isRetry = (task.attempts || 0) > 0 && previousError;
    const errorContext = isRetry
      ? \`\\n\\nPREVIOUS ATTEMPT FAILED WITH THIS ERROR:\\n\${previousError}\\n\\nYou MUST fix this error. Common causes:\\n- Duplicate function/variable declarations (use unique names)\\n- Missing or extra closing braces\\n- Using 'export' instead of 'module.exports'\\n- Redeclaring a name that appears twice in the same file\\nCarefully check your output for any identifier declared more than once.\\n\`
      : '';

    const codeGenPrompt = \`You are an expert Node.js developer. You are upgrading the Solomon autonomous bot.
TASK: \${description}`;
  
  if (!code.includes(OLD_PROMPT_START)) {
    console.error('ERROR: Cannot find codeGenPrompt start. Manual inspection needed.');
    process.exit(1);
  }
  code = code.replace(OLD_PROMPT_START, NEW_PROMPT_START);
  console.log('✅ Injected error context into codeGenPrompt');
  
  // Also inject errorContext at the end of the prompt (before OUTPUT line)
  const OLD_OUTPUT_LINE = `OUTPUT: Return ONLY the complete JavaScript code. No markdown, no explanation, no \\\`\\\`\\\` blocks. Just raw JavaScript.\``;
  const NEW_OUTPUT_LINE = `- NEVER declare the same function or variable name twice in the same file
- NEVER use duplicate const/let/var/function declarations\${errorContext}
OUTPUT: Return ONLY the complete JavaScript code. No markdown, no explanation, no \\\`\\\`\\\` blocks. Just raw JavaScript.\``;
  
  if (code.includes(OLD_OUTPUT_LINE)) {
    code = code.replace(OLD_OUTPUT_LINE, NEW_OUTPUT_LINE);
    console.log('✅ Added no-duplicate rules and error context to prompt');
  } else {
    console.log('⚠️  Could not find OUTPUT line for injection (may already be patched)');
  }
  
  // Update the advanceStep call to mention retry
  const OLD_ADVANCE = `    advanceStep(task.id, 'Generating code via GPT-4o...');`;
  const NEW_ADVANCE = `    advanceStep(task.id, \`Generating code via GPT-4o\${isRetry ? ' (retry with error context)' : ''}...\`);`;
  if (code.includes(OLD_ADVANCE)) {
    code = code.replace(OLD_ADVANCE, NEW_ADVANCE);
    console.log('✅ Updated advanceStep to show retry context');
  }
} else {
  code = code.replace(OLD_CODEGEN_PROMPT, NEW_CODEGEN_PROMPT);
  console.log('✅ Replaced full codeGenPrompt with error-aware version');
}

// 3. Patch the syntax validation block to store the error on the task before throwing
const OLD_SYNTAX_CHECK = `    try {
      // Attempt to parse as a module to check for syntax errors
      new Function(cleanCode);
    } catch (syntaxError) {
      // Try to fix common issues
      if (syntaxError instanceof SyntaxError) {
        // If it's a require/module issue, that's expected for Node modules
        if (!syntaxError.message.includes('require') && !syntaxError.message.includes('module') && !syntaxError.message.includes('exports')) {
          throw new Error(\`Generated code has syntax error: \${syntaxError.message}\`);
        }
      }
    }`;

const NEW_SYNTAX_CHECK = `    try {
      // Attempt to parse as a module to check for syntax errors
      new Function(cleanCode);
    } catch (syntaxError) {
      if (syntaxError instanceof SyntaxError) {
        // If it's a require/module issue, that's expected for Node modules — not a real error
        if (!syntaxError.message.includes('require') && !syntaxError.message.includes('module') && !syntaxError.message.includes('exports')) {
          // Store the error on the task so the next retry prompt includes it
          const errMsg = \`Syntax error in generated code: \${syntaxError.message}. Check for duplicate declarations, missing braces, or invalid syntax near the reported line.\`;
          updateTask(task.id, { lastSyntaxError: errMsg });
          throw new Error(errMsg);
        }
      }
    }`;

if (!code.includes(OLD_SYNTAX_CHECK)) {
  console.log('⚠️  Syntax check block not found verbatim — trying partial match...');
  // Try a simpler targeted replacement
  const OLD_THROW = `          throw new Error(\`Generated code has syntax error: \${syntaxError.message}\`);`;
  const NEW_THROW = `          const errMsg = \`Syntax error in generated code: \${syntaxError.message}. Check for duplicate declarations, missing braces, or invalid syntax near the reported line.\`;
          updateTask(task.id, { lastSyntaxError: errMsg });
          throw new Error(errMsg);`;
  if (code.includes(OLD_THROW)) {
    code = code.replace(OLD_THROW, NEW_THROW);
    console.log('✅ Patched syntax error throw to store error on task (targeted)');
  } else {
    console.log('⚠️  Could not patch syntax check — may need manual review');
  }
} else {
  code = code.replace(OLD_SYNTAX_CHECK, NEW_SYNTAX_CHECK);
  console.log('✅ Replaced syntax check block with error-storing version');
}

// 4. Also store runtime errors (PM2 restart failures, etc.) on the task
const OLD_PM2_THROW = `        throw new Error(\`PM2 restart failed after code deploy: \${restartErr.message}. Rolled back to backup.\`);`;
const NEW_PM2_THROW = `        const pm2ErrMsg = \`PM2 restart failed after code deploy: \${restartErr.message}. Rolled back to backup. The generated code likely has a runtime error — check for undefined variables, missing requires, or logic errors.\`;
        updateTask(task.id, { lastSyntaxError: pm2ErrMsg });
        throw new Error(pm2ErrMsg);`;

if (code.includes(OLD_PM2_THROW)) {
  code = code.replace(OLD_PM2_THROW, NEW_PM2_THROW);
  console.log('✅ Patched PM2 restart error to store on task');
} else {
  console.log('⚠️  PM2 throw line not found verbatim (may already be patched)');
}

// Write the patched file
fs.writeFileSync(WORKER_FILE, code, 'utf8');
console.log(`\n✅ worker.js patched (${code.length} chars)`);
console.log('\nChanges made:');
console.log('  1. System prompt now enforces no-duplicate-declarations and CommonJS exports');
console.log('  2. codeGenPrompt now includes previous error context on retries');
console.log('  3. Syntax errors are stored on task.lastSyntaxError for next retry');
console.log('  4. PM2 restart failures are stored on task.lastSyntaxError for next retry');
