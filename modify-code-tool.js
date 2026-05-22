/**
 * Solomon Self-Code-Modification Tool
 * Allows Sol to rewrite his own source files on the VPS.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function modifyOwnCode(args, deps) {
  const { filePath, newCode, reason } = args;
  const { callLLM } = deps.core;

  console.log(`[SELF-MODIFY] Attempting to modify: ${filePath}`);
  console.log(`[REASON] ${reason}`);

  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);
  
  // Security: Only allow modifying files within the solomon-bot directory
  if (!absolutePath.startsWith('/root/solomon-bot')) {
    return { success: false, error: "Access denied: Can only modify files within /root/solomon-bot" };
  }

  try {
    // 1. Backup current file
    if (fs.existsSync(absolutePath)) {
      const backupPath = `${absolutePath}.bak.${Date.now()}`;
      fs.copyFileSync(absolutePath, backupPath);
    }

    // 2. Write new code
    fs.writeFileSync(absolutePath, newCode, 'utf8');

    // 3. Syntax check
    try {
      execSync(`node --check "${absolutePath}"`, { timeout: 5000 });
    } catch (syntaxErr) {
      // Rollback on syntax error
      const backups = fs.readdirSync(path.dirname(absolutePath))
        .filter(f => f.startsWith(path.basename(absolutePath) + '.bak.'))
        .sort().reverse();
      if (backups.length > 0) {
        fs.copyFileSync(path.join(path.dirname(absolutePath), backups[0]), absolutePath);
      }
      return { success: false, error: `Syntax check failed: ${syntaxErr.message}. Rolled back.` };
    }

    // 4. Determine which process to restart
    let restartCmd = 'pm2 restart solomon-bot';
    if (filePath.includes('relay.js')) restartCmd = 'pm2 restart solomon-relay';
    
    // Execute restart in background to avoid killing the current execution
    setTimeout(() => {
      try { execSync(restartCmd); } catch (e) { console.error(`Restart failed: ${e.message}`); }
    }, 1000);

    return { 
      success: true, 
      message: `Successfully modified ${filePath}. Syntax check passed. Process restart queued.`,
      backupCreated: true
    };

  } catch (e) {
    return { success: false, error: `Modification failed: ${e.message}` };
  }
}

const toolDefinition = {
  type: "function",
  function: {
    name: "modify_own_code",
    description: "Rewrite one of Sol's own source code files on the VPS. Use this to upgrade yourself, fix bugs, or add new features. The code will be syntax-checked before being applied. Process will restart automatically.",
    parameters: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Relative or absolute path to the file (e.g., 'bot.js', 'worker.js')" },
        newCode: { type: "string", description: "The complete new source code for the file" },
        reason: { type: "string", description: "Brief explanation of why this change is being made" }
      },
      required: ["filePath", "newCode", "reason"]
    }
  }
};

module.exports = { modifyOwnCode, toolDefinition };
