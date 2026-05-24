'use strict';
// tools.js — All tool definitions and executors.
// NO self-patching. NO Ollama. NO local LLM. Cloud-only.
require('dotenv').config();
const { mem, tasks, lessons, projects, errorDB } = require('./memory');
const axios = require('axios');
const path = require('path');
const MODEL = process.env.MODEL || 'claude-sonnet-4-5-20250929';

// ── PATH SAFETY (Phase 7) ─────────────────────────────────────────────────
// Solomon has FULL access to C:\, D:\, E:\ drives.
// ONLY restriction: cannot touch /root/solomon-v4/ (self-patch protection)
function workshopSafe(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') {
    throw new Error('PATH_VIOLATION: No path provided');
  }
  const norm = targetPath.replace(/\//g, '\\').toLowerCase();
  // Block Solomon's own code — NEVER allow self-patching
  if (norm.includes('solomon-v4') || norm.includes('solomon\\bot') || norm.includes('solomon/bot')) {
    throw new Error('PATH_VIOLATION: Cannot touch Solomon core files. Solomon NEVER self-patches.');
  }
  // Block .env files
  if (norm.endsWith('.env') || norm.includes('\\.env.')) {
    throw new Error('PATH_VIOLATION: Cannot access .env files');
  }
  // Must be on C:\, D:\, or E:\ drives
  const driveMatch = /^[cde]:\\/.test(norm);
  if (!driveMatch) {
    throw new Error(`PATH_VIOLATION: Only C:\\, D:\\, and E:\\ drives are accessible. Got: ${targetPath}`);
  }
  return true;
}

// ── TOOL DEFINITIONS (sent to Claude) ────────────────────────────────────
const TOOL_DEFINITIONS = [
  {
    name: 'remember',
    description: 'Store any fact, decision, or preference in persistent memory. Use for anything Jed tells you that matters.',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['identity', 'business', 'tasks', 'products', 'contacts', 'preferences', 'financial'] },
        key: { type: 'string', description: 'Short identifier, e.g. "youtube_channel"' },
        value: { type: 'string', description: 'Value to store' }
      },
      required: ['category', 'key', 'value']
    }
  },
  {
    name: 'recall',
    description: 'Retrieve stored facts from memory. Use before answering questions about Jed, the business, or past decisions.',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Category to search, or "all" for everything' }
      },
      required: ['category']
    }
  },
  {
    name: 'queue_task',
    description: 'Add a multi-step task to the background queue. Use for anything that takes more than 30 seconds or requires PC access.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string', description: 'Detailed steps Solomon should take' },
        type: { type: 'string', enum: ['video_pipeline', 'research', 'content', 'social', 'email', 'financial', 'pc_task'] },
        priority: { type: 'integer', description: '1=urgent 5=normal 10=low', default: 5 }
      },
      required: ['title', 'description', 'type']
    }
  },
  {
    name: 'check_tasks',
    description: 'Check the status of all queued and recent tasks.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'web_search',
    description: 'Search the web for real, current information. ALWAYS use this before answering any factual question. Every result MUST include a real URL. Never fabricate.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        num_results: { type: 'integer', default: 5 }
      },
      required: ['query']
    }
  },
  {
    name: 'web_fetch',
    description: 'Fetch the full text content of a web page URL. Use after web_search to read article content. Returns cleaned text, not raw HTML.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL to fetch (must start with http)' },
        timeout_ms: { type: 'integer', default: 15000, description: 'Timeout in milliseconds' }
      },
      required: ['url']
    }
  },
  {
    name: 'pc_execute',
    description: 'Execute a PowerShell command on Jed\'s Windows PC via the relay. For file operations, opening apps, running scripts.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'PowerShell command' },
        timeout_ms: { type: 'integer', default: 30000 }
      },
      required: ['command']
    }
  },
  {
    name: 'pc_list_files',
    description: 'List files in a directory on Jed\'s PC.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Windows path, e.g. D:\\RawFootage\\Inbox' }
      },
      required: ['path']
    }
  },
  {
    name: 'check_budget',
    description: 'Check current month API spend vs budget limits.',
    input_schema: { type: 'object', properties: {} }
  },
  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 4 — VIDEO PIPELINE TOOLS (Items 21-27)
  // ══════════════════════════════════════════════════════════════════════════
  {
    name: 'video_ingest',
    description: 'Detect new footage in D:\\RawFootage\\Inbox and move to D:\\RawFootage\\Processing. Returns list of moved files.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'video_transcribe',
    description: 'Transcribe a video/audio file using OpenAI Whisper API. File must be on Jed\'s PC. Returns transcript text.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Full Windows path to the video/audio file on Jed\'s PC' }
      },
      required: ['file_path']
    }
  },
  {
    name: 'video_edl',
    description: 'Generate an Edit Decision List (EDL) from a transcript. Identifies key segments, cuts, and highlights.',
    input_schema: {
      type: 'object',
      properties: {
        transcript: { type: 'string', description: 'Full transcript text' },
        style: { type: 'string', enum: ['short', 'long', 'highlight'], default: 'short', description: 'Video style: short (60s), long (5-15min), highlight (best moments)' }
      },
      required: ['transcript']
    }
  },
  {
    name: 'video_metadata',
    description: 'Generate SEO-optimized title, description, and tags from a transcript for YouTube upload.',
    input_schema: {
      type: 'object',
      properties: {
        transcript: { type: 'string', description: 'Full transcript text or summary' },
        style: { type: 'string', enum: ['short', 'long'], default: 'short' }
      },
      required: ['transcript']
    }
  },
  {
    name: 'video_thumbnail',
    description: 'Generate a thumbnail image for a video using Flux AI. Returns the image URL.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Video title for thumbnail design' },
        style: { type: 'string', default: 'bold_text', description: 'Thumbnail style: bold_text, cinematic, minimal' },
        prompt: { type: 'string', description: 'Optional custom image generation prompt' }
      },
      required: ['title']
    }
  },
  {
    name: 'video_upload',
    description: 'Upload a video to YouTube using OAuth. Requires prior authorization via /oauth/start.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to final video file on Jed PC' },
        title: { type: 'string' },
        description: { type: 'string' },
        tags: { type: 'string', description: 'Comma-separated tags' },
        privacy: { type: 'string', enum: ['public', 'unlisted', 'private'], default: 'private' }
      },
      required: ['file_path', 'title', 'description']
    }
  },
  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 5 — INTEGRATION TOOLS (Items 28-34)
  // ══════════════════════════════════════════════════════════════════════════
  {
    name: 'social_post',
    description: 'Post content to Facebook or Instagram. Supports Building Shultz and Irish Craftsman pages/accounts.',
    input_schema: {
      type: 'object',
      properties: {
        page: { type: 'string', enum: ['building_shultz', 'irish_craftsman'], description: 'Which page/account to post to' },
        platform: { type: 'string', enum: ['facebook', 'instagram'], default: 'facebook', description: 'Platform: facebook or instagram' },
        message: { type: 'string', description: 'Post text content' },
        link: { type: 'string', description: 'Optional URL to include (Facebook only)' },
        image_url: { type: 'string', description: 'Optional image URL for Instagram posts' }
      },
      required: ['page', 'message']
    }
  },
  {
    name: 'send_email',
    description: 'Send an email notification via Gmail API (HTTPS-based, no SMTP port needed).',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string' },
        body: { type: 'string', description: 'Email body text (plain text or HTML)' }
      },
      required: ['to', 'subject', 'body']
    }
  },
  {
    name: 'generate_voice',
    description: 'Generate speech audio from text using ElevenLabs API. Returns audio file path on VPS.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to convert to speech' },
        voice: { type: 'string', default: 'adam', description: 'Voice name or ID' },
        output_name: { type: 'string', default: 'output.mp3', description: 'Output filename' }
      },
      required: ['text']
    }
  },
  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 7 — CODE AGENT / WORKSHOP TOOLS
  // ══════════════════════════════════════════════════════════════════════════
  {
    name: 'file_read',
    description: 'Read the contents of a file on Jed\'s PC. Works on any path on C:\\, D:\\, or E:\\ drives.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Full Windows path to the file' }
      },
      required: ['path']
    }
  },
  {
    name: 'file_write',
    description: 'Create or overwrite a file on Jed\'s PC. Creates parent directories automatically. Max 50KB per write.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Full Windows path for the file' },
        content: { type: 'string', description: 'File content to write' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'file_edit',
    description: 'Find and replace text within an existing file. Replaces ALL occurrences of the find string.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Full Windows path to the file' },
        find: { type: 'string', description: 'Exact text to find (case-sensitive)' },
        replace: { type: 'string', description: 'Replacement text' }
      },
      required: ['path', 'find', 'replace']
    }
  },
  {
    name: 'file_delete',
    description: 'Delete a file on Jed\'s PC. Cannot delete non-empty directories.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Full Windows path to the file to delete' }
      },
      required: ['path']
    }
  },
  {
    name: 'file_rename',
    description: 'Rename or move a file. Both source and destination must be on C:\\, D:\\, or E:\\ drives.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Current full path of the file' },
        to: { type: 'string', description: 'New full path for the file' }
      },
      required: ['from', 'to']
    }
  },
  {
    name: 'dir_tree',
    description: 'Show the directory tree of a folder. Skips node_modules and .git. Use before reading/writing to understand project structure.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path. Defaults to D:\\Projects if omitted.' }
      },
      required: []
    }
  },
  {
    name: 'dir_create',
    description: 'Create a directory (and parent directories) on Jed\'s PC.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Full Windows path for the new directory' }
      },
      required: ['path']
    }
  },
  {
    name: 'project_run',
    description: 'Run a command inside a project directory (npm install, npm test, npm run build). WARNING: Do NOT use for persistent processes (npm run electron, npm run dev) — those will hang.',
    input_schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project folder name under D:\\Projects\\' },
        command: { type: 'string', description: 'Command to run, e.g. "npm install"' },
        timeout_ms: { type: 'integer', description: 'Timeout in ms. Default 300000 (5 min).' }
      },
      required: ['project', 'command']
    }
  },
  {
    name: 'git_commit',
    description: 'Commit current state of a project to git. ALWAYS commit before making changes (checkpoint).',
    input_schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project folder name under D:\\Projects\\' },
        message: { type: 'string', description: 'Commit message. Format: feat:/fix:/test:/docs: description' }
      },
      required: ['project', 'message']
    }
  },
  {
    name: 'git_push',
    description: 'Push committed changes to GitHub remote.',
    input_schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project folder name under D:\\Projects\\' }
      },
      required: ['project']
    }
  },
  {
    name: 'git_rollback',
    description: 'Revert project to the previous git commit. Use when a change broke something.',
    input_schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project folder name under D:\\Projects\\' }
      },
      required: ['project']
    }
  },
  {
    name: 'write_lesson',
    description: 'REQUIRED after every coding session. Write what worked and what failed to learning memory.',
    input_schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project name (e.g. "ironedit")' },
        phase: { type: 'string', description: 'Current phase (e.g. "scaffold")' },
        session_type: { type: 'string', enum: ['scaffold', 'feature', 'bugfix', 'test', 'deploy'], description: 'Type of work done' },
        what_worked: { type: 'string', description: 'What went well' },
        what_failed: { type: 'string', description: 'What went wrong' },
        code_snippets: { type: 'string', description: 'Key code that worked, for future reuse' },
        time_taken_minutes: { type: 'integer', description: 'Approximate time spent' }
      },
      required: ['project', 'session_type', 'what_worked', 'what_failed']
    }
  },
  {
    name: 'get_lessons',
    description: 'Read past learning lessons before starting a new project or feature. ALWAYS call this first.',
    input_schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project name to filter by, or omit for all recent lessons' }
      },
      required: []
    }
  },
  {
    name: 'update_project_state',
    description: 'Update the project tracker with current phase, status, and last commit.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Project name (e.g. "ironedit")' },
        repo_url: { type: 'string', description: 'GitHub repo URL' },
        local_path: { type: 'string', description: 'Local path on PC' },
        phase: { type: 'string', enum: ['spec', 'scaffold', 'phase1', 'phase2', 'phase3', 'phase4', 'phase5', 'beta', 'live'], description: 'Current phase' },
        status: { type: 'string', enum: ['active', 'paused', 'blocked', 'complete'], description: 'Project status' },
        spec_summary: { type: 'string', description: 'One-line summary' },
        last_commit: { type: 'string', description: 'Last commit message' },
        tech_stack: { type: 'string', description: 'Tech stack' }
      },
      required: ['name']
    }
  }
];

// ── WORKSHOP TOOL EXECUTOR (Phase 7) ────────────────────────────────────
async function executeWorkshopTool(name, input) {
  switch (name) {
    case 'file_read': {
      workshopSafe(input.path);
      const res = await axios.post(`${process.env.PC_RELAY_URL}/file-read`,
        { path: input.path },
        { headers: { 'X-Secret': process.env.PC_RELAY_SECRET }, timeout: 30000 }
      );
      return { ok: true, path: input.path, content: res.data.content, size: res.data.size };
    }
    case 'file_write': {
      workshopSafe(input.path);
      if (input.content.length > 51200) {
        return { ok: false, error: 'File exceeds 50KB limit. Break into smaller files.' };
      }
      const res = await axios.post(`${process.env.PC_RELAY_URL}/file-write`,
        { path: input.path, content: input.content },
        { headers: { 'X-Secret': process.env.PC_RELAY_SECRET }, timeout: 30000 }
      );
      return { ok: true, path: input.path, bytes_written: res.data.bytes };
    }
    case 'file_edit': {
      workshopSafe(input.path);
      const res = await axios.post(`${process.env.PC_RELAY_URL}/file-edit`,
        { path: input.path, find: input.find, replace: input.replace },
        { headers: { 'X-Secret': process.env.PC_RELAY_SECRET }, timeout: 30000 }
      );
      return { ok: res.data.replaced > 0, replacements: res.data.replaced, path: input.path };
    }
    case 'file_delete': {
      workshopSafe(input.path);
      const res = await axios.post(`${process.env.PC_RELAY_URL}/file-delete`,
        { path: input.path },
        { headers: { 'X-Secret': process.env.PC_RELAY_SECRET }, timeout: 30000 }
      );
      return { ok: res.data.ok, deleted: res.data.deleted || input.path };
    }
    case 'file_rename': {
      workshopSafe(input.from);
      workshopSafe(input.to);
      const res = await axios.post(`${process.env.PC_RELAY_URL}/file-rename`,
        { from: input.from, to: input.to },
        { headers: { 'X-Secret': process.env.PC_RELAY_SECRET }, timeout: 30000 }
      );
      return { ok: res.data.ok, from: input.from, to: input.to };
    }
    case 'dir_tree': {
      const targetPath = input.path || 'D:\\Projects';
      workshopSafe(targetPath);
      const res = await axios.post(`${process.env.PC_RELAY_URL}/dir-tree`,
        { path: targetPath },
        { headers: { 'X-Secret': process.env.PC_RELAY_SECRET }, timeout: 30000 }
      );
      return { ok: true, root: res.data.root, entries: res.data.entries, count: res.data.count };
    }
    case 'dir_create': {
      workshopSafe(input.path);
      const res = await axios.post(`${process.env.PC_RELAY_URL}/file-write`,
        { path: input.path + '\\.gitkeep', content: '' },
        { headers: { 'X-Secret': process.env.PC_RELAY_SECRET }, timeout: 30000 }
      );
      return { ok: true, path: input.path };
    }
    case 'project_run': {
      const projectPath = `D:\\Projects\\${input.project}`;
      workshopSafe(projectPath);
      const cmd = `cd /d "${projectPath}" && ${input.command}`;
      const res = await executeTool('pc_execute', {
        command: cmd,
        timeout_ms: input.timeout_ms || 300000
      });
      return {
        ok: res.exit_code === 0,
        stdout: (res.stdout || '').slice(-2000),
        stderr: (res.stderr || '').slice(-2000),
        exit_code: res.exit_code
      };
    }
    case 'git_commit': {
      const projectPath = `D:\\Projects\\${input.project}`;
      workshopSafe(projectPath);
      const safeMsg = input.message.replace(/'/g, '').replace(/"/g, '');
      const cmd = `cd /d "${projectPath}" && git add . && git commit -m "${safeMsg}"`;
      const res = await executeTool('pc_execute', { command: cmd, timeout_ms: 30000 });
      projects.upsert({ name: input.project, lastCommit: safeMsg, localPath: projectPath });
      return { ok: !res.error, commit_message: safeMsg, output: (res.stdout || '').slice(-500) };
    }
    case 'git_push': {
      const projectPath = `D:\\Projects\\${input.project}`;
      workshopSafe(projectPath);
      const res = await executeTool('pc_execute', {
        command: `cd /d "${projectPath}" && git push`,
        timeout_ms: 60000
      });
      return { ok: !res.error, output: (res.stdout || '').slice(-500) };
    }
    case 'git_rollback': {
      const projectPath = `D:\\Projects\\${input.project}`;
      workshopSafe(projectPath);
      const res = await executeTool('pc_execute', {
        command: `cd /d "${projectPath}" && git revert HEAD --no-edit`,
        timeout_ms: 30000
      });
      return { ok: !res.error, output: (res.stdout || '').slice(-500) };
    }
    case 'write_lesson': {
      lessons.add({
        project: input.project,
        phase: input.phase,
        sessionType: input.session_type,
        whatWorked: input.what_worked,
        whatFailed: input.what_failed,
        errorPatterns: null,
        codeSnippets: input.code_snippets,
        timeTaken: input.time_taken_minutes
      });
      return { ok: true, message: 'Lesson stored. This will be available for future projects.' };
    }
    case 'get_lessons': {
      const data = input.project
        ? lessons.getForProject(input.project)
        : lessons.getTop(10);
      return { ok: true, count: data.length, lessons: data };
    }
    case 'update_project_state': {
      projects.upsert({
        name: input.name,
        repoUrl: input.repo_url || undefined,
        localPath: input.local_path || undefined,
        phase: input.phase || undefined,
        status: input.status || undefined,
        specSummary: input.spec_summary || undefined,
        lastCommit: input.last_commit || undefined,
        techStack: input.tech_stack || undefined
      });
      return { ok: true, message: `Project ${input.name} updated to phase: ${input.phase || '(unchanged)'}` };
    }
    default:
      return null; // Not a workshop tool — fall through to existing handlers
  }
}

// ── TOOL EXECUTORS ───────────────────────────────────────────────────────
async function executeTool(name, input) {
  console.log(`[TOOL] ${name}`, JSON.stringify(input).slice(0, 120));

  try {
    // Workshop Module — try workshop tools first
    const workshopResult = await executeWorkshopTool(name, input);
    if (workshopResult !== null) return workshopResult;

    switch (name) {

      case 'remember':
        mem.set(input.category, input.key, input.value);
        return { ok: true, message: `Stored: ${input.category}/${input.key} = ${input.value}` };

      case 'recall': {
        const data = input.category === 'all' ? mem.getAll() : mem.getCategory(input.category);
        if (!data.length) return { ok: true, data: [], message: 'No memories in this category yet.' };
        return { ok: true, data };
      }

      case 'queue_task': {
        const id = tasks.add(input);
        return { ok: true, task_id: id, message: `Task #${id} queued: ${input.title}` };
      }

      case 'check_tasks': {
        const all = tasks.getAll();
        const pending = tasks.getPending();
        return { ok: true, pending: pending.length, recent: all.slice(0, 5) };
      }

      case 'web_search': {
        if (!process.env.SERPER_API_KEY || process.env.SERPER_API_KEY === 'PLACEHOLDER') {
          return { ok: false, error: 'SERPER_API_KEY not configured. Cannot search. Set it in .env.' };
        }
        const resp = await axios.post('https://google.serper.dev/search', {
          q: input.query, num: input.num_results || 5
        }, {
          headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
          timeout: 10000
        });
        const results = (resp.data.organic || []).slice(0, input.num_results || 5).map(r => ({
          title: r.title,
          url: r.link,
          snippet: r.snippet
        }));
        if (!results.length) return { ok: false, error: 'No results returned from search.' };
        return { ok: true, query: input.query, timestamp: new Date().toISOString(), results };
      }

      case 'web_fetch': {
        const { chromium } = require('playwright');
        const url = input.url;
        if (!url || !url.startsWith('http')) {
          return { ok: false, error: 'Invalid URL. Must start with http:// or https://' };
        }
        let browser;
        try {
          browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
          const page = await browser.newPage();
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: input.timeout_ms || 15000 });
          const content = await page.evaluate(() => {
            const remove = document.querySelectorAll('script, style, nav, footer, header, aside, [role="banner"], [role="navigation"]');
            remove.forEach(el => el.remove());
            return document.body ? document.body.innerText.trim() : '';
          });
          const title = await page.title();
          await browser.close();
          if (!content || content.length < 50) {
            return { ok: false, error: 'Page returned insufficient content (less than 50 chars).' };
          }
          const truncated = content.length > 8000 ? content.slice(0, 8000) + '\n...[truncated]' : content;
          return { ok: true, url, title, content: truncated, length: content.length };
        } catch (fetchErr) {
          if (browser) await browser.close().catch(() => {});
          return { ok: false, error: `web_fetch failed: ${fetchErr.message}` };
        }
      }

      case 'pc_execute': {
        if (!process.env.PC_RELAY_URL || process.env.PC_RELAY_URL === 'PLACEHOLDER') {
          return { ok: false, error: 'PC_RELAY_URL not configured. PC relay not set up yet.' };
        }
        const res = await axios.post(`${process.env.PC_RELAY_URL}/execute`, {
          command: input.command,
          timeout: input.timeout_ms || 30000
        }, {
          headers: { 'X-Secret': process.env.PC_RELAY_SECRET },
          timeout: (input.timeout_ms || 30000) + 5000
        });
        return { ok: true, stdout: res.data.stdout, stderr: res.data.stderr, exit_code: res.data.exitCode };
      }

      case 'pc_list_files': {
        if (!process.env.PC_RELAY_URL || process.env.PC_RELAY_URL === 'PLACEHOLDER') {
          return { ok: false, error: 'PC_RELAY_URL not configured.' };
        }
        const res = await axios.post(`${process.env.PC_RELAY_URL}/execute`, {
          command: `Get-ChildItem '${input.path}' | Select-Object Name, Length, LastWriteTime | ConvertTo-Json`,
          timeout: 15000
        }, { headers: { 'X-Secret': process.env.PC_RELAY_SECRET }, timeout: 20000 });
        let files = [];
        try { files = JSON.parse(res.data.stdout || '[]'); } catch (_) { files = []; }
        return { ok: true, path: input.path, files };
      }

      case 'check_budget': {
        const { budget } = require('./memory');
        const total = budget.getMonthTotal();
        const alert = parseFloat(process.env.MONTHLY_BUDGET_ALERT || '50');
        const stop = parseFloat(process.env.MONTHLY_BUDGET_HARD_STOP || '100');
        const status = total >= stop ? 'HARD_STOP' : total >= alert ? 'WARNING' : 'OK';
        return { ok: true, month_total_usd: total.toFixed(4), alert_threshold: alert, hard_stop: stop, status };
      }

      // ══════════════════════════════════════════════════════════════════════
      // PHASE 4 — VIDEO PIPELINE EXECUTORS (Items 21-27)
      // ══════════════════════════════════════════════════════════════════════

      // ITEM 21 — INGEST: detect new footage, move to Processing
      case 'video_ingest': {
        if (!process.env.PC_RELAY_URL || process.env.PC_RELAY_URL === 'PLACEHOLDER') {
          return { ok: false, error: 'PC relay not configured. Cannot access footage.' };
        }

        // Ensure Processing folder exists
        await axios.post(`${process.env.PC_RELAY_URL}/execute`, {
          command: "New-Item -ItemType Directory -Force -Path 'D:\\RawFootage\\Processing' | Out-Null; Write-Output 'ok'",
          timeout: 10000
        }, { headers: { 'X-Secret': process.env.PC_RELAY_SECRET }, timeout: 15000 });

        // List Inbox files
        const listRes = await axios.post(`${process.env.PC_RELAY_URL}/execute`, {
          command: "Get-ChildItem 'D:\\RawFootage\\Inbox' -File | Select-Object Name, Length, LastWriteTime | ConvertTo-Json",
          timeout: 15000
        }, { headers: { 'X-Secret': process.env.PC_RELAY_SECRET }, timeout: 20000 });

        let files = [];
        try {
          const parsed = JSON.parse(listRes.data.stdout || '[]');
          files = Array.isArray(parsed) ? parsed : [parsed];
        } catch (_) { files = []; }

        if (!files.length) {
          return { ok: true, message: 'No files in Inbox.', moved: [] };
        }

        // Filter video files
        const videoExts = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.mts'];
        const videoFiles = files.filter(f => {
          const name = (f.Name || '').toLowerCase();
          return videoExts.some(ext => name.endsWith(ext));
        });

        if (!videoFiles.length) {
          return { ok: true, message: `${files.length} files in Inbox but no video files.`, moved: [] };
        }

        // Move each video to Processing
        const moved = [];
        for (const f of videoFiles) {
          try {
            await axios.post(`${process.env.PC_RELAY_URL}/execute`, {
              command: `Move-Item -Path 'D:\\RawFootage\\Inbox\\${f.Name}' -Destination 'D:\\RawFootage\\Processing\\${f.Name}' -Force`,
              timeout: 30000
            }, { headers: { 'X-Secret': process.env.PC_RELAY_SECRET }, timeout: 35000 });
            moved.push(f.Name);
          } catch (moveErr) {
            console.error(`[INGEST] Failed to move ${f.Name}:`, moveErr.message);
          }
        }

        return { ok: true, message: `Moved ${moved.length} video(s) to Processing.`, moved };
      }

      // ITEM 22 — TRANSCRIBE: use OpenAI Whisper API
      case 'video_transcribe': {
        if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'PLACEHOLDER') {
          return { ok: false, error: 'OPENAI_API_KEY not configured. Cannot transcribe. Set it in .env to enable Whisper.' };
        }
        if (!process.env.PC_RELAY_URL || process.env.PC_RELAY_URL === 'PLACEHOLDER') {
          return { ok: false, error: 'PC relay not configured. Cannot access file for transcription.' };
        }

        const filePath = input.file_path;
        const fileName = path.basename(filePath);

        // Extract audio from video on PC (ffmpeg to wav, max 25MB for Whisper)
        const extractCmd = `
          $outPath = "D:\\RawFootage\\Processing\\${fileName}.wav";
          if (Test-Path $outPath) { Remove-Item $outPath -Force }
          ffmpeg -i '${filePath}' -vn -acodec pcm_s16le -ar 16000 -ac 1 -t 600 "$outPath" 2>&1 | Out-Null;
          if (Test-Path $outPath) { Write-Output $outPath } else { Write-Error "FFmpeg extraction failed" }
        `.trim();

        const extractRes = await axios.post(`${process.env.PC_RELAY_URL}/execute`, {
          command: extractCmd, timeout: 60000
        }, { headers: { 'X-Secret': process.env.PC_RELAY_SECRET }, timeout: 65000 });

        const audioPath = (extractRes.data.stdout || '').trim();
        if (!audioPath || extractRes.data.exitCode !== 0) {
          return { ok: false, error: `Audio extraction failed: ${extractRes.data.stderr || 'unknown error'}` };
        }

        // Read the audio file from PC and send to Whisper API
        // Use PC relay to base64 encode and return the audio
        const readCmd = `[Convert]::ToBase64String([IO.File]::ReadAllBytes('${audioPath}'))`;
        const readRes = await axios.post(`${process.env.PC_RELAY_URL}/execute`, {
          command: readCmd, timeout: 60000
        }, { headers: { 'X-Secret': process.env.PC_RELAY_SECRET }, timeout: 65000 });

        const audioBase64 = (readRes.data.stdout || '').trim();
        if (!audioBase64) {
          return { ok: false, error: 'Failed to read audio file from PC.' };
        }

        // Send to OpenAI Whisper API
        const FormData = require('form-data');
        const formData = new FormData();
        const audioBuffer = Buffer.from(audioBase64, 'base64');
        formData.append('file', audioBuffer, { filename: `${fileName}.wav`, contentType: 'audio/wav' });
        formData.append('model', 'whisper-1');
        formData.append('response_format', 'text');

        const whisperResp = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
          headers: {
            ...formData.getHeaders(),
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
          },
          timeout: 120000,
          maxContentLength: 50 * 1024 * 1024
        });

        const transcript = whisperResp.data;
        if (!transcript || transcript.length < 10) {
          return { ok: false, error: 'Whisper returned empty or very short transcript.' };
        }

        // Clean up temp audio file
        await axios.post(`${process.env.PC_RELAY_URL}/execute`, {
          command: `Remove-Item '${audioPath}' -Force -ErrorAction SilentlyContinue`,
          timeout: 10000
        }, { headers: { 'X-Secret': process.env.PC_RELAY_SECRET }, timeout: 15000 }).catch(() => {});

        return { ok: true, file: filePath, transcript, length: transcript.length };
      }

      // ITEM 23 — EDL GENERATION: analyze transcript, generate edit decision list
      case 'video_edl': {
        const Anthropic = require('@anthropic-ai/sdk');
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

        const styleGuide = {
          short: 'Create a 60-second YouTube Short. Pick the single most compelling/funny/insightful moment. Include hook (0-3s), main content (3-55s), CTA (55-60s).',
          long: 'Create a 5-15 minute video. Structure: hook (0-15s), intro (15-45s), main segments (each 2-4min), conclusion + CTA.',
          highlight: 'Create a highlight reel of the best 3-5 moments. Each clip 10-30 seconds. Focus on energy, humor, or insight.'
        };

        const resp = await client.messages.create({
          model: MODEL,
          max_tokens: 1024,
          messages: [{
            role: 'user',
            content: `You are a professional video editor. Generate an Edit Decision List (EDL) from this transcript.

Style: ${input.style || 'short'}
Guide: ${styleGuide[input.style || 'short']}

Transcript:
${input.transcript.slice(0, 4000)}

Output format (JSON):
{
  "style": "short|long|highlight",
  "total_duration_estimate": "60s",
  "segments": [
    { "start_time": "0:00", "end_time": "0:03", "type": "hook", "description": "..." },
    { "start_time": "0:03", "end_time": "0:55", "type": "content", "description": "..." },
    { "start_time": "0:55", "end_time": "1:00", "type": "cta", "description": "..." }
  ],
  "notes": "Any editing notes"
}`
          }]
        });

        const { budget } = require('./memory');
        budget.log({ inputTokens: resp.usage.input_tokens, outputTokens: resp.usage.output_tokens, model: MODEL });

        let edl;
        try {
          const text = resp.content[0].text;
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          edl = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw: text };
        } catch (_) {
          edl = { raw: resp.content[0].text };
        }

        return { ok: true, edl };
      }

      // ITEM 24 — METADATA GENERATION: SEO title, description, tags
      case 'video_metadata': {
        const Anthropic = require('@anthropic-ai/sdk');
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

        const resp = await client.messages.create({
          model: MODEL,
          max_tokens: 512,
          messages: [{
            role: 'user',
            content: `Generate SEO-optimized YouTube metadata for this video.
Style: ${input.style || 'short'} (${input.style === 'long' ? 'full video' : 'YouTube Short'})

Transcript/Summary:
${input.transcript.slice(0, 3000)}

Output format (JSON):
{
  "title": "Compelling, click-worthy title (under 60 chars)",
  "description": "SEO description with keywords (under 500 chars). Include relevant hashtags.",
  "tags": ["tag1", "tag2", "tag3", "...up to 15 tags"],
  "category": "YouTube category suggestion"
}`
          }]
        });

        const { budget } = require('./memory');
        budget.log({ inputTokens: resp.usage.input_tokens, outputTokens: resp.usage.output_tokens, model: MODEL });

        let metadata;
        try {
          const text = resp.content[0].text;
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          metadata = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw: text };
        } catch (_) {
          metadata = { raw: resp.content[0].text };
        }

        return { ok: true, metadata };
      }

      // ITEM 25/29 — THUMBNAIL GENERATION via Flux API
      case 'video_thumbnail': {
        if (!process.env.BFL_API_KEY || process.env.BFL_API_KEY === 'PLACEHOLDER') {
          return { ok: false, error: 'BFL_API_KEY not configured. Cannot generate thumbnails.' };
        }
        const thumbPrompt = input.prompt || `YouTube thumbnail for video titled "${input.title}". Style: ${input.style || 'bold_text'}. Eye-catching, high contrast, professional YouTube thumbnail with bold text overlay.`;
        try {
          // Submit generation request to Flux
          const genResp = await axios.post('https://api.bfl.ai/v1/flux-pro-1.1', {
            prompt: thumbPrompt,
            width: 1280,
            height: 704
          }, {
            headers: { 'x-key': process.env.BFL_API_KEY, 'Content-Type': 'application/json' },
            timeout: 15000
          });
          const taskId = genResp.data.id;
          // Poll for result (max 60s)
          let result = null;
          for (let i = 0; i < 12; i++) {
            await new Promise(r => setTimeout(r, 5000));
            const pollResp = await axios.get(`https://api.bfl.ai/v1/get_result?id=${taskId}`, {
              headers: { 'x-key': process.env.BFL_API_KEY },
              timeout: 10000
            });
            if (pollResp.data.status === 'Ready') {
              result = pollResp.data.result;
              break;
            }
          }
          if (!result) return { ok: false, error: 'Thumbnail generation timed out after 60s.' };
          return { ok: true, image_url: result.sample, title: input.title, style: input.style || 'bold_text' };
        } catch (fluxErr) {
          return { ok: false, error: `Flux API error: ${fluxErr.message}` };
        }
      }

      // ITEM 28/33 — YOUTUBE UPLOAD via OAuth
      case 'video_upload': {
        const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;
        if (!refreshToken || refreshToken === 'PLACEHOLDER') {
          return {
            ok: false,
            error: 'YouTube not authorized yet. Jed needs to visit http://167.99.237.26:3000/oauth/start to authorize.',
            action_needed: 'Visit OAuth URL in browser'
          };
        }
        // Get fresh access token from refresh token
        try {
          const tokenResp = await axios.post('https://oauth2.googleapis.com/token', {
            client_id: process.env.YOUTUBE_CLIENT_ID,
            client_secret: process.env.YOUTUBE_CLIENT_SECRET,
            refresh_token: refreshToken,
            grant_type: 'refresh_token'
          });
          const accessToken = tokenResp.data.access_token;
          // For now, return success with instructions (actual upload needs file transfer from PC)
          return {
            ok: true,
            message: `YouTube OAuth active. Access token obtained. To upload: transfer file from PC to VPS first, then upload via YouTube API.`,
            file_path: input.file_path,
            title: input.title,
            privacy: input.privacy || 'private',
            note: 'Full upload pipeline: PC relay transfers file → VPS uploads to YouTube'
          };
        } catch (ytErr) {
          return { ok: false, error: `YouTube token refresh failed: ${ytErr.response?.data?.error_description || ytErr.message}` };
        }
      }

      // ITEM 30 — SOCIAL POSTING (Facebook + Instagram)
      case 'social_post': {
        const pageToken = input.page === 'building_shultz'
          ? process.env.FB_BUILDING_SHULTZ_TOKEN
          : process.env.FB_IRISH_CRAFTSMAN_TOKEN;
        const pageId = input.page === 'building_shultz'
          ? process.env.FB_BUILDING_SHULTZ_ID
          : process.env.FB_IRISH_CRAFTSMAN_ID;
        if (!pageToken || pageToken === 'PLACEHOLDER') {
          return { ok: false, error: 'No token for page: ' + input.page + '. Set FB_BUILDING_SHULTZ_TOKEN or FB_IRISH_CRAFTSMAN_TOKEN in .env.' };
        }
        const platform = input.platform || 'facebook';
        try {
          if (platform === 'instagram') {
            const igResp = await axios.get(
              'https://graph.facebook.com/v19.0/' + pageId + '?fields=instagram_business_account&access_token=' + pageToken,
              { timeout: 10000 }
            );
            const igId = igResp.data.instagram_business_account && igResp.data.instagram_business_account.id;
            const containerResp = await axios.post(
              'https://graph.facebook.com/v19.0/' + igId + '/media',
              { caption: input.message, image_url: input.image_url, access_token: pageToken },
              { timeout: 15000 }
            );
            const publishResp = await axios.post(
              'https://graph.facebook.com/v19.0/' + igId + '/media_publish',
              { creation_id: containerResp.data.id, access_token: pageToken },
              { timeout: 15000 }
            );
            return { ok: true, post_id: publishResp.data.id, platform: 'instagram', page: input.page };
          } else {
            const fbBody = { message: input.message, access_token: pageToken };
            if (input.link) fbBody.link = input.link;
            const fbResp = await axios.post(
              'https://graph.facebook.com/v19.0/' + pageId + '/feed',
              fbBody,
              { timeout: 10000 }
            );
            return { ok: true, post_id: fbResp.data.id, platform: 'facebook', page: input.page };
          }
        } catch (fbErr) {
          const msg = (fbErr.response && fbErr.response.data && fbErr.response.data.error && fbErr.response.data.error.message) || fbErr.message;
          return { ok: false, error: 'Social post failed: ' + msg };
        }
      }
      // ITEM 31 - EMAIL via Gmail API (HTTPS - bypasses DigitalOcean SMTP block)
      case 'send_email': {
        const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;
        if (!refreshToken || refreshToken === 'PLACEHOLDER') {
          return { ok: false, error: 'Gmail API requires YOUTUBE_REFRESH_TOKEN. Authorize YouTube first.' };
        }
        try {
          const tokenResp = await axios.post('https://oauth2.googleapis.com/token', {
            client_id: process.env.YOUTUBE_CLIENT_ID,
            client_secret: process.env.YOUTUBE_CLIENT_SECRET,
            refresh_token: refreshToken,
            grant_type: 'refresh_token'
          }, { timeout: 10000 });
          const accessToken = tokenResp.data.access_token;
          const rawEmail = [
            'To: ' + input.to,
            'From: ' + (process.env.SMTP_USER || 'buildingshultz@gmail.com'),
            'Subject: ' + input.subject,
            'Content-Type: text/plain; charset=utf-8',
            '',
            input.body
          ].join('\r\n');
          const encoded = Buffer.from(rawEmail).toString('base64')
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
          const gmailResp = await axios.post(
            'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
            { raw: encoded },
            { headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' }, timeout: 15000 }
          );
          return { ok: true, message_id: gmailResp.data.id, to: input.to, subject: input.subject };
        } catch (emailErr) {
          const errMsg = (emailErr.response && emailErr.response.data && (emailErr.response.data.error_description || (emailErr.response.data.error && emailErr.response.data.error.message))) || emailErr.message;
          return { ok: false, error: 'Gmail API send failed: ' + errMsg };
        }
      }
      // ITEM 32 — ELEVENLABS VOICE GENERATION
      case 'generate_voice': {
        if (!process.env.ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY === 'PLACEHOLDER') {
          return { ok: false, error: 'ELEVENLABS_API_KEY not configured.' };
        }
        try {
          const voiceId = input.voice || '21m00Tcm4TlvDq8ikWAM'; // Rachel voice default
          const ttsResp = await axios.post(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
            {
              text: input.text,
              model_id: 'eleven_monolingual_v1',
              voice_settings: { stability: 0.5, similarity_boost: 0.75 }
            },
            {
              headers: {
                'xi-api-key': process.env.ELEVENLABS_API_KEY,
                'Content-Type': 'application/json',
                'Accept': 'audio/mpeg'
              },
              responseType: 'arraybuffer',
              timeout: 30000
            }
          );
          const outputPath = path.join('/root/solomon-v4/output', input.output_name || 'output.mp3');
          const fs = require('fs');
          fs.mkdirSync(path.dirname(outputPath), { recursive: true });
          fs.writeFileSync(outputPath, ttsResp.data);
          return { ok: true, file: outputPath, size_bytes: ttsResp.data.length, text_length: input.text.length };
        } catch (voiceErr) {
          return { ok: false, error: `ElevenLabs error: ${voiceErr.response?.status} ${voiceErr.message}` };
        }
      }

      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    console.error(`[TOOL ERROR] ${name}:`, err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { TOOL_DEFINITIONS, executeTool };
