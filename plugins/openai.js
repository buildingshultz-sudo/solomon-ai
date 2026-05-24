/**
 * OpenAI Plugin — GPT, Whisper, gpt-image-1 (with reference image support)
 */
const fs = require('fs');
const path = require('path');
let apiKey = '';
let baseUrl = 'https://api.openai.com/v1';
module.exports = {
  name: 'openai',
  version: '1.1.0',
  description: 'OpenAI API integration: GPT chat, Whisper transcription, gpt-image-1 image generation with reference image support',
  requiredKeys: ['OPENAI_API_KEY'],
  commands: ['/imagine', '/transcribe'],
  tools: [
    {
      type: 'function',
      function: {
        name: 'generate_image',
        description: 'Generate an image using gpt-image-1. Supports reference images from user_images folder. Returns file path to generated PNG.',
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'Image generation prompt' },
            size: { type: 'string', enum: ['1024x1024', '1792x1024', '1024x1792'], description: 'Image size' },
            reference_images: { 
              type: 'array', 
              items: { type: 'string' },
              description: 'Array of file paths to reference images. If provided, these will be sent as base64 image inputs alongside the text prompt for style/content reference.'
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
        description: 'Transcribe audio file using Whisper. Provide file path on VPS.',
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
  },
  async executeTool(toolName, args) {
    switch (toolName) {
      case 'generate_image': return await generateImage(args.prompt, args.size, args.reference_images);
      case 'transcribe_audio': return await transcribeAudio(args.filePath);
      default: return { error: `Unknown tool: ${toolName}` };
    }
  },
  // Exported utilities for other modules
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
  async generateImage(prompt, size = '1024x1024', referenceImages) { return generateImage(prompt, size, referenceImages); },
  async transcribeAudio(filePath) { return transcribeAudio(filePath); }
};

async function generateImage(prompt, size = '1024x1024', referenceImages = null) {
  try {
    // If reference images provided, use the chat completions endpoint with gpt-image-1
    // which supports image inputs for style/content reference
    if (referenceImages && referenceImages.length > 0) {
      return await generateImageWithReferences(prompt, size, referenceImages);
    }
    
    // Standard generation without references
    const res = await fetch(`${baseUrl}/images/generations`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-image-1', prompt, n: 1, size, quality: 'high' }),
      signal: AbortSignal.timeout(90000)
    });
    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `gpt-image-1 error: ${err}` };
    }
    const data = await res.json();
    const b64 = data.data[0].b64_json;
    const tmpPath = `/tmp/sol_plugin_img_${Date.now()}.png`;
    fs.writeFileSync(tmpPath, Buffer.from(b64, 'base64'));
    return { success: true, filePath: tmpPath };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function generateImageWithReferences(prompt, size, referenceImages) {
  try {
    // Build input array with reference images + text prompt
    const input = [];
    
    // Add each reference image as base64
    for (const imgPath of referenceImages) {
      if (!fs.existsSync(imgPath)) {
        console.log(`[OPENAI] Reference image not found: ${imgPath}, skipping`);
        continue;
      }
      const imgBuffer = fs.readFileSync(imgPath);
      const b64 = imgBuffer.toString('base64');
      // Detect mime type from extension
      const ext = path.extname(imgPath).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
      input.push({
        type: 'input_image',
        image_url: `data:${mime};base64,${b64}`
      });
    }
    
    // Add the text prompt
    input.push({
      type: 'input_text',
      text: prompt
    });

    console.log(`[OPENAI] Generating image with ${referenceImages.length} reference(s), size: ${size}`);

    const res = await fetch(`${baseUrl}/responses`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-image-1',
        input: input,
        tools: [{ type: 'image_generation', size: size, quality: 'high' }]
      }),
      signal: AbortSignal.timeout(120000)
    });

    if (!res.ok) {
      const err = await res.text();
      // Fallback: try without references if the API rejects the format
      console.log(`[OPENAI] Reference image API failed (${res.status}): ${err}. Falling back to standard generation.`);
      return await generateImage(prompt, size, null);
    }

    const data = await res.json();
    
    // Extract image from response
    let b64 = null;
    if (data.output) {
      for (const item of data.output) {
        if (item.type === 'image_generation_call' && item.result) {
          b64 = item.result;
          break;
        }
      }
    }
    
    if (!b64) {
      // Try alternate response format
      if (data.data && data.data[0] && data.data[0].b64_json) {
        b64 = data.data[0].b64_json;
      }
    }

    if (!b64) {
      console.log(`[OPENAI] Could not extract image from response. Falling back to standard generation.`);
      console.log(`[OPENAI] Response keys: ${JSON.stringify(Object.keys(data))}`);
      return await generateImage(prompt, size, null);
    }

    const tmpPath = `/tmp/sol_plugin_img_${Date.now()}.png`;
    fs.writeFileSync(tmpPath, Buffer.from(b64, 'base64'));
    console.log(`[OPENAI] Generated image with references: ${tmpPath}`);
    return { success: true, filePath: tmpPath, usedReferences: true };
  } catch (e) {
    console.log(`[OPENAI] Reference generation error: ${e.message}. Falling back.`);
    return await generateImage(prompt, size, null);
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
