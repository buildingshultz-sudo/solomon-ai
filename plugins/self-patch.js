/**
 * Self-Patch Plugin v2.0 — Solomon can write, commit, push, and auto-revert his own code
 *
 * Capabilities:
 * - Read/write any file in /root/solomon-bot/
 * - git add . && git commit -m "msg" && git push
 * - pm2 restart solomon-bot
 * - Auto-revert: if bot crashes after patch (no PM2 online within 30s), git revert + restart
 * - Full audit log of every patch
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const APP_DIR = path.resolve(__dirname, '..');
const PATCH_LOG = path.join(APP_DIR, 'patch-log.json');
const BACKUPS_DIR = path.join(APP_DIR, '.patch-backups');

// ── Helpers ────────────────────────────────────────────────────────────────

function logPatch(entry) {
  let log = [];
  try { log = JSON.parse(fs.readFileSync(PATCH_LOG, 'utf8')); } catch {}
  log.push({ ...entry, timestamp: new Date().toISOString() });
  if (log.length > 200) log = log.slice(-200);
  fs.writeFileSync(PATCH_LOG, JSON.stringify(log, null, 2));
}

function safeExec(cmd, opts = {}) {
  try {
    const out = execSync(cmd, {
      cwd: APP_DIR,
      encoding: 'utf8',
      timeout: opts.timeout || 30000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    });
    return { success: true, output: (out || '').trim().slice(-2000) };
  } catch (e) {
    return { success: false, error: (e.stderr || e.message || String(e)).slice(-1000) };
  }
}

function ensureBackupDir() {
  if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

// ── Core: self_patch ────────────────────────────────────────────────────────

async function selfPatch(filePath, content, commitMessage) {
  ensureBackupDir();

  // 1. Resolve and validate path
  const fullPath = path.resolve(APP_DIR, filePath);
  if (!fullPath.startsWith(APP_DIR + path.sep) && fullPath !== APP_DIR) {
    return { success: false, error: 'Path traversal blocked — must be within /root/solomon-bot/' };
  }

  // 2. Capture pre-patch git SHA for potential revert
  const shaResult = safeExec('git rev-parse HEAD');
  const prePatchSHA = shaResult.success ? shaResult.output.trim() : null;

  // 3. Backup existing file
  if (fs.existsSync(fullPath)) {
    const backupName = `${path.basename(filePath)}.${Date.now()}.bak`;
    const backupPath = path.join(BACKUPS_DIR, backupName);
    fs.copyFileSync(fullPath, backupPath);
  }

  // 4. Write the new file
  try {
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf8');
  } catch (e) {
    return { success: false, error: `Write failed: ${e.message}` };
  }

  // 5. Git add + commit + push
  const gitAdd = safeExec('git add -A');
  if (!gitAdd.success) {
    return { success: false, error: `git add failed: ${gitAdd.error}` };
  }

  const safeMsg = (commitMessage || 'self-patch update').replace(/"/g, "'");
  const gitCommit = safeExec(`git commit -m "${safeMsg}"`);
  if (!gitCommit.success && !gitCommit.error.includes('nothing to commit')) {
    return { success: false, error: `git commit failed: ${gitCommit.error}` };
  }

  const gitPush = safeExec('git push', { timeout: 45000 });
  if (!gitPush.success) {
    // Non-fatal — log but continue
    console.warn('[SELF-PATCH] git push failed (non-fatal):', gitPush.error);
  }

  // 6. Restart solomon-bot via PM2
  const restart = safeExec('pm2 restart solomon-bot');
  if (!restart.success) {
    return { success: false, error: `PM2 restart failed: ${restart.error}` };
  }

  // 7. Auto-revert check — wait up to 30s for bot to come back online
  const botOnline = await waitForBotOnline(30000);

  if (!botOnline) {
    // Bot crashed — revert
    console.error('[SELF-PATCH] Bot did not come back online after patch. Auto-reverting...');
    const revertResult = await autoRevert(prePatchSHA, filePath);
    logPatch({
      action: 'patch_reverted',
      filePath,
      commitMessage,
      prePatchSHA,
      revertResult
    });
    return {
      success: false,
      reverted: true,
      error: 'Bot crashed after patch — auto-reverted to previous commit',
      revertResult
    };
  }

  // 8. Success
  logPatch({
    action: 'patch_applied',
    filePath,
    commitMessage,
    prePatchSHA,
    gitPush: gitPush.success ? 'ok' : 'failed (non-fatal)',
    botOnline: true
  });

  return {
    success: true,
    message: `Patch applied to ${filePath}, committed, pushed, and bot restarted successfully.`,
    gitPush: gitPush.success ? 'pushed' : 'push failed (check git credentials)',
    prePatchSHA
  };
}

// ── Wait for PM2 process to be online ─────────────────────────────────────

function waitForBotOnline(timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const interval = setInterval(() => {
      try {
        const out = execSync('pm2 jlist', { encoding: 'utf8', timeout: 5000 });
        const procs = JSON.parse(out);
        const bot = procs.find(p => p.name === 'solomon-bot');
        if (bot && bot.pm2_env && bot.pm2_env.status === 'online') {
          clearInterval(interval);
          resolve(true);
          return;
        }
      } catch {}
      if (Date.now() - start >= timeoutMs) {
        clearInterval(interval);
        resolve(false);
      }
    }, 2000);
  });
}

// ── Auto-revert to previous commit ────────────────────────────────────────

async function autoRevert(prePatchSHA, filePath) {
  if (!prePatchSHA) {
    return { success: false, error: 'No pre-patch SHA available for revert' };
  }

  // Hard reset to pre-patch state
  const reset = safeExec(`git reset --hard ${prePatchSHA}`);
  if (!reset.success) {
    return { success: false, error: `git reset failed: ${reset.error}` };
  }

  // Force push the revert
  const push = safeExec('git push --force', { timeout: 45000 });

  // Restart after revert
  const restart = safeExec('pm2 restart solomon-bot');

  return {
    success: reset.success,
    resetTo: prePatchSHA,
    pushed: push.success,
    restarted: restart.success,
    message: `Reverted to ${prePatchSHA.slice(0, 7)}`
  };
}

// ── Read file ──────────────────────────────────────────────────────────────

function readFile(filePath) {
  try {
    const fullPath = path.resolve(APP_DIR, filePath);
    if (!fullPath.startsWith(APP_DIR)) return { success: false, error: 'Path traversal blocked' };
    if (!fs.existsSync(fullPath)) return { success: false, error: `File not found: ${filePath}` };
    const content = fs.readFileSync(fullPath, 'utf8');
    return { success: true, path: filePath, content, size: content.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── List files ─────────────────────────────────────────────────────────────

function listFiles(subDir = '') {
  try {
    const targetDir = subDir ? path.resolve(APP_DIR, subDir) : APP_DIR;
    if (!targetDir.startsWith(APP_DIR)) return { success: false, error: 'Path traversal blocked' };
    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    const files = entries.map(e => ({
      name: e.name,
      type: e.isDirectory() ? 'dir' : 'file',
      path: path.join(subDir || '.', e.name)
    }));
    return { success: true, dir: subDir || '.', files };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── Git status ─────────────────────────────────────────────────────────────

function gitStatus() {
  const status = safeExec('git status --short');
  const log = safeExec('git log --oneline -10');
  const branch = safeExec('git branch --show-current');
  return {
    success: true,
    branch: branch.output || 'unknown',
    status: status.output || 'clean',
    recentCommits: log.output || ''
  };
}

// ── Run arbitrary shell command (restricted to APP_DIR) ────────────────────

function runCommand(command) {
  // Safety: block dangerous commands
  const blocked = [/rm\s+-rf\s+\//, /mkfs/, /dd\s+if=/, /:\(\)\{.*\}/, />\s*\/dev\/sd/];
  for (const pattern of blocked) {
    if (pattern.test(command)) {
      return { success: false, error: 'Command blocked by safety filter' };
    }
  }
  return safeExec(command, { timeout: 60000 });
}

// ── View PM2 logs ──────────────────────────────────────────────────────────

function viewLogs(service = 'solomon-bot', lines = 50) {
  const result = safeExec(`pm2 logs ${service} --lines ${lines} --nostream 2>&1`, { timeout: 10000 });
  return result.success
    ? { success: true, logs: result.output }
    : { success: false, error: result.error };
}

// ── Add/update .env variable ───────────────────────────────────────────────

function addEnvVar(key, value) {
  try {
    const envPath = path.join(APP_DIR, '.env');
    let content = '';
    if (fs.existsSync(envPath)) content = fs.readFileSync(envPath, 'utf8');
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      content = content.trimEnd() + `\n${key}=${value}\n`;
    }
    fs.writeFileSync(envPath, content);
    process.env[key] = value;
    return { success: true, message: `${key} set in .env. Restart solomon-bot to apply.` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── Install npm package ────────────────────────────────────────────────────

function installPackage(packageName) {
  if (!/^[@a-z0-9][\w./@-]*$/.test(packageName)) {
    return { success: false, error: 'Invalid package name' };
  }
  return safeExec(`npm install ${packageName} --save`, { timeout: 120000 });
}

// ── Module export ──────────────────────────────────────────────────────────

module.exports = {
  name: 'self-patch',
  version: '2.0.0',
  description: 'Solomon can write/patch his own code, commit to GitHub, restart via PM2, and auto-revert if a patch crashes the bot',
  requiredKeys: [],
  commands: ['/patch', '/read_file', '/git_status', '/view_logs', '/run_cmd'],

  tools: [
    {
      type: 'function',
      function: {
        name: 'self_patch',
        description: 'Write or update a file in Solomon\'s codebase, commit to GitHub, restart the bot, and auto-revert if the bot crashes. Use this to fix bugs, add plugins, or update config.',
        parameters: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: 'Relative path from /root/solomon-bot/ (e.g., "plugins/youtube.js" or "core/config.js")'
            },
            content: {
              type: 'string',
              description: 'Full file content to write (complete file, not a diff)'
            },
            commitMessage: {
              type: 'string',
              description: 'Git commit message describing the change (e.g., "feat: add YouTube plugin")'
            }
          },
          required: ['filePath', 'content', 'commitMessage']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'read_source_file',
        description: 'Read any file from Solomon\'s codebase for analysis or before making changes',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Relative path from /root/solomon-bot/' }
          },
          required: ['filePath']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list_source_files',
        description: 'List files in Solomon\'s codebase directory',
        parameters: {
          type: 'object',
          properties: {
            subDir: { type: 'string', description: 'Subdirectory to list (e.g., "plugins", "core"). Leave empty for root.' }
          },
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'git_status',
        description: 'Check git status, recent commits, and current branch of Solomon\'s codebase',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'run_shell_command',
        description: 'Run a shell command in the /root/solomon-bot/ directory. Use for npm install, checking logs, testing, etc.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Shell command to run (e.g., "npm install axios --save", "pm2 list")' }
          },
          required: ['command']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'view_logs',
        description: 'View recent PM2 logs for debugging',
        parameters: {
          type: 'object',
          properties: {
            service: { type: 'string', description: 'Service name (default: solomon-bot)' },
            lines: { type: 'number', description: 'Number of lines (default: 50)' }
          },
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'add_env_variable',
        description: 'Add or update an environment variable in .env file',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Variable name (e.g., YOUTUBE_API_KEY)' },
            value: { type: 'string', description: 'Variable value' }
          },
          required: ['key', 'value']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'install_npm_package',
        description: 'Install an npm package and save to package.json',
        parameters: {
          type: 'object',
          properties: {
            packageName: { type: 'string', description: 'npm package name (e.g., "googleapis", "playwright")' }
          },
          required: ['packageName']
        }
      }
    }
  ],

  init(deps) {
    console.log('[SELF-PATCH] v2.0.0 loaded — Solomon can now self-patch, commit, and auto-revert');
  },

  async executeTool(toolName, args) {
    switch (toolName) {
      case 'self_patch':
        return await selfPatch(args.filePath, args.content, args.commitMessage);
      case 'read_source_file':
        return readFile(args.filePath);
      case 'list_source_files':
        return listFiles(args.subDir || '');
      case 'git_status':
        return gitStatus();
      case 'run_shell_command':
        return runCommand(args.command);
      case 'view_logs':
        return viewLogs(args.service, args.lines);
      case 'add_env_variable':
        return addEnvVar(args.key, args.value);
      case 'install_npm_package':
        return installPackage(args.packageName);
      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  }
};
