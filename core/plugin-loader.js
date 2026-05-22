/**
 * Solomon Plugin System v1.0
 *
 * Lazy-loads integration modules on demand. Each plugin is a self-contained
 * module in /plugins/ that exports a standard interface:
 *
 * module.exports = {
 *   name: 'plugin_name',
 *   version: '1.0.0',
 *   description: 'What this plugin does',
 *   requiredKeys: ['API_KEY_NAME'],  // Keys needed in config
 *   commands: ['/cmd1', '/cmd2'],     // Telegram commands it registers
 *   tools: [...],                     // LLM function-calling tools it provides
 *   init(deps) {},                    // Called once when plugin first loads
 *   destroy() {}                      // Called on shutdown
 * }
 */

const fs = require('fs');
const path = require('path');

const PLUGINS_DIR = path.join(__dirname, '..', 'plugins');
const loadedPlugins = new Map();
const pluginErrors = new Map();

function getAvailablePlugins() {
  if (!fs.existsSync(PLUGINS_DIR)) return [];
  return fs.readdirSync(PLUGINS_DIR)
    .filter(f => f.endsWith('.js'))
    .map(f => f.replace('.js', ''));
}

function isPluginReady(pluginName, config) {
  const pluginPath = path.join(PLUGINS_DIR, `${pluginName}.js`);
  if (!fs.existsSync(pluginPath)) return { ready: false, reason: 'File not found' };
  
  try {
    // Load module metadata without full init
    const mod = require(pluginPath);
    if (!mod.requiredKeys || mod.requiredKeys.length === 0) return { ready: true };
    
    const missing = mod.requiredKeys.filter(key => {
      const val = config[key] || process.env[key];
      return !val || val === '' || val.startsWith('YOUR_') || val === 'placeholder';
    });
    
    if (missing.length > 0) {
      return { ready: false, reason: `Missing keys: ${missing.join(', ')}` };
    }
    return { ready: true };
  } catch (e) {
    return { ready: false, reason: `Load error: ${e.message}` };
  }
}

function loadPlugin(pluginName, config, deps) {
  if (loadedPlugins.has(pluginName)) return loadedPlugins.get(pluginName);
  
  const pluginPath = path.join(PLUGINS_DIR, `${pluginName}.js`);
  if (!fs.existsSync(pluginPath)) {
    throw new Error(`Plugin not found: ${pluginName}`);
  }
  
  try {
    const mod = require(pluginPath);
    
    // Validate interface
    if (!mod.name) mod.name = pluginName;
    if (!mod.version) mod.version = '1.0.0';
    if (!mod.commands) mod.commands = [];
    if (!mod.tools) mod.tools = [];
    
    // Check required keys
    const readiness = isPluginReady(pluginName, config);
    if (!readiness.ready) {
      pluginErrors.set(pluginName, readiness.reason);
      console.log(`[PLUGINS] ⚠️  ${pluginName}: ${readiness.reason}`);
      // Still load the plugin but mark it as inactive
      mod._active = false;
      mod._reason = readiness.reason;
      loadedPlugins.set(pluginName, mod);
      return mod;
    }
    
    // Initialize
    if (mod.init) {
      mod.init({ config, ...deps });
    }
    mod._active = true;
    loadedPlugins.set(pluginName, mod);
    console.log(`[PLUGINS] ✅ ${pluginName} v${mod.version} loaded`);
    return mod;
  } catch (e) {
    pluginErrors.set(pluginName, e.message);
    console.error(`[PLUGINS] ❌ ${pluginName} failed: ${e.message}`);
    return null;
  }
}

function loadAllPlugins(config, deps) {
  const available = getAvailablePlugins();
  const results = { loaded: [], inactive: [], failed: [] };
  
  for (const name of available) {
    const plugin = loadPlugin(name, config, deps);
    if (!plugin) {
      results.failed.push(name);
    } else if (!plugin._active) {
      results.inactive.push({ name, reason: plugin._reason });
    } else {
      results.loaded.push(name);
    }
  }
  
  console.log(`[PLUGINS] Summary: ${results.loaded.length} active, ${results.inactive.length} inactive, ${results.failed.length} failed`);
  return results;
}

function getPlugin(name) {
  return loadedPlugins.get(name) || null;
}

function getActivePlugins() {
  return [...loadedPlugins.entries()]
    .filter(([_, p]) => p._active)
    .map(([name, p]) => ({ name, version: p.version, description: p.description, commands: p.commands }));
}

function getAllTools() {
  const tools = [];
  for (const [_, plugin] of loadedPlugins) {
    if (plugin._active && plugin.tools) {
      tools.push(...plugin.tools);
    }
  }
  return tools;
}

function getAllCommands() {
  const commands = {};
  for (const [name, plugin] of loadedPlugins) {
    if (plugin._active && plugin.commands) {
      for (const cmd of plugin.commands) {
        commands[cmd] = name;
      }
    }
  }
  return commands;
}

function executePluginTool(toolName, args, deps) {
  for (const [_, plugin] of loadedPlugins) {
    if (!plugin._active || !plugin.executeTool) continue;
    const tool = plugin.tools?.find(t => t.function?.name === toolName);
    if (tool) {
      return plugin.executeTool(toolName, args, deps);
    }
  }
  return { error: `No plugin handles tool: ${toolName}` };
}

function getPluginStatus() {
  const status = [];
  const available = getAvailablePlugins();
  for (const name of available) {
    const plugin = loadedPlugins.get(name);
    status.push({
      name,
      loaded: !!plugin,
      active: plugin?._active || false,
      version: plugin?.version || '?',
      reason: plugin?._reason || pluginErrors.get(name) || null,
      commands: plugin?.commands || [],
      tools: (plugin?.tools || []).map(t => t.function?.name)
    });
  }
  return status;
}

function unloadPlugin(name) {
  const plugin = loadedPlugins.get(name);
  if (plugin && plugin.destroy) {
    try { plugin.destroy(); } catch {}
  }
  loadedPlugins.delete(name);
  // Clear require cache
  const pluginPath = path.join(PLUGINS_DIR, `${name}.js`);
  delete require.cache[require.resolve(pluginPath)];
}

function reloadPlugin(name, config, deps) {
  unloadPlugin(name);
  return loadPlugin(name, config, deps);
}

module.exports = {
  loadPlugin, loadAllPlugins, getPlugin, getActivePlugins,
  getAllTools, getAllCommands, executePluginTool, getPluginStatus,
  unloadPlugin, reloadPlugin, getAvailablePlugins, isPluginReady
};
