'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const LUMA_API_KEY = process.env.LUMA_API_KEY || null;
const RUNWAY_API_KEY = process.env.RUNWAY_API_KEY || null;

// Generic HTTPS request helper
function httpsRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqOptions = {
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };
    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// Download a file from URL to local path
function downloadFile(url, outputPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputPath);
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        downloadFile(res.headers.location, outputPath).then(resolve).catch(reject);
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(outputPath); });
    }).on('error', (err) => {
      fs.unlink(outputPath, () => {});
      reject(err);
    });
  });
}

// Generate video using Luma Dream Machine API
async function generateWithLuma(prompt, options) {
  if (!LUMA_API_KEY) {
    return { error: 'LUMA_API_KEY not set. Set it in environment variables.' };
  }

  const result = await httpsRequest('https://api.lumalabs.ai/dream-machine/v1/generations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LUMA_API_KEY}`,
      'Content-Type': 'application/json'
    }
  }, JSON.stringify({
    prompt: prompt,
    aspect_ratio: (options && options.aspectRatio) || '16:9',
    loop: (options && options.loop) || false
  }));

  return result.data;
}

// Generate video using Runway Gen-3 API
async function generateWithRunway(prompt, options) {
  if (!RUNWAY_API_KEY) {
    return { error: 'RUNWAY_API_KEY not set. Set it in environment variables.' };
  }

  const result = await httpsRequest('https://api.dev.runwayml.com/v1/image_to_video', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RUNWAY_API_KEY}`,
      'Content-Type': 'application/json',
      'X-Runway-Version': '2024-11-06'
    }
  }, JSON.stringify({
    model: 'gen3a_turbo',
    promptText: prompt,
    duration: (options && options.duration) || 5
  }));

  return result.data;
}

// Main entry point — tries Luma first, then Runway
async function generateVideo(prompt, outputPath, options) {
  if (LUMA_API_KEY) {
    const job = await generateWithLuma(prompt, options);
    if (job && job.id) {
      return { provider: 'luma', jobId: job.id, status: job.state || 'queued' };
    }
    return { provider: 'luma', error: job };
  }

  if (RUNWAY_API_KEY) {
    const job = await generateWithRunway(prompt, options);
    if (job && job.id) {
      return { provider: 'runway', jobId: job.id, status: 'queued' };
    }
    return { provider: 'runway', error: job };
  }

  return { error: 'No video API key configured. Set LUMA_API_KEY or RUNWAY_API_KEY.' };
}

// Poll for video completion (Luma)
async function pollVideoStatus(jobId) {
  if (!LUMA_API_KEY) return { error: 'LUMA_API_KEY not set' };

  const result = await httpsRequest(`https://api.lumalabs.ai/dream-machine/v1/generations/${jobId}`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${LUMA_API_KEY}` }
  });

  const data = result.data;
  if (data && data.assets && data.assets.video) {
    return { status: 'completed', videoUrl: data.assets.video };
  }
  return { status: data.state || 'processing', data: data };
}

// Download completed video
async function downloadVideo(url, outputPath) {
  const resolvedPath = path.resolve(outputPath);
  await downloadFile(url, resolvedPath);
  return resolvedPath;
}

module.exports = {
  generateVideo,
  pollVideoStatus,
  downloadVideo,
  generateWithLuma,
  generateWithRunway
};
