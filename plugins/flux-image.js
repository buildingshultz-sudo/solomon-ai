/**
 * Flux/BFL Image Generation Plugin
 * Fixed: correct base URL (api.bfl.ai), correct auth header (x-key), correct model endpoint
 */
const fs = require('fs');
const path = require('path');
let apiKey = '';
module.exports = {
  name: 'flux-image',
  version: '1.1.0',
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
          model: { type: 'string', enum: ['flux-pro-1.1', 'flux-pro', 'flux-dev', 'flux-schnell'], description: 'Model variant (default: flux-pro-1.1)' }
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
    // Use correct base URL: api.bfl.ai (not api.bfl.ml)
    const model = args.model || 'flux-pro-1.1';
    const endpoint = `https://api.bfl.ai/v1/${model}`;

    // Submit generation request
    const submitRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'x-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: args.prompt,
        width: args.width || 1024,
        height: args.height || 1024
      }),
      signal: AbortSignal.timeout(30000)
    });
    if (!submitRes.ok) throw new Error(`BFL ${submitRes.status}: ${await submitRes.text()}`);
    const { id } = await submitRes.json();
    if (!id) throw new Error('BFL API did not return a task ID');

    // Poll for result
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const pollRes = await fetch(`https://api.bfl.ai/v1/get_result?id=${id}`, {
        headers: { 'x-key': apiKey }
      });
      if (!pollRes.ok) throw new Error(`BFL poll ${pollRes.status}: ${await pollRes.text()}`);
      const result = await pollRes.json();
      if (result.status === 'Ready') {
        // Download image
        const imgUrl = result.result.sample;
        const imgRes = await fetch(imgUrl);
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        const outPath = path.join('/tmp', `flux_${Date.now()}.png`);
        fs.writeFileSync(outPath, buffer);
        return { success: true, path: outPath, url: imgUrl, size: buffer.length };
      }
      if (result.status === 'Error') throw new Error(result.error || 'Generation failed');
    }
    return { success: false, error: 'Generation timed out after 120s' };
  } catch (e) { return { success: false, error: e.message }; }
}
