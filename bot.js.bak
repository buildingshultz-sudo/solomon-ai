/**
 * Solomon's Forge Bot v6.1 — Autonomous Business Operating System
 *
 * Architecture:
 * - Plugin-based: all integrations are lazy-loaded modules
 * - Anti-hallucination: strict data verification, source tagging
 * - Memory: SQLite-backed persistent context
 * - Health: deep functional checks, not just process status
 * - Self-upgrade: Sol can modify his own code and deploy
 * - Image persistence: all user photos saved to disk with JSON index
 *
 * Core flow:
 * 1. User sends message via Telegram
 * 2. Message + context + KB injected into LLM
 * 3. LLM decides: direct reply, tool call, or task queue
 * 4. Tools execute via plugin system
 * 5. Results verified and delivered
 *
 * v6.1 Changes:
 * - Persistent image storage for all received photos
 * - recall_user_images tool for LLM to reference saved photos
 * - Removed startup notification spam
 * - Fixed silent response bug (always responds)
 * - Fixed summary call API 400 (fresh message array)
 * - All LLM calls routed through OpenRouter (vision included)
 * - Tools always available (including during vision calls)
 * - generate_image and set_desktop_wallpaper as direct tools
 * - Increased tool loop to 8 iterations
 * - Proper assistant message formatting in tool loop
 */

const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

// ── CORE MODULES ───────────────────────────────────────────────────────────
const config = require('./core/config');

// ── PERSISTENT MEMORY FILE ─────────────────────────────────────────────────
const SOL_MEMORY_FILE = path.join(__dirname, 'sol_memory.md');
function loadPersistentMemory() {
  try {
    if (fs.existsSync(SOL_MEMORY_FILE)) {
      return "\n\n" + fs.readFileSync(SOL_MEMORY_FILE, "utf8");
    }
  } catch (e) {
    console.error('[BOT] Failed to load persistent memory:', e.message);
  }
  return '';
}
const PERSISTENT_MEMORY = loadPersistentMemory();
console.log('[BOT] Persistent memory loaded:', PERSISTENT_MEMORY.length, 'chars');

// ── USER IMAGE STORE ───────────────────────────────────────────────────────
// All images sent by Jed are saved here for persistent reference
const USER_IMAGES_DIR = path.join(__dirname, 'user_images');
const USER_IMAGES_INDEX = path.join(USER_IMAGES_DIR, 'index.json');

function ensureImageDir() {
  if (!fs.existsSync(USER_IMAGES_DIR)) {
    fs.mkdirSync(USER_IMAGES_DIR, { recursive: true });
    console.log('[IMAGES] Created user_images directory');
  }
}

function loadImageIndex() {
  try {
    if (fs.existsSync(USER_IMAGES_INDEX)) {
      return JSON.parse(fs.readFileSync(USER_IMAGES_INDEX, 'utf8'));
    }
  } catch (e) {
    console.error('[IMAGES] Failed to load index:', e.message);
  }
  return [];
}

function saveImageIndex(index) {
  try {
    fs.writeFileSync(USER_IMAGES_INDEX, JSON.stringify(index, null, 2));
  } catch (e) {
    console.error('[IMAGES] Failed to save index:', e.message);
  }
}

async function saveUserImage(buf, filePath, caption) {
  try {
    ensureImageDir();
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const tsShort = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const slug = caption
      ? caption.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40).replace(/^_|_$/g, '')
      : 'photo';
    const ext = filePath.endsWith('.png') ? 'png' : 'jpg';
    const filename = `${tsShort}_${slug}.${ext}`;
    const savePath = path.join(USER_IMAGES_DIR, filename);
    fs.writeFileSync(savePath, buf);
    const index = loadImageIndex();
    const entry = {
      filename,
      path: savePath,
      caption: caption || '',
      timestamp: now.toISOString(),
      size: buf.length
    };
    index.unshift(entry);
    if (index.length > 200) index.splice(200);
    saveImageIndex(index);
    console.log(`[IMAGES] Saved: ${filename} (${buf.length} bytes)`);
    return entry;
  } catch (e) {
    console.error('[IMAGES] Failed to save image:', e.message);
    return null;
  }
}

function searchImageIndex(query) {
  const index = loadImageIndex();
  if (!query) return index.slice(0, 20);
  const q = query.toLowerCase();
  return index.filter(e =>
    e.caption.toLowerCase().includes(q) ||
    e.filename.toLowerCase().includes(q)
  ).slice(0, 20);
}

// ── SKILL LIBRARY ──────────────────────────────────────────────────────────
const SKILLS_DIR = path.join(__dirname, 'skills');

function ensureSkillsDir() {
  if (!fs.existsSync(SKILLS_DIR)) {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
    console.log('[SKILLS] Created skills directory');
  }
}

function listSkills() {
  ensureSkillsDir();
  try {
    return fs.readdirSync(SKILLS_DIR).filter(d => {
      const p = path.join(SKILLS_DIR, d);
      return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'metadata.yaml'));
    });
  } catch (e) {
    return [];
  }
}

function readSkill(skillName) {
  const skillDir = path.join(SKILLS_DIR, skillName);
  const metaPath = path.join(skillDir, 'metadata.yaml');
  const instrPath = path.join(skillDir, 'instructions.md');
  if (!fs.existsSync(metaPath)) return null;
  const meta = fs.readFileSync(metaPath, 'utf8');
  const instructions = fs.existsSync(instrPath) ? fs.readFileSync(instrPath, 'utf8') : '';
  return { name: skillName, metadata: meta, instructions };
}

function createSkill(skillName, description, triggerConditions, instructions, scripts = {}) {
  ensureSkillsDir();
  const skillDir = path.join(SKILLS_DIR, skillName);
  fs.mkdirSync(skillDir, { recursive: true });
  const now = new Date().toISOString();
  const meta = `name: ${skillName}\ndescription: ${description}\ntrigger_conditions:\n${triggerConditions.split(',').map(t => '  - ' + t.trim()).join('\n')}\ncreated_at: ${now}\nversion: 1\n`;
  fs.writeFileSync(path.join(skillDir, 'metadata.yaml'), meta);
  fs.writeFileSync(path.join(skillDir, 'instructions.md'), instructions);
  for (const [filename, content] of Object.entries(scripts)) {
    fs.writeFileSync(path.join(skillDir, filename), content);
  }
  console.log(`[SKILLS] Created skill: ${skillName}`);
  return { created: true, path: skillDir };
}

function updateSkillInstructions(skillName, correction) {
  const skillDir = path.join(SKILLS_DIR, skillName);
  const instrPath = path.join(skillDir, 'instructions.md');
  if (!fs.existsSync(instrPath)) return { updated: false, error: 'Skill not found' };
  const existing = fs.readFileSync(instrPath, 'utf8');
  const now = new Date().toISOString();
  const updated = existing + `\n\n---\n## Correction (${now})\n${correction}\n`;
  fs.writeFileSync(instrPath, updated);
  // Bump version in metadata
  const metaPath = path.join(skillDir, 'metadata.yaml');
  if (fs.existsSync(metaPath)) {
    let meta = fs.readFileSync(metaPath, 'utf8');
    meta = meta.replace(/version: (\d+)/, (_, v) => `version: ${parseInt(v) + 1}`);
    meta = meta + `last_updated: ${now}\n`;
    fs.writeFileSync(metaPath, meta);
  }
  console.log(`[SKILLS] Updated skill: ${skillName}`);
  return { updated: true, skill: skillName };
}

function checkSkillsForTask(taskDescription) {
  const skills = listSkills();
  if (skills.length === 0) return null;
  const desc = taskDescription.toLowerCase();
  for (const skillName of skills) {
    const skill = readSkill(skillName);
    if (!skill) continue;
    // Check if task description matches any trigger condition in metadata
    const triggers = skill.metadata.match(/  - (.+)/g) || [];
    for (const trigger of triggers) {
      const t = trigger.replace('  - ', '').toLowerCase().trim();
      if (t && desc.includes(t)) {
        return skill;
      }
    }
    // Also check if skill name words appear in description
    const nameWords = skillName.replace(/-/g, ' ').split(' ');
    if (nameWords.length >= 2 && nameWords.every(w => desc.includes(w))) {
      return skill;
    }
  }
  return null;
}

ensureSkillsDir();

// ── CORE MODULES (continued) ──────────────────────────────────────────────
const pluginLoader = require('./core/plugin-loader');
const memory = require('./core/memory');
const taskQueue = require('./task-queue');
const healthMonitor = require('./health-monitor');

// ── VALIDATE CONFIG ────────────────────────────────────────────────────────
const missingCritical = config.validateConfig();
if (missingCritical.length > 0) {
  console.error('[BOT] Cannot start without critical config. Set in .env file.');
  process.exit(1);
}

// ── INIT BOT ───────────────────────────────────────────────────────────────
const bot = new TelegramBot(config.TELEGRAM_TOKEN, { polling: true });
const OWNER_ID = config.OWNER_CHAT_ID;

// ── OPENAI DIRECT API KEY (used for Whisper, DALL-E, TTS only) ─────────────
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

console.log('[BOT] Solomon v6.1 starting...');

// ── LOAD PLUGINS ───────────────────────────────────────────────────────────
const pluginResults = pluginLoader.loadAllPlugins(config, { bot, memory, taskQueue });
console.log(`[BOT] Plugins: ${pluginResults.loaded.length} active, ${pluginResults.inactive.length} need keys`);

// ── LLM INTERFACE ──────────────────────────────────────────────────────────
async function callLLM(messages, tools = null, model = null) {
  const selectedModel = model || config.MODEL;
  const body = {
    model: selectedModel,
    messages,
    max_tokens: config.LLM_MAX_TOKENS,
    temperature: 0.7
  };
  if (tools && tools.length > 0) body.tools = tools;

  // Route ALL LLM calls through OpenRouter (supports vision/image_url with gpt-4o model)
  // Direct OpenAI calls are only used for Whisper, DALL-E, and TTS via openaiRequest()
  const apiUrl = config.OPENROUTER_URL;
  const authHeader = `Bearer ${config.OPENROUTER_API_KEY}`;

  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://solomonsforge.com',
        'X-Title': 'Solomon Bot v6'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.LLM_TIMEOUT)
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[LLM] Error ${res.status}: ${errText.slice(0, 200)}`);
      // Fallback to smaller model
      if (selectedModel !== config.MODEL_FALLBACK) {
        console.log('[LLM] Falling back to', config.MODEL_FALLBACK);
        return callLLM(messages, tools, config.MODEL_FALLBACK);
      }
      throw new Error(`LLM API error: ${res.status}`);
    }

    const data = await res.json();
    return data.choices[0].message;
  } catch (e) {
    console.error('[LLM] Call failed:', e.message);
    throw e;
  }
}

// ── BUILD TOOL LIST ────────────────────────────────────────────────────────
function getAvailableTools() {
  const tools = pluginLoader.getAllTools();
  // Add core tools
  tools.push(
    {
      type: 'function', function: {
        name: 'queue_task',
        description: 'Add a task to the background work queue for autonomous execution by CrewAI agents',
        parameters: { type: 'object', properties: {
          title: { type: 'string', description: 'Task title' },
          description: { type: 'string', description: 'Detailed task description' },
          type: { type: 'string', enum: ['research', 'content', 'code', 'pc_task', 'design', 'analysis'], description: 'Task type' },
          priority: { type: 'number', description: '1=urgent, 5=normal, 10=low' }
        }, required: ['title', 'description'] }
      }
    },
    {
      type: 'function', function: {
        name: 'check_queue',
        description: 'Check current task queue status — shows pending, active, and completed tasks',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    {
      type: 'function', function: {
        name: 'remember',
        description: 'Store important information in persistent memory (facts, decisions, preferences)',
        parameters: { type: 'object', properties: {
          category: { type: 'string', enum: ['facts', 'decisions', 'preferences', 'research_findings', 'contacts', 'credentials'], description: 'Memory category' },
          key: { type: 'string', description: 'Short identifier' },
          value: { type: 'string', description: 'Information to remember' }
        }, required: ['category', 'value'] }
      }
    },
    {
      type: 'function', function: {
        name: 'recall',
        description: 'Search persistent memory for stored information',
        parameters: { type: 'object', properties: {
          query: { type: 'string', description: 'What to search for' }
        }, required: ['query'] }
      }
    },
    {
      type: 'function', function: {
        name: 'generate_pdf',
        description: 'Generate a PDF document from markdown content and send it via Telegram',
        parameters: { type: 'object', properties: {
          title: { type: 'string', description: 'Document title' },
          markdown: { type: 'string', description: 'Full markdown content for the PDF' }
        }, required: ['title', 'markdown'] }
      }
    },
    {
      type: 'function', function: {
        name: 'system_health',
        description: 'Run a full system health check',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    {
      type: 'function', function: {
        name: 'generate_image',
        description: 'Generate an image using gpt-image-1. Use this for wallpapers, designs, artwork, thumbnails, or any visual content Jed requests. The image is sent directly to Jed in Telegram.',
        parameters: { type: 'object', properties: {
          prompt: { type: 'string', description: 'Detailed image generation prompt describing the desired image' }
        }, required: ['prompt'] }
      }
    },
    {
      type: 'function', function: {
        name: 'set_desktop_wallpaper',
        description: 'Download an image from a URL and set it as the Windows desktop wallpaper on Jed\'s PC. Use after generate_image to complete wallpaper requests.',
        parameters: { type: 'object', properties: {
          image_url: { type: 'string', description: 'URL of the image to download and set as wallpaper' },
          filename: { type: 'string', description: 'Filename to save as (e.g. wallpaper.jpg)' }
        }, required: ['image_url'] }
      }
    },
    {
      type: 'function', function: {
        name: 'recall_user_images',
        description: 'Search the saved images that Jed has previously sent via Telegram. Use this when Jed says "use the images I sent you" or references earlier photos. Returns file paths and captions of matching images.',
        parameters: { type: 'object', properties: {
          query: { type: 'string', description: 'Search term to filter images by caption or filename. Leave empty to get the most recent 20 images.' }
        }, required: [] }
      }
    },
    {
      type: 'function', function: {
        name: 'check_skills',
        description: 'Check if a skill exists for the current task. Call this BEFORE responding to any task request. If a matching skill is found, follow its instructions exactly.',
        parameters: { type: 'object', properties: {
          task_description: { type: 'string', description: 'Description of the task to check for a matching skill' }
        }, required: ['task_description'] }
      }
    },
    {
      type: 'function', function: {
        name: 'create_skill',
        description: 'Create a new skill in the skill library. Use when Jed says "make this a skill", "save that as a skill", "remember this workflow", or similar.',
        parameters: { type: 'object', properties: {
          skill_name: { type: 'string', description: 'Kebab-case skill name (e.g. desktop-wallpaper, content-sprint, youtube-upload)' },
          description: { type: 'string', description: 'One-sentence description of what this skill does' },
          trigger_conditions: { type: 'string', description: 'Comma-separated list of phrases/conditions that should trigger this skill' },
          instructions: { type: 'string', description: 'Step-by-step playbook in markdown format (under 5k tokens). Be specific and deterministic.' },
          script_filename: { type: 'string', description: 'Optional: filename for a supporting script (e.g. run.py, execute.sh)' },
          script_content: { type: 'string', description: 'Optional: content of the supporting script' }
        }, required: ['skill_name', 'description', 'trigger_conditions', 'instructions'] }
      }
    },
    {
      type: 'function', function: {
        name: 'update_skill',
        description: 'Update an existing skill with a correction or improvement. Use when Jed corrects you on a task that has a matching skill.',
        parameters: { type: 'object', properties: {
          skill_name: { type: 'string', description: 'Name of the skill to update' },
          correction: { type: 'string', description: 'The correction or improvement to add to the skill instructions' }
        }, required: ['skill_name', 'correction'] }
      }
    },
    {
      type: 'function', function: {
        name: 'list_skills',
        description: 'List all available skills in the skill library with their descriptions and trigger conditions.',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    }
  );
  return tools;
}

// ── TOOL EXECUTION ─────────────────────────────────────────────────────────
async function executeTool(toolName, args, chatId) {
  console.log(`[TOOL] Executing: ${toolName}`, JSON.stringify(args).slice(0, 100));

  // Core tools
  switch (toolName) {
    case 'queue_task':
      // For pc_task type: execute directly via PC Agent instead of queuing
      if (args.type === 'pc_task') {
        console.log('[TOOL] pc_task detected — routing directly to PC Agent:', args.title);
        const pcPlugin = pluginLoader.getPlugin('pc-agent');
        if (pcPlugin) {
          const psMatch = args.description && args.description.match(/```(?:powershell|ps1)?\n?([\s\S]+?)```/);
          const command = psMatch ? psMatch[1].trim() : args.description;
          const result = await pcPlugin.executeTool('pc_execute', { command, timeout: 60000 });
          return { executed: true, type: 'pc_task', title: args.title, result };
        }
        return { executed: false, error: 'PC Agent plugin not available' };
      }
      // For design type: execute gpt-image-1 image generation directly
      if (args.type === 'design') {
        console.log('[TOOL] design task detected — generating image directly:', args.title);
        try {
          const imagePath = await generateImage(args.description || args.title);
          await bot.sendPhoto(chatId, imagePath, { caption: `🎨 ${args.title}` });
          try { fs.unlinkSync(imagePath); } catch(e) {}
          return { executed: true, type: 'design', title: args.title, sent: true };
        } catch (e) {
          return { executed: false, error: e.message };
        }
      }
      // For all other task types: queue via CrewAI
      const task = taskQueue.addTask(args);
      if (task.duplicate) return { queued: false, reason: task.message };
      const crewResult = await crewai.submitTask(args.title || args.description, args.description || args.title, { id: task.id, agent: args.agent });
      if (crewResult.success) {
        console.log('[CREWAI] Task routed to', crewResult.agent, 'agent:', task.id);
      } else {
        console.log('[CREWAI] Submit failed:', crewResult.error);
      }
      return { queued: true, taskId: task.id, position: 'queued', crewai_agent: crewResult.agent || 'fallback' };

    case 'check_queue':
      return taskQueue.getQueueSummary();

    case 'remember':
      memory.addKnowledge(args.category, args.value, args.key);
      return { stored: true, category: args.category };

    case 'recall':
      const results = memory.searchKnowledge(args.query);
      return { found: results.length, results: results.map(r => ({ category: r.category, value: r.value })) };

    case 'generate_pdf':
      return await generateAndSendPDF(args.title, args.markdown, chatId);

    case 'system_health':
      return await healthMonitor.runFullCheck(config);

    case 'generate_image':
      try {
        console.log('[TOOL] Generating image:', args.prompt?.slice(0, 80));
        const imgPath = await generateImage(args.prompt);
        await bot.sendPhoto(chatId, imgPath, { caption: `🎨 Generated image` });
        try { fs.unlinkSync(imgPath); } catch(e) {}
        return { success: true, sent_to_chat: true };
      } catch (e) {
        console.error('[TOOL] Image generation failed:', e.message);
        return { success: false, error: e.message };
      }

    case 'set_desktop_wallpaper':
      try {
        const fname = args.filename || 'wallpaper.jpg';
        const wallpaperPath = `C:\\Users\\Ashle\\Pictures\\${fname}`;
        const psCmd = [
          `Invoke-WebRequest -Uri "${args.image_url}" -OutFile "${wallpaperPath}"`,
          `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class Wallpaper{[DllImport("user32.dll",CharSet=CharSet.Auto)]public static extern int SystemParametersInfo(int uAction,int uParam,string lpvParam,int fuWinIni);}' -ErrorAction SilentlyContinue`,
          `[Wallpaper]::SystemParametersInfo(20, 0, "${wallpaperPath}", 3)`,
          `Write-Output "Wallpaper set to ${wallpaperPath}"`
        ].join('; ');
        const pcPlugin = pluginLoader.getPlugin('pc-agent');
        if (pcPlugin) {
          const result = await pcPlugin.executeTool('pc_execute', { command: psCmd, timeout: 30000 });
          return { success: true, wallpaper_path: wallpaperPath, result };
        }
        return { success: false, error: 'PC Agent plugin not available' };
      } catch (e) {
        return { success: false, error: e.message };
      }

    case 'recall_user_images':
      const images = searchImageIndex(args.query || '');
      return {
        found: images.length,
        images: images.map(img => ({
          filename: img.filename,
          path: img.path,
          caption: img.caption,
          timestamp: img.timestamp,
          size_kb: Math.round(img.size / 1024)
        }))
      };

    case 'check_skills': {
      const matchedSkill = checkSkillsForTask(args.task_description || '');
      if (matchedSkill) {
        return {
          found: true,
          skill_name: matchedSkill.name,
          instructions: matchedSkill.instructions,
          metadata: matchedSkill.metadata
        };
      }
      return { found: false, available_skills: listSkills() };
    }

    case 'create_skill': {
      const scripts = {};
      if (args.script_filename && args.script_content) {
        scripts[args.script_filename] = args.script_content;
      }
      const result = createSkill(
        args.skill_name,
        args.description,
        args.trigger_conditions,
        args.instructions,
        scripts
      );
      return result;
    }

    case 'update_skill': {
      return updateSkillInstructions(args.skill_name, args.correction);
    }

    case 'list_skills': {
      const skillNames = listSkills();
      const skillList = skillNames.map(name => {
        const skill = readSkill(name);
        if (!skill) return { name };
        const descMatch = skill.metadata.match(/description: (.+)/);
        const triggersMatch = skill.metadata.match(/trigger_conditions:[\s\S]*?(?=\ncreated_at|\nversion|$)/);
        return {
          name,
          description: descMatch ? descMatch[1] : '',
          triggers: triggersMatch ? triggersMatch[0].replace('trigger_conditions:', '').trim() : ''
        };
      });
      return { count: skillList.length, skills: skillList };
    }
  }

  // Plugin tools (pc_execute, pc_status, pc_screenshot, web_search, fetch_url, etc.)
  const result = await pluginLoader.executePluginTool(toolName, args, { config, memory, bot });
  return result;
}

// ── PDF GENERATION ─────────────────────────────────────────────────────────
async function generateAndSendPDF(title, markdown, chatId) {
  const mdPath = `/tmp/sol_${Date.now()}.md`;
  const pdfPath = `/tmp/sol_${Date.now()}.pdf`;

  try {
    fs.writeFileSync(mdPath, `# ${title}\n\n${markdown}`);

    const { execSync } = require('child_process');
    let generated = false;

    // Method 1: weasyprint via markdown-to-html
    try {
      const htmlPath = `/tmp/sol_${Date.now()}.html`;
      const htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        body { font-family: 'Segoe UI', Arial, sans-serif; margin: 40px; line-height: 1.6; color: #333; }
        h1 { color: #1a1a2e; border-bottom: 2px solid #e94560; padding-bottom: 10px; }
        h2 { color: #16213e; margin-top: 30px; }
        code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; }
        pre { background: #f5f5f5; padding: 15px; border-radius: 5px; overflow-x: auto; }
        table { border-collapse: collapse; width: 100%; margin: 15px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background: #16213e; color: white; }
        blockquote { border-left: 4px solid #e94560; margin: 15px 0; padding: 10px 20px; background: #f9f9f9; }
      </style></head><body>${markdownToHtml(markdown, title)}</body></html>`;
      fs.writeFileSync(htmlPath, htmlContent);
      execSync(`weasyprint "${htmlPath}" "${pdfPath}"`, { timeout: 30000, env: { ...process.env, PATH: '/usr/local/bin:/usr/bin:/bin' } });
      generated = true;
    } catch (e) {
      console.log('[PDF] weasyprint failed:', e.message);
    }

    // Method 2: manus-md-to-pdf
    if (!generated) {
      try {
        execSync(`/usr/local/bin/manus-md-to-pdf "${mdPath}" "${pdfPath}"`, { timeout: 30000 });
        generated = true;
      } catch (e) {
        console.log('[PDF] manus-md-to-pdf failed:', e.message);
      }
    }

    if (!generated || !fs.existsSync(pdfPath)) {
      await bot.sendDocument(chatId, Buffer.from(`# ${title}\n\n${markdown}`), {
        caption: `📄 ${title} (PDF generation unavailable, sending as .md)`
      }, { filename: `${title.replace(/[^a-z0-9]/gi, '_')}.md`, contentType: 'text/markdown' });
      return { success: true, format: 'markdown', note: 'PDF tools unavailable, sent as .md' };
    }

    await bot.sendDocument(chatId, pdfPath, { caption: `📄 ${title}` });
    try { fs.unlinkSync(mdPath); fs.unlinkSync(pdfPath); } catch {}
    return { success: true, format: 'pdf' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function markdownToHtml(md, title) {
  let html = `<h1>${title}</h1>\n`;
  html += md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
  return `<p>${html}</p>`;
}

// ── OPENAI DIRECT CLIENT (for Whisper, gpt-image-1, TTS) ──────────────────────
const OPENAI_BASE = 'https://api.openai.com/v1';

async function openaiRequest(endpoint, body, isFormData = false) {
  const headers = { 'Authorization': `Bearer ${OPENAI_API_KEY}` };
  if (!isFormData) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${OPENAI_BASE}${endpoint}`, {
    method: 'POST',
    headers,
    body: isFormData ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(60000)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI ${endpoint} error ${res.status}: ${err.slice(0, 200)}`);
  }
  return res;
}

// Download a file from Telegram and return as Buffer
async function downloadTelegramFile(fileId) {
  const file = await bot.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${file.file_path}`;
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, filePath: file.file_path, url };
}

// Transcribe voice/audio using OpenAI Whisper
async function transcribeAudio(fileId) {
  const { buf, filePath } = await downloadTelegramFile(fileId);
  const ext = filePath.split('.').pop() || 'ogg';
  const { FormData, Blob } = await import('formdata-node');
  const form = new FormData();
  form.set('file', new Blob([buf], { type: `audio/${ext}` }), `audio.${ext}`);
  form.set('model', 'whisper-1');
  const res = await openaiRequest('/audio/transcriptions', form, true);
  const data = await res.json();
  return data.text;
}

// Generate image using gpt-image-1 (returns base64, saved to temp file)
async function generateImage(prompt) {
  const res = await openaiRequest('/images/generations', {
    model: 'gpt-image-1',
    prompt,
    n: 1,
    size: '1024x1024',
    quality: 'high'
  });
  const data = await res.json();
  // gpt-image-1 returns base64-encoded image data (not a URL)
  const b64 = data.data[0].b64_json;
  const tmpPath = `/tmp/sol_img_${Date.now()}.png`;
  fs.writeFileSync(tmpPath, Buffer.from(b64, 'base64'));
  return tmpPath;
}

// Generate TTS audio using OpenAI TTS
async function generateSpeech(text) {
  const res = await openaiRequest('/audio/speech', {
    model: 'tts-1',
    voice: 'onyx',
    input: text.slice(0, 4096)
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const tmpPath = `/tmp/sol_tts_${Date.now()}.mp3`;
  fs.writeFileSync(tmpPath, buf);
  return tmpPath;
}

// Extract text from PDF using pdftotext (poppler)
async function extractPdfText(buf) {
  const { execSync } = require('child_process');
  const tmpIn = `/tmp/sol_doc_${Date.now()}.pdf`;
  fs.writeFileSync(tmpIn, buf);
  try {
    const text = execSync(`pdftotext "${tmpIn}" -`, { timeout: 30000 }).toString();
    fs.unlinkSync(tmpIn);
    return text.slice(0, 8000);
  } catch (e) {
    fs.unlinkSync(tmpIn);
    throw new Error('PDF text extraction failed: ' + e.message);
  }
}

// ── MESSAGE HANDLER ────────────────────────────────────────────────────────
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  // FIX #8: Read both msg.text AND msg.caption for photo captions
  const rawText = msg.text || msg.caption || '';
  const hasPhoto = !!(msg.photo && msg.photo.length > 0);
  const hasVoice = !!(msg.voice || msg.audio);
  const hasDocument = !!(msg.document);

  // Skip if no content at all
  if (!rawText && !hasPhoto && !hasVoice && !hasDocument) return;

  // Owner check
  if (String(chatId) !== String(OWNER_ID)) {
    bot.sendMessage(chatId, "⚔️ Solomon's Forge is a private system. Access denied.");
    return;
  }

  // Handle commands (text only)
  if (rawText.startsWith('/')) {
    const handled = await handleCommand(rawText, chatId);
    if (handled) return;
  }

  try {
    let text = rawText;
    let userContent = rawText;
    let memoryText = rawText;
    let ttsRequested = false;

    // ── VOICE / AUDIO: Transcribe with Whisper ──────────────────────────────
    if (hasVoice) {
      bot.sendChatAction(chatId, 'typing');
      console.log('[VOICE] Transcribing audio message...');
      try {
        const fileId = (msg.voice || msg.audio).file_id;
        const transcript = await transcribeAudio(fileId);
        console.log('[VOICE] Transcript:', transcript.slice(0, 100));
        text = transcript;
        userContent = `[Voice message transcribed]: ${transcript}`;
        memoryText = userContent;
        await bot.sendMessage(chatId, `🎙️ _Heard: "${transcript.slice(0, 200)}${transcript.length > 200 ? '...' : ''}"_`, { parse_mode: 'Markdown' });
      } catch (e) {
        console.error('[VOICE] Transcription failed:', e.message);
        await bot.sendMessage(chatId, `⚠️ Could not transcribe audio: ${e.message}`);
        return;
      }
    }

    // ── PHOTO: Save to disk + Vision analysis ─────────────────────────────
    if (hasPhoto) {
      bot.sendChatAction(chatId, 'typing');
      const photo = msg.photo[msg.photo.length - 1]; // highest resolution
      console.log('[VISION] Photo received, file_id:', photo.file_id);
      try {
        const { buf, filePath } = await downloadTelegramFile(photo.file_id);

        // FIX #7: Persist image to disk for future reference
        const savedImage = await saveUserImage(buf, filePath, rawText || '');
        if (savedImage) {
          console.log(`[IMAGES] Persisted: ${savedImage.filename}`);
        }

        const base64Img = buf.toString('base64');
        const mimeType = filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
        const caption = rawText || 'What do you see in this image? Describe it in detail and share any relevant insights.';
        // Include saved path in context so LLM knows it can reference it later
        const savedNote = savedImage ? ` [Image saved to: ${savedImage.path}]` : '';
        userContent = [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Img}` } },
          { type: 'text', text: caption + savedNote }
        ];
        memoryText = rawText
          ? `[Image with caption: "${rawText}" — saved as ${savedImage ? savedImage.filename : 'unknown'}]`
          : `[Image sent — saved as ${savedImage ? savedImage.filename : 'unknown'}]`;
        text = caption;
        console.log('[VISION] Image prepared, caption:', rawText || '(none)');
      } catch (e) {
        console.error('[VISION] Image download failed:', e.message);
        userContent = rawText || 'I sent you an image but it could not be loaded.';
        memoryText = userContent;
        text = userContent;
      }
    }

    // ── DOCUMENT: Extract text from PDF/text files ──────────────────────────
    if (hasDocument) {
      bot.sendChatAction(chatId, 'typing');
      const doc = msg.document;
      const fileName = doc.file_name || 'document';
      console.log('[DOC] Document received:', fileName, doc.mime_type);
      try {
        const { buf } = await downloadTelegramFile(doc.file_id);
        let docText = '';
        if (doc.mime_type === 'application/pdf' || fileName.endsWith('.pdf')) {
          docText = await extractPdfText(buf);
        } else if (doc.mime_type && (doc.mime_type.startsWith('text/') || fileName.match(/\.(txt|md|csv|json|js|py|html|css)$/i))) {
          docText = buf.toString('utf-8').slice(0, 8000);
        } else {
          await bot.sendMessage(chatId, `⚠️ I can read PDFs and text files. This file type (${doc.mime_type || 'unknown'}) is not yet supported.`);
          return;
        }
        const userPrompt = rawText || `Please analyze this document (${fileName}) and summarize its key contents.`;
        text = userPrompt;
        userContent = `[Document: ${fileName}]\n\nContent:\n${docText}\n\nUser request: ${userPrompt}`;
        memoryText = `[Document "${fileName}" analyzed: ${userPrompt}]`;
        console.log('[DOC] Extracted', docText.length, 'chars from', fileName);
      } catch (e) {
        console.error('[DOC] Extraction failed:', e.message);
        await bot.sendMessage(chatId, `⚠️ Could not read document: ${e.message}`);
        return;
      }
    }

    // ── TTS DETECTION: "speak" or "voice reply" trigger ────────────────────
    const ttsTriggers = /^(speak|voice reply|say|read aloud|tts)[:\s]/i;
    if (ttsTriggers.test(text)) {
      ttsRequested = true;
      text = text.replace(ttsTriggers, '').trim();
      userContent = text;
      memoryText = `[TTS request]: ${text}`;
    }

    // Save message to memory
    memory.saveMessage(chatId, 'user', memoryText || text);

    // Build context
    const history = memory.getChatHistory(chatId, config.MAX_MESSAGES);
    const kbContext = memory.getKBContext();
    const tools = getAvailableTools();

    const messages = [
      { role: 'system', content: config.SYSTEM_PROMPT + PERSISTENT_MEMORY + kbContext },
      ...history,
      { role: 'user', content: userContent }
    ];

    // FIX #3: Always provide tools so the model can execute actions (including during vision)
    // FIX #4: All LLM calls go through OpenRouter (no direct OpenAI for chat)
    const visionModel = hasPhoto ? 'openai/gpt-4o' : null;
    let response = await callLLM(messages, tools, visionModel);
    let iterations = 0;
    const maxIterations = 8;

    // Tool call loop
    while (response.tool_calls && response.tool_calls.length > 0 && iterations < maxIterations) {
      iterations++;
      const toolResults = [];

      for (const toolCall of response.tool_calls) {
        const name = toolCall.function.name;
        let args = {};
        try { args = JSON.parse(toolCall.function.arguments); } catch {}

        console.log(`[TOOL] Iteration ${iterations}: ${name}`, JSON.stringify(args).slice(0, 200));
        const result = await executeTool(name, args, chatId);
        toolResults.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        });
      }

      // Push the assistant message (with tool_calls) properly formatted
      const assistantMsg = { role: 'assistant', tool_calls: response.tool_calls };
      if (response.content) assistantMsg.content = response.content;
      messages.push(assistantMsg);
      messages.push(...toolResults);
      response = await callLLM(messages, tools);
    }

    // FIX #2 & #5: If tool loop exhausted without text reply, use FRESH summary request
    if (!response.content) {
      try {
        console.log('[BOT] No text reply after tool loop, requesting summary...');
        // Collect tool execution results for context (fresh array avoids API 400)
        const toolSummaryParts = [];
        for (const m of messages) {
          if (m.role === 'tool' && m.content) {
            try {
              const parsed = JSON.parse(m.content);
              toolSummaryParts.push(JSON.stringify(parsed).slice(0, 500));
            } catch { toolSummaryParts.push(m.content.slice(0, 500)); }
          }
        }
        const toolContext = toolSummaryParts.length > 0
          ? `\n\nTool results from this session:\n${toolSummaryParts.join('\n')}`
          : '';
        const summaryMessages = [
          { role: 'system', content: 'You are Sol, Jed\'s AI assistant. Summarize what you just accomplished. Be direct and concise. If something failed, say so honestly.' },
          { role: 'user', content: `Jed asked: "${text}"\n\nYou executed ${iterations} tool call(s).${toolContext}\n\nPlease give Jed a concise, honest summary of what you did and the result. If the task is still in progress, say what's done and what's next.` }
        ];
        const summaryResponse = await callLLM(summaryMessages, null);
        if (summaryResponse && summaryResponse.content) {
          response = summaryResponse;
        }
      } catch (e) {
        console.error('[BOT] Summary call failed:', e.message);
      }
    }

    // FIX #2: NEVER go completely silent — always send something
    let reply = response.content;
    if (!reply) {
      console.log('[BOT] No reply content after summary attempt — sending fallback status.');
      reply = iterations > 0
        ? `⚔️ I executed ${iterations} action(s) for your request but hit an issue generating my response. The actions themselves may have succeeded — ask me for a status update or check /queue.`
        : `⚔️ I received your message but couldn't generate a response. Could you rephrase or try again?`;
    }
    memory.saveMessage(chatId, 'assistant', reply);

    // ── TTS: Send audio reply if requested ─────────────────────────────────
    if (ttsRequested) {
      try {
        bot.sendChatAction(chatId, 'record_voice');
        const audioPath = await generateSpeech(reply);
        await bot.sendVoice(chatId, audioPath);
        fs.unlinkSync(audioPath);
        return; // Don't also send text
      } catch (e) {
        console.error('[TTS] Speech generation failed:', e.message);
        // Fall through to send text reply instead
      }
    }

    // Split long messages (Telegram 4096 char limit)
    if (reply.length > 4000) {
      const chunks = splitMessage(reply, 4000);
      for (const chunk of chunks) {
        await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' }).catch(() =>
          bot.sendMessage(chatId, chunk)
        );
      }
    } else {
      await bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' }).catch(() => {
        const plain = reply
          .replace(/\*\*([^*]+)\*\*/g, '$1')
          .replace(/\*([^*]+)\*/g, '$1')
          .replace(/`([^`]+)`/g, '$1')
          .replace(/```[\s\S]*?```/g, '[code block]')
          .replace(/_{1,2}([^_]+)_{1,2}/g, '$1');
        return bot.sendMessage(chatId, plain);
      });
    }
  } catch (e) {
    console.error('[BOT] Message handling error:', e.message);
    bot.sendMessage(chatId, `⚠️ Error: ${e.message}\n\nI'm still operational. Try again or check /health.`);
  }
});

// ── COMMAND HANDLER ────────────────────────────────────────────────────────
async function handleCommand(text, chatId) {
  const [cmd, ...args] = text.split(' ');

  switch (cmd) {
    case '/start':
      bot.sendMessage(chatId, `⚔️ *Solomon's Forge v6.1* — Online\n\nI'm Sol, your autonomous business OS. What do you need?`, { parse_mode: 'Markdown' });
      return true;

    case '/health':
      bot.sendMessage(chatId, '🔍 Running deep health check...');
      const report = await healthMonitor.runFullCheck(config);
      bot.sendMessage(chatId, healthMonitor.formatReportForTelegram(report), { parse_mode: 'Markdown' });
      return true;

    case '/status':
      const summary = taskQueue.getQueueSummary();
      const plugins = pluginLoader.getActivePlugins();
      let statusMsg = `⚔️ *Sol Status*\n\n`;
      statusMsg += `🔌 Plugins: ${plugins.length} active\n`;
      statusMsg += `📋 Queue: ${summary.pending.length} pending, ${summary.active.length} active\n`;
      statusMsg += `✅ Completed: ${summary.stats.completed} | ❌ Failed: ${summary.stats.failed}\n`;
      bot.sendMessage(chatId, statusMsg, { parse_mode: 'Markdown' });
      return true;

    case '/plugins':
      const status = pluginLoader.getPluginStatus();
      let pluginMsg = '🔌 *Plugin Status*\n\n';
      for (const p of status) {
        const icon = p.active ? '✅' : '⚠️';
        pluginMsg += `${icon} *${p.name}* v${p.version}`;
        if (!p.active && p.reason) pluginMsg += ` — ${p.reason}`;
        pluginMsg += '\n';
      }
      bot.sendMessage(chatId, pluginMsg, { parse_mode: 'Markdown' });
      return true;

    case '/queue':
      const q = taskQueue.getQueueSummary();
      let qMsg = '📋 *Task Queue*\n\n';
      if (q.active.length > 0) qMsg += `*Active:*\n${q.active.map(t => `▶️ ${t.title} (${t.progress}%)`).join('\n')}\n\n`;
      if (q.pending.length > 0) qMsg += `*Pending:*\n${q.pending.map(t => `⏳ ${t.title}`).join('\n')}\n\n`;
      if (q.blocked.length > 0) qMsg += `*Blocked:*\n${q.blocked.map(t => `🚫 ${t.title}: ${t.blockReason}`).join('\n')}\n\n`;
      if (q.active.length === 0 && q.pending.length === 0) qMsg += '_Queue is empty._\n';
      bot.sendMessage(chatId, qMsg, { parse_mode: 'Markdown' });
      return true;

    case '/clear':
      memory.clearChatHistory(chatId);
      bot.sendMessage(chatId, '🧹 Chat history cleared. Fresh context.');
      return true;

    case '/capabilities':
      const caps = pluginLoader.getActivePlugins();
      let capMsg = '⚔️ *Sol\'s Capabilities*\n\n';
      for (const p of caps) {
        capMsg += `*${p.name}*: ${p.description}\n`;
        if (p.commands.length > 0) capMsg += `  Commands: ${p.commands.join(', ')}\n`;
        capMsg += '\n';
      }
      bot.sendMessage(chatId, capMsg, { parse_mode: 'Markdown' });
      return true;

    default:
      const pluginCommands = pluginLoader.getAllCommands();
      if (pluginCommands[cmd]) {
        return false;
      }
      return false;
  }
}

// ── UTILITIES ──────────────────────────────────────────────────────────────
function splitMessage(text, maxLen) {
  const chunks = [];
  while (text.length > maxLen) {
    let splitAt = text.lastIndexOf('\n', maxLen);
    if (splitAt === -1 || splitAt < maxLen / 2) splitAt = maxLen;
    chunks.push(text.slice(0, splitAt));
    text = text.slice(splitAt);
  }
  if (text) chunks.push(text);
  return chunks;
}

// ── WORKER INTEGRATION ─────────────────────────────────────────────────────
const workerAdapter = require('./worker-adapter');
// ── CREWAI BACKEND (Primary Task Processor) ───────────────────────────────
const CrewAIBridge = require('./crewai-bridge');
const crewai = new CrewAIBridge(bot, config.OWNER_CHAT_ID || '8762434280');

// Health check CrewAI on startup — retry for up to 30s
(async () => {
  const MAX_WAIT = 30000;
  const INTERVAL = 3000;
  let elapsed = 0;
  while (elapsed < MAX_WAIT) {
    const h = await crewai.health();
    if (h.status === 'healthy') {
      console.log('[CREWAI] Backend connected. Agents:', h.agents.join(', '));
      return;
    }
    elapsed += INTERVAL;
    if (elapsed < MAX_WAIT) {
      console.log('[CREWAI] Backend not ready yet, retrying in 3s... (' + elapsed/1000 + 's elapsed)');
      await new Promise(r => setTimeout(r, INTERVAL));
    }
  }
  console.log('[CREWAI] Backend did not respond within 30s — falling back to old worker.');
})();

// ── HEALTH CHECK SCHEDULER ─────────────────────────────────────────────────
setInterval(async () => {
  try {
    const report = await healthMonitor.runFullCheck(config);
    if (report.overall === 'critical') {
      bot.sendMessage(OWNER_ID, `🚨 *CRITICAL ALERT*\n\n${healthMonitor.formatReportForTelegram(report)}`, { parse_mode: 'Markdown' });
    }
  } catch {}
}, healthMonitor.CHECK_INTERVAL);

// ── DAILY CHECK-IN ─────────────────────────────────────────────────────────
function scheduleDailyCheckin() {
  const now = new Date();
  const target = new Date();
  target.setHours(config.DAILY_CHECKIN_HOUR, config.DAILY_CHECKIN_MINUTE, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  const delay = target - now;

  setTimeout(async () => {
    try {
      const health = await healthMonitor.runFullCheck(config);
      const queue = taskQueue.getQueueSummary();
      let msg = `☀️ *Good morning, Jed. Sol's daily report:*\n\n`;
      msg += healthMonitor.formatReportForTelegram(health);
      msg += `\n📋 Queue: ${queue.pending.length} pending, ${queue.stats.completed} completed total\n`;
      if (queue.pending.length > 0) {
        msg += `\nNext up:\n${queue.pending.slice(0, 3).map(t => `• ${t.title}`).join('\n')}`;
      }
      bot.sendMessage(OWNER_ID, msg, { parse_mode: 'Markdown' });
    } catch {}
    scheduleDailyCheckin();
  }, delay);
}
scheduleDailyCheckin();

// ── REMINDER CHECKER ───────────────────────────────────────────────────────
setInterval(() => {
  try {
    const due = memory.getDueReminders();
    for (const reminder of due) {
      bot.sendMessage(reminder.chat_id, `⏰ *Reminder:* ${reminder.text}`, { parse_mode: 'Markdown' });
      memory.markReminderFired(reminder.id);
    }
  } catch {}
}, 60000);

// ── GRACEFUL SHUTDOWN ──────────────────────────────────────────────────────
process.on('SIGTERM', () => {
  console.log('[BOT] Shutting down gracefully...');
  bot.stopPolling();
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('[BOT] Uncaught exception:', err.message, err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('[BOT] Unhandled rejection:', reason);
});

// ── INTERNAL CALLBACK SERVER (for Python CrewAI backend) ──────────────────
const http = require('http');
const internalServer = http.createServer(async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405); res.end('Method Not Allowed'); return;
  }
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const data = JSON.parse(body);
      const { type, message, title, pdf_path, md_path, task_id } = data;
      const chatId = OWNER_ID;

      if (req.url === '/notify/complete') {
        const caption = `✅ *${title || 'Task Complete'}*\n\n${(message || '').slice(0, 900)}`;
        if (pdf_path && fs.existsSync(pdf_path)) {
          await bot.sendDocument(chatId, pdf_path, { caption, parse_mode: 'Markdown' });
        } else if (md_path && fs.existsSync(md_path)) {
          await bot.sendDocument(chatId, md_path, { caption: caption + '\n_(PDF unavailable, sending markdown)_', parse_mode: 'Markdown' });
        } else {
          await bot.sendMessage(chatId, caption, { parse_mode: 'Markdown' });
        }
      } else if (req.url === '/notify/question') {
        await bot.sendMessage(chatId,
          `❓ *Sol needs your input:*\n\n${message || 'Please respond to continue.'}`,
          { parse_mode: 'Markdown' });
      } else if (req.url === '/notify/milestone') {
        await bot.sendMessage(chatId,
          `🏆 *Milestone:* ${title || ''}\n\n${message || ''}`,
          { parse_mode: 'Markdown' });
      } else if (req.url === '/notify/error') {
        await bot.sendMessage(chatId,
          `🚨 *Action needed:* ${title || 'Error'}\n\n${message || ''}\n\nPlease advise.`,
          { parse_mode: 'Markdown' });
      } else if (req.url === '/notify/blocked') {
        await bot.sendMessage(chatId,
          `🚫 *Blocked: ${title || 'Task'}*\n\n${message || ''}\n\nThis task needs your input to proceed.`,
          { parse_mode: 'Markdown' });
      } else {
        await bot.sendMessage(chatId, message || 'Notification from Sol.', { parse_mode: 'Markdown' });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      console.error('[INTERNAL-SERVER] Error:', e.message);
      res.writeHead(500); res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  });
});
internalServer.listen(4000, '127.0.0.1', () => {
  console.log('[BOT] Internal callback server listening on port 4000');
});

console.log('[BOT] Solomon v6.1 fully initialized. Awaiting commands.');

// ── STARTUP RECOVERY (SILENT) ──────────────────────────────────────────────
// FIX #9: No startup notification spam. Just recover interrupted tasks silently.
setTimeout(async () => {
  try {
    const queue = taskQueue.getQueueSummary();
    const interrupted = queue.active || [];
    let recovered = 0;
    for (const task of interrupted) {
      taskQueue.updateTask(task.id, {
        status: 'pending',
        result: null,
        startedAt: null,
        attempt: (task.attempt || 0) + 1,
        notes: 'Recovered from crash at ' + new Date().toISOString()
      });
      recovered++;
    }
    if (recovered > 0) {
      console.log(`[BOT] Startup recovery: ${recovered} tasks resumed`);
    }
    console.log(`[BOT] Queue: ${taskQueue.getQueueSummary().pending.length} pending`);
  } catch (e) {
    console.error('[BOT] Startup recovery error:', e.message);
  }
}, 3000);
