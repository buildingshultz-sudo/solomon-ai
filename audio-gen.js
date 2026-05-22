'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || null;
const BASE_URL = 'https://api.elevenlabs.io/v1';
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel

// HTTPS request helper that returns raw buffer for binary responses
function apiRequest(endpoint, method, body, returnBuffer) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + endpoint);
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: method || 'GET',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        'Accept': returnBuffer ? 'audio/mpeg' : 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      if (returnBuffer) {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, data: Buffer.concat(chunks) }));
      } else {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, data: data });
          }
        });
      }
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// Convert text to speech and save as MP3
async function textToSpeech(text, voiceId, outputPath) {
  if (!ELEVENLABS_API_KEY) {
    return { error: 'ELEVENLABS_API_KEY not set. Set it in environment variables.' };
  }

  const voice = voiceId || DEFAULT_VOICE_ID;
  const result = await apiRequest(`/text-to-speech/${voice}`, 'POST', JSON.stringify({
    text: text,
    model_id: 'eleven_monolingual_v1',
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75
    }
  }), true);

  if (result.status === 200 && Buffer.isBuffer(result.data)) {
    const resolvedPath = path.resolve(outputPath || `./tts_output_${Date.now()}.mp3`);
    fs.writeFileSync(resolvedPath, result.data);
    return { success: true, path: resolvedPath, size: result.data.length };
  }

  return { error: `TTS failed with status ${result.status}`, details: result.data.toString() };
}

// List available voices
async function listVoices() {
  if (!ELEVENLABS_API_KEY) {
    return { error: 'ELEVENLABS_API_KEY not set.' };
  }

  const result = await apiRequest('/voices', 'GET');
  if (result.status === 200 && result.data && result.data.voices) {
    return result.data.voices.map(v => ({
      id: v.voice_id,
      name: v.name,
      category: v.category,
      labels: v.labels
    }));
  }
  return { error: `Failed to list voices: status ${result.status}` };
}

// Clone a voice from an audio file
async function cloneVoice(name, audioFilePath) {
  if (!ELEVENLABS_API_KEY) {
    return { error: 'ELEVENLABS_API_KEY not set.' };
  }

  if (!fs.existsSync(audioFilePath)) {
    return { error: `Audio file not found: ${audioFilePath}` };
  }

  // ElevenLabs voice cloning requires multipart form data
  // For simplicity, return instructions for manual setup
  return {
    info: 'Voice cloning requires multipart upload. Use the ElevenLabs dashboard or a dedicated form-data library.',
    endpoint: `${BASE_URL}/voices/add`,
    requiredFields: ['name', 'files (audio)', 'description'],
    name: name,
    audioFile: audioFilePath
  };
}

// Generate sound effects
async function generateSoundEffect(text, outputPath, durationSeconds) {
  if (!ELEVENLABS_API_KEY) {
    return { error: 'ELEVENLABS_API_KEY not set.' };
  }

  const body = { text: text };
  if (durationSeconds) body.duration_seconds = durationSeconds;

  const result = await apiRequest('/sound-generation', 'POST', JSON.stringify(body), true);

  if (result.status === 200 && Buffer.isBuffer(result.data)) {
    const resolvedPath = path.resolve(outputPath || `./sfx_${Date.now()}.mp3`);
    fs.writeFileSync(resolvedPath, result.data);
    return { success: true, path: resolvedPath, size: result.data.length };
  }

  return { error: `Sound generation failed: status ${result.status}` };
}

module.exports = {
  textToSpeech,
  listVoices,
  cloneVoice,
  generateSoundEffect
};
