/**
 * OpenAI Plugin — GPT, Whisper, DALL-E, Codex
 */
const fs = require('fs');
const path = require('path');

let apiKey = '';
let baseUrl = 'https://api.openai.com/v1';

module.exports = {
  name: 'openai',
  version: '1.0.0',
  description: 'OpenAI API integration: GPT chat, Whisper transcription, DALL-E image generation',
  requiredKeys: ['OPENAI_API_KEY'],
  commands: ['/imagine', '/transcribe'],
  tools: [
    {
      type: 'function',
      function: {
        name: 'generate_image',
        description: 'Generate an image using DALL-E 3. Returns image URL.',
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'Image generation prompt' },
            size: { type: 'string', enum: ['1024x1024', '1792x1024', '1024x1792'], description: 'Image size' }
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
      case 'generate_image': return await generateImage(args.prompt, args.size);
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

  async generateImage(prompt, size = '1024x1024') { return generateImage(prompt, size); },
  async transcribeAudio(filePath) { return transcribeAudio(filePath); }
};

async function generateImage(prompt, size = '1024x1024') {
  try {
    const res = await fetch(`${baseUrl}/images/generations`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size, quality: 'standard' }),
      signal: AbortSignal.timeout(60000)
    });
    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `DALL-E error: ${err}` };
    }
    const data = await res.json();
    return { success: true, url: data.data[0].url, revised_prompt: data.data[0].revised_prompt };
  } catch (e) {
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
