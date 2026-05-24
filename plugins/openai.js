/**
 * OpenAI Plugin — GPT, Whisper, gpt-image-1 (with reference images + prompt enhancement)
 * v1.3.0 — Adds automatic prompt enhancement before image generation
 *           Uses /images/edits endpoint for reference images (multipart form-data)
 *           Produces ONE image per request (never loops per reference)
 */
const fs = require('fs');
const path = require('path');
let apiKey = '';
let baseUrl = 'https://api.openai.com/v1';
let openRouterKey = '';
let openRouterUrl = '';

const PROMPT_ENHANCER_SYSTEM = `You are an expert image prompt engineer. Your job is to take a brief image request and expand it into a detailed, cinematic prompt for gpt-image-1.

RULES:
1. Output ONLY the enhanced prompt text — no explanations, no quotes, no markdown
2. The enhanced prompt must be 80-150 words
3. Always specify these elements:
   - Exact subject/scene with specific objects named
   - Lighting direction, color temperature, quality (e.g. "warm amber LED strip casting upward glow", "single harsh side light")
   - Atmosphere/mood (e.g. "quiet intensity", "raw energy", "contemplative stillness")
   - Camera/composition (e.g. "wide-angle 24mm at waist height", "tight close-up f/1.4", "overhead flat-lay")
   - Textures/materials (e.g. "brushed steel", "knotty pine", "calloused hands")
   - Color palette (e.g. "deep blacks with pops of teal and red")
   - What NOT to include (e.g. "No text, no watermarks, no people")
4. For workshop/shop images, include: knotty pine tongue-and-groove ceiling, tan pegboard with organized wrenches and hand tools, diamond-plate aluminum cabinets, warm amber LED strip under cabinets, concrete floor with sawdust, red fire extinguisher, plaid office chair
5. Make it photorealistic and cinematic — think movie still or editorial photography
6. NEVER use generic phrases like "beautiful", "amazing", "professional" — be SPECIFIC
7. For thumbnails: use dramatic lighting, shallow depth of field, high contrast, bold composition
8. For wallpapers: use wide-angle, landscape orientation, atmospheric depth, moody lighting`;

module.exports = {
  name: 'openai',
  version: '1.3.0',
  description: 'OpenAI API: GPT chat, Whisper, gpt-image-1 with auto prompt enhancement + reference image support',
  requiredKeys: ['OPENAI_API_KEY'],
  commands: ['/imagine', '/transcribe'],
  tools: [
    {
      type: 'function',
      function: {
        name: 'generate_image',
        description: 'Generate ONE high-quality image using gpt-image-1. Automatically enhances your prompt for maximum quality. Supports reference images. Only generates a single image per call.',
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'Image generation prompt — will be automatically enhanced for quality' },
            size: { type: 'string', enum: ['1024x1024', '1536x1024', '1024x1536', 'auto'], description: 'Image size. Use 1536x1024 for landscape/wallpaper, 1024x1536 for portrait/phone, 1024x1024 for square/social.' },
            reference_images: { 
              type: 'array', 
              items: { type: 'string' },
              description: 'Array of file paths to ALL reference images to use together in a single generation. These are sent to gpt-image-1 via /images/edits.'
            }
          },
          required: ['prompt']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'transcribe_audio',
        description: 'Transcribe audio file using Whisper.',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Path to audio file' }
          },
          required: ['filePath']
        }
      }
    }
  ],
  init(deps) {
    apiKey = deps.config.OPENAI_API_KEY;
    openRouterKey = deps.config.OPENROUTER_API_KEY || '';
    openRouterUrl = deps.config.OPENROUTER_URL || 'https://openrouter.ai/api/v1/chat/completions';
  },
  async executeTool(toolName, args) {
    switch (toolName) {
      case 'generate_image': return await generateImage(args.prompt, args.size, args.reference_images);
      case 'transcribe_audio': return await transcribeAudio(args.filePath);
      default: return { error: `Unknown tool: ${toolName}` };
    }
  },
  async chat(messages, model = 'gpt-4o', options = {}) {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, max_tokens: options.maxTokens || 4096, temperature: options.temperature || 0.7 }),
      signal: AbortSignal.timeout(options.timeout || 60000)
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.choices[0].message.content;
  },
  async generateImage(prompt, size, referenceImages) { return generateImage(prompt, size, referenceImages); },
  async transcribeAudio(filePath) { return transcribeAudio(filePath); }
};

// ── PROMPT ENHANCER ─────────────────────────────────────────────────────────
async function enhancePrompt(rawPrompt) {
  try {
    // Use OpenRouter (same as Solomon's main brain) for the enhancement
    const url = openRouterUrl || 'https://openrouter.ai/api/v1/chat/completions';
    const key = openRouterKey || apiKey;
    
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://solomonsforge.com',
        'X-Title': 'Solomon Image Enhancer'
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [
          { role: 'system', content: PROMPT_ENHANCER_SYSTEM },
          { role: 'user', content: `Enhance this image prompt: "${rawPrompt}"` }
        ],
        max_tokens: 500,
        temperature: 0.8
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (!res.ok) {
      console.log(`[OPENAI] Prompt enhancement failed (${res.status}), using raw prompt`);
      return rawPrompt;
    }

    const data = await res.json();
    const enhanced = data.choices[0].message.content.trim();
    console.log(`[OPENAI] Prompt enhanced: "${rawPrompt.slice(0, 40)}..." → "${enhanced.slice(0, 80)}..."`);
    return enhanced;
  } catch (e) {
    console.log(`[OPENAI] Prompt enhancement error: ${e.message}, using raw prompt`);
    return rawPrompt;
  }
}

// ── IMAGE GENERATION ────────────────────────────────────────────────────────
async function generateImage(prompt, size = '1536x1024', referenceImages = null) {
  try {
    // Step 1: Enhance the prompt automatically
    const enhancedPrompt = await enhancePrompt(prompt);
    
    // Step 2: If reference images provided, use /images/edits endpoint
    if (referenceImages && referenceImages.length > 0) {
      return await generateWithReferences(enhancedPrompt, size, referenceImages);
    }
    
    // Standard generation without references via /images/generations
    const validGenSizes = ['1024x1024', '1792x1024', '1024x1792'];
    let genSize = '1024x1024';
    if (validGenSizes.includes(size)) {
      genSize = size;
    } else if (size === '1536x1024') {
      genSize = '1792x1024'; // upscale for generations endpoint
    } else if (size === '1024x1536') {
      genSize = '1024x1792';
    }
    
    const res = await fetch(`${baseUrl}/images/generations`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-image-1', prompt: enhancedPrompt, n: 1, size: genSize, quality: 'high' }),
      signal: AbortSignal.timeout(120000)
    });
    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `gpt-image-1 generations error: ${err}` };
    }
    const data = await res.json();
    const b64 = data.data[0].b64_json;
    const tmpPath = `/tmp/sol_plugin_img_${Date.now()}.png`;
    fs.writeFileSync(tmpPath, Buffer.from(b64, 'base64'));
    console.log(`[OPENAI] Generated image (no refs): ${tmpPath}`);
    return { success: true, filePath: tmpPath, enhancedPrompt };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function generateWithReferences(prompt, size, referenceImages) {
  try {
    // /images/edits supports: 1024x1024, 1024x1536, 1536x1024, auto
    const validEditSizes = ['1024x1024', '1024x1536', '1536x1024', 'auto'];
    let editSize = '1536x1024'; // default to landscape
    if (validEditSizes.includes(size)) {
      editSize = size;
    } else if (size === '1792x1024') {
      editSize = '1536x1024';
    } else if (size === '1024x1792') {
      editSize = '1024x1536';
    }

    // Build multipart form data (Node 20+ has native FormData and File)
    const formData = new FormData();
    formData.append('model', 'gpt-image-1');
    formData.append('prompt', prompt);
    formData.append('size', editSize);
    formData.append('quality', 'high');
    formData.append('n', '1');

    // Add ALL reference images in a single request
    let addedImages = 0;
    for (const imgPath of referenceImages) {
      if (!fs.existsSync(imgPath)) {
        console.log(`[OPENAI] Reference image not found: ${imgPath}, skipping`);
        continue;
      }
      const imgBuffer = fs.readFileSync(imgPath);
      const ext = path.extname(imgPath).toLowerCase();
      const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
      const filename = path.basename(imgPath);
      const file = new File([imgBuffer], filename, { type: mimeType });
      formData.append('image[]', file);
      addedImages++;
    }

    if (addedImages === 0) {
      console.log('[OPENAI] No valid reference images found, falling back to standard generation');
      return await generateImage(prompt, size, null);
    }

    console.log(`[OPENAI] Calling /images/edits with ${addedImages} reference image(s), size: ${editSize}, prompt: "${prompt.slice(0, 60)}..."`);

    const res = await fetch(`${baseUrl}/images/edits`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData,
      signal: AbortSignal.timeout(180000) // 3 min timeout for edits
    });

    if (!res.ok) {
      const err = await res.text();
      console.log(`[OPENAI] /images/edits failed (${res.status}): ${err.slice(0, 300)}`);
      // Fallback to standard generation without references
      console.log('[OPENAI] Falling back to standard generation without references');
      const validGenSizes = ['1024x1024', '1792x1024', '1024x1792'];
      let genSize = '1792x1024';
      if (validGenSizes.includes(size)) genSize = size;
      const res2 = await fetch(`${baseUrl}/images/generations`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-image-1', prompt, n: 1, size: genSize, quality: 'high' }),
        signal: AbortSignal.timeout(120000)
      });
      if (!res2.ok) return { success: false, error: `Fallback also failed: ${await res2.text()}` };
      const data2 = await res2.json();
      const tmpPath2 = `/tmp/sol_plugin_img_${Date.now()}.png`;
      fs.writeFileSync(tmpPath2, Buffer.from(data2.data[0].b64_json, 'base64'));
      return { success: true, filePath: tmpPath2, usedReferences: false };
    }

    const data = await res.json();
    const b64 = data.data[0].b64_json;
    const tmpPath = `/tmp/sol_plugin_img_${Date.now()}.png`;
    fs.writeFileSync(tmpPath, Buffer.from(b64, 'base64'));
    console.log(`[OPENAI] Generated image WITH ${addedImages} references: ${tmpPath}`);
    return { success: true, filePath: tmpPath, usedReferences: true };
  } catch (e) {
    console.log(`[OPENAI] Reference generation error: ${e.message}`);
    return { success: false, error: e.message };
  }
}

async function transcribeAudio(filePath) {
  try {
    const { execSync } = require('child_process');
    const result = execSync(
      `curl -s -X POST "${baseUrl}/audio/transcriptions" -H "Authorization: Bearer ${apiKey}" -F "file=@${filePath}" -F "model=whisper-1"`,
      { encoding: 'utf-8', timeout: 60000 }
    );
    const parsed = JSON.parse(result);
    return { success: true, text: parsed.text };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
