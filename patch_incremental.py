#!/usr/bin/env python3
"""
Task 2: Implement incremental code generation in worker.js self_upgrade handler.
Instead of one-shot full file generation, break it into:
1. Generate function signatures/skeleton
2. Fill in each function body separately
3. Assemble final module
4. Validate with node --check
5. Deploy only if valid
"""
import re

with open('worker.js', 'r') as f:
    worker = f.read()

# Find the entire executeSelfUpgradeTask function and replace it
# We'll replace from "async function executeSelfUpgradeTask" to the closing of that function

old_func_start = "  async function executeSelfUpgradeTask(task) {"
old_func_end = "    return `🔧 Self-Upgrade Complete: ${task.title}\\n\\nFile: ${resolvedTargetFile}\\nCode: ${cleanCode.length} chars written\\nProcess: ${restartProcess} restarted and verified online\\n\\nChanges are live.`;\n  }"

new_func = '''  async function executeSelfUpgradeTask(task) {
    const { description, targetFile, restartProcess: restartProc } = task;
    const restartProcess = restartProc || 'solomon-bot';
    console.log(`[WORKER] Self-upgrade: ${task.title}`);
    advanceStep(task.id, 'Analyzing upgrade requirements...');

    // Step 1: Read the target file if it exists
    let currentCode = '';
    let resolvedTargetFile = targetFile;
    if (targetFile) {
      const fullPath = targetFile.startsWith('/') ? targetFile : path.join(__dirname, targetFile);
      resolvedTargetFile = fullPath;
      try {
        currentCode = fs.readFileSync(fullPath, 'utf8');
        advanceStep(task.id, `Read current file: ${fullPath} (${currentCode.length} chars)`);
      } catch (e) {
        advanceStep(task.id, `File not found — will create: ${fullPath}`);
      }
    }
    if (!resolvedTargetFile) {
      const safeName = task.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
      resolvedTargetFile = path.join(__dirname, `${safeName}.js`);
    }

    // Step 2: INCREMENTAL CODE GENERATION
    // Phase A: Generate the module skeleton (exports, requires, function signatures)
    advanceStep(task.id, 'Phase 1/3: Generating module skeleton...');
    const skeletonPrompt = `You are an expert Node.js developer. Generate ONLY a module skeleton for this task.
TASK: ${description}
${currentCode ? `EXISTING CODE (preserve working parts):\\n${currentCode.slice(0, 4000)}` : 'This is a new module.'}

OUTPUT FORMAT — raw JavaScript only, no markdown:
- All require() statements at the top
- All function signatures with JSDoc comments but EMPTY bodies (just a TODO comment inside)
- module.exports at the bottom listing all functions
- Example:
  'use strict';
  const fs = require('fs');
  /**
   * Does X
   * @param {string} input
   * @returns {object}
   */
  function doSomething(input) {
    // TODO: implement
  }
  module.exports = { doSomething };

Output ONLY the skeleton code. No explanation.`;

    let skeleton;
    const sysMsg = { role: 'system', content: 'You are a senior Node.js developer. Output ONLY raw JavaScript code. No markdown, no code fences, no explanation.' };
    try {
      skeleton = await callLLM([sysMsg, { role: 'user', content: skeletonPrompt }], 'openai/gpt-5.1-codex');
    } catch (e) {
      try { skeleton = await callLLM([sysMsg, { role: 'user', content: skeletonPrompt }], 'openai/gpt-4.1'); }
      catch (e2) { skeleton = await callLLM([sysMsg, { role: 'user', content: skeletonPrompt }], 'openai/gpt-4o'); }
    }
    // Strip markdown fences
    skeleton = skeleton.replace(/^```(?:javascript|js|node)?\\n?/gm, '').replace(/\\n?```$/gm, '').trim();
    if (!skeleton || skeleton.length < 30) throw new Error('Skeleton generation returned empty result');
    advanceStep(task.id, `Skeleton generated (${skeleton.length} chars). Extracting functions...`);

    // Phase B: Extract function names from skeleton
    const funcNames = [];
    const funcRegex = /(?:async\\s+)?function\\s+(\\w+)\\s*\\(/g;
    let match;
    while ((match = funcRegex.exec(skeleton)) !== null) {
      funcNames.push(match[1]);
    }
    // Also check for arrow function exports
    const arrowRegex = /const\\s+(\\w+)\\s*=\\s*(?:async\\s*)?\\(/g;
    while ((match = arrowRegex.exec(skeleton)) !== null) {
      funcNames.push(match[1]);
    }

    if (funcNames.length === 0) {
      // Fallback: just use the skeleton as-is (it might be a complete implementation)
      advanceStep(task.id, 'No function stubs found — using skeleton as complete implementation');
    } else {
      // Phase C: Fill in each function body one at a time
      advanceStep(task.id, `Phase 2/3: Implementing ${funcNames.length} functions...`);
      let assembledCode = skeleton;

      for (let i = 0; i < funcNames.length; i++) {
        const funcName = funcNames[i];
        advanceStep(task.id, `Implementing function ${i+1}/${funcNames.length}: ${funcName}()`);

        const implPrompt = `You are implementing ONE function for a Node.js module.
MODULE PURPOSE: ${description}
FULL MODULE SKELETON:
${assembledCode.slice(0, 6000)}

IMPLEMENT THIS FUNCTION: ${funcName}

Rules:
- Output ONLY the function body code (everything between the opening { and closing })
- Do NOT include the function signature or closing brace
- Do NOT redeclare variables that exist at module scope
- Use try/catch for error handling
- Be concise but complete

Output ONLY the function body code. No markdown, no explanation.`;

        let funcBody;
        try {
          funcBody = await callLLM([sysMsg, { role: 'user', content: implPrompt }], 'openai/gpt-5.1-codex');
        } catch (e) {
          try { funcBody = await callLLM([sysMsg, { role: 'user', content: implPrompt }], 'openai/gpt-4.1'); }
          catch (e2) { funcBody = await callLLM([sysMsg, { role: 'user', content: implPrompt }], 'openai/gpt-4o'); }
        }
        funcBody = funcBody.replace(/^```(?:javascript|js|node)?\\n?/gm, '').replace(/\\n?```$/gm, '').trim();

        // Replace the TODO stub in the skeleton with the real implementation
        const todoPattern = new RegExp(
          `((?:async\\\\s+)?function\\\\s+${funcName}\\\\s*\\\\([^)]*\\\\)\\\\s*\\\\{)\\\\s*\\\\/\\\\/ TODO[^}]*`,
          's'
        );
        if (todoPattern.test(assembledCode)) {
          assembledCode = assembledCode.replace(todoPattern, `$1\\n${funcBody}`);
        } else {
          // Fallback: try simpler pattern
          const simplePattern = new RegExp(
            `(function\\\\s+${funcName}\\\\s*\\\\([^)]*\\\\)\\\\s*\\\\{)[\\\\s\\\\S]*?(\\\\/\\\\/ TODO[^\\\\n]*)`,
            ''
          );
          if (simplePattern.test(assembledCode)) {
            assembledCode = assembledCode.replace(simplePattern, `$1\\n${funcBody}`);
          }
        }
        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 1000));
      }
      skeleton = assembledCode;
    }

    // Phase D: Final assembly and cleanup
    advanceStep(task.id, 'Phase 3/3: Final validation...');
    let cleanCode = skeleton;

    // Step 3: Validate with node --check by writing to a temp file
    const tempFile = resolvedTargetFile + '.tmp.' + Date.now() + '.js';
    fs.writeFileSync(tempFile, cleanCode, 'utf8');
    try {
      execSync(`node --check "${tempFile}"`, { timeout: 5000 });
      advanceStep(task.id, `✅ node --check passed (${cleanCode.length} chars)`);
    } catch (checkErr) {
      fs.unlinkSync(tempFile);
      const errMsg = checkErr.message || 'Unknown syntax error';
      // Store error for retry context
      updateTask(task.id, { lastSyntaxError: errMsg });
      throw new Error(`Pre-flight validation failed: ${errMsg}`);
    }
    fs.unlinkSync(tempFile);

    // Step 4: Backup and write
    if (fs.existsSync(resolvedTargetFile)) {
      const backupPath = resolvedTargetFile + '.backup.' + Date.now();
      fs.copyFileSync(resolvedTargetFile, backupPath);
      advanceStep(task.id, `Backed up original to: ${path.basename(backupPath)}`);
    }
    fs.writeFileSync(resolvedTargetFile, cleanCode, 'utf8');
    advanceStep(task.id, `Written to: ${resolvedTargetFile}`);

    // Step 5: Check if bot.js needs a require() for this module
    const botJsPath = path.join(__dirname, 'bot.js');
    let botJsPatched = false;
    let botJsBackup = botJsPath + '.backup.' + Date.now();
    if (resolvedTargetFile.endsWith('.js') && !resolvedTargetFile.includes('bot.js') && !resolvedTargetFile.includes('worker.js')) {
      const moduleName = path.basename(resolvedTargetFile, '.js');
      const botJsCode = fs.readFileSync(botJsPath, 'utf8');
      if (!botJsCode.includes(`require('./${moduleName}')`)) {
        advanceStep(task.id, `Registering module ${moduleName} in bot.js...`);
        fs.copyFileSync(botJsPath, botJsBackup);
        const camelName = moduleName.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
        const requireLine = `const ${camelName} = require('./${moduleName}');`;
        const lines = botJsCode.split('\\n');
        let lastReqIdx = -1;
        for (let i = 0; i < Math.min(lines.length, 50); i++) {
          if (lines[i].includes('require(')) lastReqIdx = i;
        }
        if (lastReqIdx !== -1) {
          lines.splice(lastReqIdx + 1, 0, requireLine);
          fs.writeFileSync(botJsPath, lines.join('\\n'), 'utf8');
          botJsPatched = true;
          advanceStep(task.id, `Added require to bot.js: ${requireLine}`);
        }
      }
    }

    // Step 6: Pre-flight check bot.js before restart
    if (restartProcess) {
      try {
        execSync(`node --check "${resolvedTargetFile}"`, { timeout: 5000 });
        if (botJsPatched) execSync(`node --check "${botJsPath}"`, { timeout: 5000 });
      } catch (pfErr) {
        // Rollback
        if (botJsPatched && fs.existsSync(botJsBackup)) fs.copyFileSync(botJsBackup, botJsPath);
        const backups = fs.readdirSync(path.dirname(resolvedTargetFile))
          .filter(f => f.startsWith(path.basename(resolvedTargetFile) + '.backup.')).sort().reverse();
        if (backups.length > 0) fs.copyFileSync(path.join(path.dirname(resolvedTargetFile), backups[0]), resolvedTargetFile);
        throw new Error(`Pre-flight failed after assembly: ${pfErr.message}. Rolled back.`);
      }

      // Step 7: Restart PM2
      advanceStep(task.id, `Restarting ${restartProcess}...`);
      try {
        execSync(`npx pm2 restart ${restartProcess}`, { timeout: 15000, cwd: __dirname });
      } catch (restartErr) {
        if (botJsPatched && fs.existsSync(botJsBackup)) fs.copyFileSync(botJsBackup, botJsPath);
        const backups = fs.readdirSync(path.dirname(resolvedTargetFile))
          .filter(f => f.startsWith(path.basename(resolvedTargetFile) + '.backup.')).sort().reverse();
        if (backups.length > 0) fs.copyFileSync(path.join(path.dirname(resolvedTargetFile), backups[0]), resolvedTargetFile);
        try { execSync(`npx pm2 restart ${restartProcess}`, { timeout: 15000, cwd: __dirname }); } catch {}
        throw new Error(`PM2 restart failed: ${restartErr.message}. Rolled back.`);
      }

      // Step 8: Verify process is online
      await new Promise(r => setTimeout(r, 3000));
      try {
        const pm2Status = execSync('npx pm2 jlist', { timeout: 10000, cwd: __dirname }).toString();
        const processes = JSON.parse(pm2Status);
        const proc = processes.find(p => p.name === restartProcess);
        if (proc && proc.pm2_env.status === 'online') {
          advanceStep(task.id, `✅ ${restartProcess} is online (PID: ${proc.pid})`);
        } else {
          throw new Error(`Process ${restartProcess} not online after restart`);
        }
      } catch (verifyErr) {
        throw new Error(`Verification failed: ${verifyErr.message}`);
      }
    }

    return `🔧 Self-Upgrade Complete: ${task.title}\\n\\nFile: ${resolvedTargetFile}\\nCode: ${cleanCode.length} chars (${funcNames.length} functions)\\nProcess: ${restartProcess} restarted and verified\\n\\nChanges are live.`;
  }'''

# Find and replace the function
start_marker = "  async function executeSelfUpgradeTask(task) {"
end_marker = "  // ─── RESEARCH TASK"

start_idx = worker.find(start_marker)
end_idx = worker.find(end_marker)

if start_idx == -1 or end_idx == -1:
    print(f"[ERROR] Could not find function boundaries. start={start_idx}, end={end_idx}")
    exit(1)

worker = worker[:start_idx] + new_func + "\n" + worker[end_idx:]

with open('worker.js', 'w') as f:
    f.write(worker)

print(f"[OK] worker.js: Incremental code generation implemented")
print(f"     - Phase 1: Generate skeleton with function signatures")
print(f"     - Phase 2: Implement each function body separately")
print(f"     - Phase 3: Assemble, validate with node --check, deploy")
print(f"     - Fallback chain: gpt-5.1-codex > gpt-4.1 > gpt-4o")
print(f"     - Pre-flight validation before PM2 restart")
print(f"     - Automatic rollback on failure")
