/**
 * Self-Upgrade Plugin — Sol can modify his own code, add integrations, deploy updates
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const APP_DIR = path.join(__dirname, '..');

module.exports = {
  name: 'self-upgrade',
  version: '1.0.0',
  description: 'Self-modification: Sol can edit his own code, add plugins, deploy updates, fix bugs',
  requiredKeys: [],
  commands: ['/upgrade', '/add_plugin', '/deploy', '/self_status'],
  tools: [
    {
      type: 'function', function: {
        name: 'read_source_file',
        description: 'Read a source file from Sol\'s codebase for analysis or modification',
        parameters: { type: 'object', properties: {
          filePath: { type: 'string', description: 'Relative path from app root (e.g., "plugins/youtube.js")' }
        }, required: ['filePath'] }
      }
    },
    {
      type: 'function', function: {
        name: 'write_source_file',
        description: 'Write or update a source file in Sol\'s codebase. Use for bug fixes, new plugins, or config changes.',
        parameters: { type: 'object', properties: {
          filePath: { type: 'string', description: 'Relative path from app root' },
          content: { type: 'string', description: 'Full file content to write' },
          reason: { type: 'string', description: 'Why this change is being made (logged)' }
        }, required: ['filePath', 'content', 'reason'] }
      }
    },
    {
      type: 'function', function: {
        name: 'install_package',
        description: 'Install an npm package dependency',
        parameters: { type: 'object', properties: {
          packageName: { type: 'string', description: 'npm package name (e.g., "axios")' }
        }, required: ['packageName'] }
      }
    },
    {
      type: 'function', function: {
        name: 'restart_service',
        description: 'Restart a PM2 service after code changes',
        parameters: { type: 'object', properties: {
          service: { type: 'string', enum: ['solomon-bot', 'solomon-relay', 'all'], description: 'Which service to restart' }
        }, required: ['service'] }
      }
    },
    {
      type: 'function', function: {
        name: 'view_logs',
        description: 'View recent PM2 logs for debugging',
        parameters: { type: 'object', properties: {
          service: { type: 'string', description: 'Service name' },
          lines: { type: 'number', description: 'Number of lines (default 50)' }
        }, required: [] }
      }
    },
    {
      type: 'function', function: {
        name: 'add_env_variable',
        description: 'Add or update an environment variable in .env file',
        parameters: { type: 'object', properties: {
          key: { type: 'string', description: 'Variable name' },
          value: { type: 'string', description: 'Variable value' }
        }, required: ['key', 'value'] }
      }
    }
  ],

  init(deps) {},

  async executeTool(toolName, args) {
    switch (toolName) {
      case 'read_source_file': return readFile(args.filePath);
      case 'write_source_file': return writeFile(args.filePath, args.content, args.reason);
      case 'install_package': return installPackage(args.packageName);
      case 'restart_service': return restartService(args.service);
      case 'view_logs': return viewLogs(args.service, args.lines);
      case 'add_env_variable': return addEnvVar(args.key, args.value);
      default: return { error: `Unknown tool: ${toolName}` };
    }
  }
};

function readFile(filePath) {
  try {
    const fullPath = path.resolve(APP_DIR, filePath);
    if (!fullPath.startsWith(APP_DIR)) return { success: false, error: 'Path traversal blocked' };
    if (!fs.existsSync(fullPath)) return { success: false, error: 'File not found' };
    const content = fs.readFileSync(fullPath, 'utf8');
    return { success: true, path: filePath, content, size: content.length };
  } catch (e) { return { success: false, error: e.message }; }
}

function writeFile(filePath, content, reason) {
  try {
    const fullPath = path.resolve(APP_DIR, filePath);
    if (!fullPath.startsWith(APP_DIR)) return { success: false, error: 'Path traversal blocked' };
    
    // Backup existing file
    if (fs.existsSync(fullPath)) {
      const backupDir = path.join(APP_DIR, '.backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      const backup = path.join(backupDir, `${path.basename(filePath)}.${Date.now()}.bak`);
      fs.copyFileSync(fullPath, backup);
    }
    
    // Ensure directory exists
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    fs.writeFileSync(fullPath, content);
    
    // Log the change
    const logPath = path.join(APP_DIR, 'upgrade-log.json');
    let log = [];
    try { log = JSON.parse(fs.readFileSync(logPath, 'utf8')); } catch {}
    log.push({ timestamp: new Date().toISOString(), file: filePath, reason, size: content.length });
    if (log.length > 100) log = log.slice(-100);
    fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
    
    return { success: true, path: filePath, size: content.length, reason };
  } catch (e) { return { success: false, error: e.message }; }
}

function installPackage(packageName) {
  try {
    // Validate package name (prevent injection)
    if (!/^[@a-z0-9][\w./-]*$/.test(packageName)) {
      return { success: false, error: 'Invalid package name' };
    }
    const output = execSync(`cd ${APP_DIR} && npm install ${packageName} --save`, { encoding: 'utf8', timeout: 60000 });
    return { success: true, output: output.slice(-500) };
  } catch (e) { return { success: false, error: e.message }; }
}

function restartService(service) {
  try {
    if (service === 'all') {
      execSync('pm2 restart all', { encoding: 'utf8', timeout: 15000 });
    } else {
      execSync(`pm2 restart ${service}`, { encoding: 'utf8', timeout: 15000 });
    }
    return { success: true, message: `${service} restarted` };
  } catch (e) { return { success: false, error: e.message }; }
}

function viewLogs(service = 'solomon-bot', lines = 50) {
  try {
    const output = execSync(`pm2 logs ${service} --lines ${lines} --nostream 2>&1`, { encoding: 'utf8', timeout: 10000 });
    return { success: true, logs: output.slice(-3000) };
  } catch (e) { return { success: false, error: e.message }; }
}

function addEnvVar(key, value) {
  try {
    const envPath = path.join(APP_DIR, '.env');
    let content = '';
    if (fs.existsSync(envPath)) content = fs.readFileSync(envPath, 'utf8');
    
    // Update or append
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      content += `\n${key}=${value}`;
    }
    
    fs.writeFileSync(envPath, content.trim() + '\n');
    process.env[key] = value;
    return { success: true, message: `${key} set. Restart service to apply.` };
  } catch (e) { return { success: false, error: e.message }; }
}
