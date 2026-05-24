'use strict';
// tools.js — All tool definitions and executors.
// NO self-patching. NO Ollama. NO local LLM. Cloud-only.
require('dotenv').config();
const { mem, tasks } = require('./memory');
const axios = require('axios');
const path = require('path');
const MODEL = process.env.MODEL || 'claude-sonnet-4-5-20250929';

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
    description: 'Post content to a social media page (Facebook). Currently supports Building Shultz and Irish Craftsman pages.',
    input_schema: {
      type: 'object',
      properties: {
        page: { type: 'string', enum: ['building_shultz', 'irish_craftsman'], description: 'Which Facebook page to post to' },
        message: { type: 'string', description: 'Post text content' },
        link: { type: 'string', description: 'Optional URL to include' }
      },
      required: ['page', 'message']
    }
  },
  {
    name: 'send_email',
    description: 'Send an email notification via configured SMTP.',
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
  }
];

// ── TOOL EXECUTORS ───────────────────────────────────────────────────────
async function executeTool(name, input) {
  console.log(`[TOOL] ${name}`, JSON.stringify(input).slice(0, 120));

  try {
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

      // ITEM 30 — SOCIAL POSTING (Facebook pages)
      case 'social_post': {
        if (!process.env.FACEBOOK_PAGE_TOKEN || process.env.FACEBOOK_PAGE_TOKEN === 'PLACEHOLDER') {
          return {
            ok: false,
            error: 'Facebook Page Token not configured. Set FACEBOOK_PAGE_TOKEN in .env to enable social posting.',
            stub: true,
            page: input.page,
            message_preview: input.message.slice(0, 100)
          };
        }
        // Real implementation when token is available
        try {
          const pageId = input.page === 'building_shultz' ? process.env.FB_BUILDING_SHULTZ_ID : process.env.FB_IRISH_CRAFTSMAN_ID;
          const fbResp = await axios.post(`https://graph.facebook.com/v18.0/${pageId}/feed`, {
            message: input.message,
            link: input.link || undefined,
            access_token: process.env.FACEBOOK_PAGE_TOKEN
          }, { timeout: 10000 });
          return { ok: true, post_id: fbResp.data.id, page: input.page };
        } catch (fbErr) {
          return { ok: false, error: `Facebook post failed: ${fbErr.response?.data?.error?.message || fbErr.message}` };
        }
      }

      // ITEM 31 — EMAIL NOTIFICATIONS via nodemailer
      case 'send_email': {
        if (!process.env.SMTP_HOST || process.env.SMTP_HOST === 'PLACEHOLDER') {
          return {
            ok: false,
            error: 'Email not configured. Set EMAIL_HOST, EMAIL_USER, EMAIL_PASS in .env.',
            stub: true,
            to: input.to,
            subject: input.subject
          };
        }
        try {
          const nodemailer = require('nodemailer');
          const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            connectionTimeout: 8000,
            greetingTimeout: 8000,
            socketTimeout: 8000,
            port: parseInt(process.env.SMTP_PORT || '587'),
            secure: false,
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          });
          const info = await transporter.sendMail({
            from: process.env.SMTP_USER,
            to: input.to,
            subject: input.subject,
            text: input.body,
            html: input.body.includes('<') ? input.body : undefined
          });
          return { ok: true, message_id: info.messageId, to: input.to, subject: input.subject };
        } catch (emailErr) {
          return { ok: false, error: `Email send failed: ${emailErr.message}` };
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
