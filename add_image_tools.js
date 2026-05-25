'use strict';
// add_image_tools.js — Add generate_image and set_desktop_wallpaper tools to tools.js
// Run on VPS: node add_image_tools.js

const fs = require('fs');
const filePath = '/root/solomon-v4/tools.js';
let code = fs.readFileSync(filePath, 'utf8');

// ── STEP 1: Add tool definitions before the closing `];` ─────────────────
const DEFS_ANCHOR = '  }\n];\n\n// ── WORKSHOP TOOL EXECUTOR (Phase 7)';

const NEW_DEFS = `  },
  // ── PHASE 8B IMAGE GENERATION TOOLS ─────────────────────────────────────
  {
    name: 'generate_image',
    description: 'Generate an image using Flux AI (BFL). Provide a detailed prompt. Returns the local file path of the downloaded image. Use send_telegram_file to send it to Jed, or set_desktop_wallpaper to apply it.',
    input_schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Detailed description of the image to generate' },
        width: { type: 'number', description: 'Image width in pixels. Default 1920.' },
        height: { type: 'number', description: 'Image height in pixels. Default 1080.' },
        filename: { type: 'string', description: 'Optional output filename (without extension). Defaults to timestamp.' }
      },
      required: ['prompt']
    }
  },
  {
    name: 'set_desktop_wallpaper',
    description: "Set Jed's Windows desktop wallpaper. Provide a local VPS image path (from generate_image). Transfers the image to the PC and applies it as wallpaper.",
    input_schema: {
      type: 'object',
      properties: {
        image_path: { type: 'string', description: 'Local VPS path to the image file (e.g. /tmp/generated_images/wallpaper.jpg)' },
        pc_path: { type: 'string', description: 'Windows path to save the image on PC. Defaults to D:\\\\wallpaper.jpg' }
      },
      required: ['image_path']
    }
  }
];

// ── WORKSHOP TOOL EXECUTOR (Phase 7)`;

if (code.includes(DEFS_ANCHOR)) {
  code = code.replace(DEFS_ANCHOR, NEW_DEFS);
  console.log('✅ Added generate_image and set_desktop_wallpaper tool definitions');
} else {
  console.log('❌ Could not find DEFS_ANCHOR');
  // Try to find the end of the array
  const altAnchor = '];\n// ── WORKSHOP TOOL EXECUTOR (Phase 7)';
  if (code.includes(altAnchor)) {
    code = code.replace(altAnchor, NEW_DEFS.replace('  },\n  // ── PHASE', '  // ── PHASE'));
    console.log('✅ Added tool definitions via alt anchor');
  } else {
    console.log('  Available anchors near end of TOOL_DEFINITIONS:');
    const idx = code.indexOf('// ── WORKSHOP TOOL EXECUTOR');
    if (idx > -1) console.log(JSON.stringify(code.slice(idx - 50, idx + 50)));
    process.exit(1);
  }
}

// ── STEP 2: Add executors before the default case in executeTool ──────────
const EXECUTOR_ANCHOR = "      default:\n        return { ok: false, error: `Unknown tool:";

const NEW_EXECUTORS = `      case 'generate_image': {
        const BFL_KEY = process.env.BFL_API_KEY;
        if (!BFL_KEY) return { ok: false, error: 'BFL_API_KEY not set in .env' };
        const prompt = input.prompt;
        const width = input.width || 1920;
        const height = input.height || 1080;
        const filename = input.filename || \`flux_\${Date.now()}\`;
        const outDir = '/tmp/generated_images';
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        const outPath = \`\${outDir}/\${filename}.jpg\`;
        // Step 1: Submit generation job
        let jobId;
        try {
          const submitResp = await axios.post('https://api.bfl.ai/v1/flux-pro-1.1', {
            prompt, width, height
          }, {
            headers: { 'x-key': BFL_KEY, 'Content-Type': 'application/json' },
            timeout: 30000
          });
          jobId = submitResp.data.id;
          if (!jobId) return { ok: false, error: 'Flux API did not return a job ID', data: submitResp.data };
        } catch (e) {
          return { ok: false, error: \`Flux submit failed: \${e.message}\`, details: e.response?.data };
        }
        // Step 2: Poll for completion (max 60s, every 2s)
        let imageUrl = null;
        const maxAttempts = 30;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          await new Promise(r => setTimeout(r, 2000));
          try {
            const pollResp = await axios.get(\`https://api.bfl.ai/v1/get_result?id=\${jobId}\`, {
              headers: { 'x-key': BFL_KEY },
              timeout: 15000
            });
            const status = pollResp.data.status;
            if (status === 'Ready') {
              imageUrl = pollResp.data.result?.sample;
              break;
            } else if (status === 'Error' || status === 'Failed') {
              return { ok: false, error: \`Flux generation failed: \${status}\`, data: pollResp.data };
            }
            // Still pending — continue polling
          } catch (e) {
            // Transient poll error — keep trying
          }
        }
        if (!imageUrl) return { ok: false, error: 'Flux generation timed out after 60 seconds' };
        // Step 3: Download the image
        try {
          const imgResp = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 60000 });
          fs.writeFileSync(outPath, Buffer.from(imgResp.data));
        } catch (e) {
          return { ok: false, error: \`Failed to download generated image: \${e.message}\` };
        }
        return { ok: true, path: outPath, url: imageUrl, width, height, prompt };
      }

      case 'set_desktop_wallpaper': {
        if (!process.env.PC_RELAY_URL || process.env.PC_RELAY_URL === 'PLACEHOLDER') {
          return { ok: false, error: 'PC_RELAY_URL not configured.' };
        }
        const imgPath = input.image_path;
        const pcPath = input.pc_path || 'D:\\\\wallpaper.jpg';
        if (!fs.existsSync(imgPath)) {
          return { ok: false, error: \`Image file not found: \${imgPath}\` };
        }
        // Step 1: Read image and base64 encode
        const imgBuffer = fs.readFileSync(imgPath);
        const imgBase64 = imgBuffer.toString('base64');
        const ext = path.extname(imgPath).toLowerCase().replace('.', '') || 'jpg';
        const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
        const mimeType = mimeMap[ext] || 'image/jpeg';
        // Step 2: Write image to PC via relay (as base64 data URI decoded by relay)
        // The relay file_write endpoint accepts plain text content, so we write the base64
        // and decode it on the PC side via PowerShell
        const relayUrl = process.env.PC_RELAY_URL;
        const relaySecret = process.env.PC_RELAY_SECRET;
        // Write the base64 content to a temp file on PC
        const pcTempPath = pcPath.replace(/\\.\\w+$/, '_b64.txt');
        try {
          await axios.post(\`\${relayUrl}/file/write\`, {
            path: pcTempPath,
            content: imgBase64
          }, {
            headers: { 'X-Secret': relaySecret },
            timeout: 60000,
            maxContentLength: 50 * 1024 * 1024
          });
        } catch (e) {
          return { ok: false, error: \`Failed to transfer image to PC: \${e.message}\` };
        }
        // Step 3: Decode base64 to actual image file on PC via PowerShell
        const decodeCmd = \`[System.IO.File]::WriteAllBytes('\${pcPath}', [System.Convert]::FromBase64String([System.IO.File]::ReadAllText('\${pcTempPath}')))\`;
        const decodeRes = await executeTool('pc_execute', { command: decodeCmd, timeout_ms: 30000 });
        if (!decodeRes.ok) return { ok: false, error: \`Failed to decode image on PC: \${decodeRes.error}\` };
        // Step 4: Set as wallpaper via PowerShell
        const wallpaperCmd = \`Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Wallpaper {
  [DllImport("user32.dll", CharSet = CharSet.Auto)]
  public static extern int SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);
}
"@; [Wallpaper]::SystemParametersInfo(20, 0, '\${pcPath}', 3); Remove-Item '\${pcTempPath}' -ErrorAction SilentlyContinue\`;
        const wallRes = await executeTool('pc_execute', { command: wallpaperCmd, timeout_ms: 30000 });
        if (!wallRes.ok) return { ok: false, error: \`Failed to set wallpaper: \${wallRes.error}\` };
        return { ok: true, message: \`Wallpaper set to \${pcPath}\`, pc_path: pcPath };
      }

      default:\n        return { ok: false, error: \`Unknown tool:`;

if (code.includes(EXECUTOR_ANCHOR)) {
  code = code.replace(EXECUTOR_ANCHOR, NEW_EXECUTORS);
  console.log('✅ Added generate_image and set_desktop_wallpaper executors');
} else {
  console.log('❌ Could not find executor default case anchor');
  process.exit(1);
}

// ── Write ─────────────────────────────────────────────────────────────────
fs.writeFileSync(filePath, code);
console.log('tools.js written.');

// ── Syntax check ─────────────────────────────────────────────────────────
const { execSync } = require('child_process');
try {
  execSync('node -c /root/solomon-v4/tools.js', { stdio: 'pipe' });
  console.log('✅ Syntax check passed');
} catch (e) {
  console.log('❌ Syntax error:', e.stderr.toString().slice(0, 300));
  process.exit(1);
}

// ── Verify ────────────────────────────────────────────────────────────────
const patched = fs.readFileSync(filePath, 'utf8');
const checks = [
  ["generate_image definition", patched.includes("name: 'generate_image'")],
  ["set_desktop_wallpaper definition", patched.includes("name: 'set_desktop_wallpaper'")],
  ["Flux API call", patched.includes('api.bfl.ai/v1/flux-pro-1.1')],
  ["Flux polling", patched.includes('api.bfl.ai/v1/get_result')],
  ["Image download", patched.includes("responseType: 'arraybuffer'")],
  ["Wallpaper PowerShell", patched.includes('SystemParametersInfo')],
  ["PC relay transfer", patched.includes('/file/write')],
  ["module.exports intact", patched.includes('module.exports = { TOOL_DEFINITIONS, executeTool }')],
];
let allPass = true;
for (const [label, ok] of checks) {
  console.log(`  ${ok ? '✅' : '❌'} ${label}`);
  if (!ok) allPass = false;
}
if (allPass) console.log('\nALL CHECKS PASSED');
else { console.log('\nSOME CHECKS FAILED'); process.exit(1); }
