/**
 * ElevenLabs Plugin — Text-to-Speech, Voice Cloning
 */
const fs = require('fs');
const path = require('path');

let apiKey = '';
let defaultVoiceId = '';
const BASE_URL = 'https://api.elevenlabs.io/v1';

module.exports = {
  name: 'elevenlabs',
  version: '1.0.0',
  description: 'ElevenLabs TTS: generate speech, list voices, clone voices',
  requiredKeys: ['ELEVENLABS_API_KEY'],
  commands: ['/speak', '/voices'],
  tools: [
    {
      type: 'function',
      function: {
        name: 'text_to_speech',
        description: 'Convert text to speech audio using ElevenLabs. Returns path to audio file.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to convert to speech' },
            voice: { type: 'string', description: 'Voice ID or name (optional, uses default)' }
          },
          required: ['text']
        }
      }
    }
  ],

  init(deps) {
    apiKey = deps.config.ELEVENLABS_API_KEY;
    defaultVoiceId = deps.config.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // Rachel
  },

  async executeTool(toolName, args) {
    if (toolName === 'text_to_speech') return await textToSpeech(args.text, args.voice);
    return { error: `Unknown tool: ${toolName}` };
  },

  async textToSpeech(text, voice) { return textToSpeech(text, voice); },
  async listVoices() { return listVoices(); }
};

async function textToSpeech(text, voiceId = null) {
  try {
    const vid = voiceId || defaultVoiceId;
    const res = await fetch(`${BASE_URL}/text-to-speech/${vid}`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
      }),
      signal: AbortSignal.timeout(30000)
    });
    if (!res.ok) return { success: false, error: `ElevenLabs ${res.status}: ${await res.text()}` };
    
    const buffer = Buffer.from(await res.arrayBuffer());
    const outPath = path.join('/tmp', `sol_tts_${Date.now()}.mp3`);
    fs.writeFileSync(outPath, buffer);
    return { success: true, path: outPath, size: buffer.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function listVoices() {
  try {
    const res = await fetch(`${BASE_URL}/voices`, {
      headers: { 'xi-api-key': apiKey },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { success: true, voices: data.voices.map(v => ({ id: v.voice_id, name: v.name, category: v.category })) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
