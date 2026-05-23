/**
 * Flux/BFL Image Generation Plugin
 */
const fs = require('fs');
const path = require('path');
let apiKey = '';

module.exports = {
  name: 'flux-image',
  version: '1.0.0',
  description: 'Flux/BFL AI image generation and editing',
  requiredKeys: ['BFL_API_KEY'],
  commands: ['/flux'],
  tools: [
    {
      type: 'function', function: {
        name: 'flux_generate',
        description: 'Generate an image using Flux AI (high quality, fast)',
        parameters: { type: 'object', properties: {
          prompt: { type: 'string', description: 'Image generation prompt' },
          width: { type: 'number', description: 'Image width (default 1024)' },
          height: { type: 'number', description: 'Image height (default 1024)' },
          model: { type: 'string', enum: ['flux-pro', 'flux-dev', 'flux-schnell'], description: 'Model variant' }
        }, required: ['prompt'] }
      }
    }
  ],

  init(deps) { apiKey = deps.config.BFL_API_KEY; },

  async executeTool(toolName, args) {
    if (toolName === 'flux_generate') return await generateImage(args);
    return { error: `Unknown tool: ${toolName}` };
  }
};

async function generateImage(args) {
  try {
    const model = args.model || 'flux-pro';
    const endpoint = model === 'flux-schnell' 
      ? 'https://api.bfl.ml/v1/flux-schnell'
      : model === 'flux-dev'
        ? 'https://api.bfl.ml/v1/flux-dev'
        : 'https://api.bfl.ml/v1/flux-pro';
    
    // Submit generation request
    const submitRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'X-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: args.prompt,
        width: args.width || 1024,
        height: args.height || 1024
      }),
      signal: AbortSignal.timeout(30000)
    });
    if (!submitRes.ok) throw new Error(`BFL ${submitRes.status}: ${await submitRes.text()}`);
    const { id } = await submitRes.json();
    
    // Poll for result
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const pollRes = await fetch(`https://api.bfl.ml/v1/get_result?id=${id}`, {
        headers: { 'X-Key': apiKey }
      });
      const result = await pollRes.json();
      if (result.status === 'Ready') {
        // Download image
        const imgRes = await fetch(result.result.sample);
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        const outPath = path.join('/tmp', `flux_${Date.now()}.png`);
        fs.writeFileSync(outPath, buffer);
        return { success: true, path: outPath, url: result.result.sample, size: buffer.length };
      }
      if (result.status === 'Error') throw new Error(result.error || 'Generation failed');
    }
    return { success: false, error: 'Generation timed out' };
  } catch (e) { return { success: false, error: e.message }; }
}
