'use strict';
// add_browser_tools.js — Add browse_url, browser_interact, pc_browse_url to tools.js
// Run on VPS: node add_browser_tools.js

const fs = require('fs');
const filePath = '/root/solomon-v4/tools.js';
let code = fs.readFileSync(filePath, 'utf8');

// ── STEP 1: Add tool definitions ─────────────────────────────────────────
// Insert before the closing `];` + blank line + WORKSHOP comment
const DEFS_ANCHOR = '  }\n];\n\n// ── WORKSHOP TOOL EXECUTOR (Phase 7)';

const NEW_DEFS = `  },
  // ── BROWSER AUTOMATION TOOLS (Phase 8C) ──────────────────────────────────
  {
    name: 'browse_url',
    description: 'Browse a URL using headless Chromium (Playwright). Can extract text, HTML, or take a screenshot. Use for reading web pages, scraping public content, or capturing page state. NOTE: This is a fresh browser with no login sessions. For authenticated tasks, use pc_browse_url.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL to navigate to (include https://)' },
        action: { type: 'string', enum: ['get_text', 'get_html', 'screenshot'], description: 'What to extract. get_text (default), get_html, or screenshot.' },
        wait_for: { type: 'string', description: 'Optional CSS selector to wait for before extracting content' }
      },
      required: ['url']
    }
  },
  {
    name: 'browser_interact',
    description: 'Open a URL and perform a sequence of browser interactions (click, type, scroll, screenshot, select). Use for form filling, multi-step flows, or scraping dynamic content. NOTE: Fresh browser, no login sessions. For authenticated tasks, use pc_browse_url.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL to navigate to (include https://)' },
        steps: {
          type: 'array',
          description: 'Ordered list of interaction steps to perform',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['click', 'type', 'wait', 'screenshot', 'scroll', 'select', 'get_text'], description: 'Action to perform' },
              selector: { type: 'string', description: 'CSS selector for the target element' },
              value: { type: 'string', description: 'Text to type, option value to select, or milliseconds to wait' }
            },
            required: ['action']
          }
        }
      },
      required: ['url', 'steps']
    }
  },
  {
    name: 'pc_browse_url',
    description: "Open a URL in Jed's browser on his PC (uses his logged-in sessions for Google, Facebook, etc.). Can open a URL or take a screenshot of the current screen. Use this when the task requires authentication.",
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL to open in browser' },
        action: { type: 'string', enum: ['open', 'screenshot'], description: 'open (default): opens URL in default browser. screenshot: captures current screen state.' }
      },
      required: ['url']
    }
  }
];

// ── WORKSHOP TOOL EXECUTOR (Phase 7)`;

if (code.includes(DEFS_ANCHOR)) {
  code = code.replace(DEFS_ANCHOR, NEW_DEFS);
  console.log('✅ Added browser tool definitions');
} else {
  console.log('❌ Could not find DEFS_ANCHOR');
  const idx = code.indexOf('// ── WORKSHOP TOOL EXECUTOR');
  if (idx > -1) console.log('Context:', JSON.stringify(code.slice(idx - 60, idx + 40)));
  process.exit(1);
}

// ── STEP 2: Add executors ─────────────────────────────────────────────────
// Insert before the default case in executeTool
const EXECUTOR_ANCHOR = "      default:\n        return { ok: false, error: `Unknown tool:";

const NEW_EXECUTORS = `      case 'browse_url': {
        const { chromium } = require('playwright');
        const url = input.url;
        const action = input.action || 'get_text';
        const waitFor = input.wait_for || null;
        let browser = null;
        try {
          browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
          });
          const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          });
          const page = await context.newPage();
          page.setDefaultTimeout(30000);
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          if (waitFor) {
            await page.waitForSelector(waitFor, { timeout: 10000 }).catch(() => {});
          }
          if (action === 'screenshot') {
            const screenshotDir = '/tmp/browser_screenshots';
            if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
            const screenshotPath = \`\${screenshotDir}/\${Date.now()}.png\`;
            await page.screenshot({ path: screenshotPath, fullPage: false });
            await browser.close();
            return { ok: true, path: screenshotPath, url };
          } else if (action === 'get_html') {
            const html = await page.content();
            await browser.close();
            return { ok: true, html: html.slice(0, 8000), truncated: html.length > 8000, url };
          } else {
            // get_text (default)
            const text = await page.evaluate(() => {
              // Remove scripts, styles, nav, footer for cleaner text
              const remove = document.querySelectorAll('script,style,nav,footer,header,aside');
              remove.forEach(el => el.remove());
              return document.body ? document.body.innerText : document.documentElement.innerText;
            });
            await browser.close();
            return { ok: true, text: text.slice(0, 8000), truncated: text.length > 8000, url };
          }
        } catch (e) {
          if (browser) await browser.close().catch(() => {});
          return { ok: false, error: \`browse_url failed: \${e.message}\`, url };
        }
      }

      case 'browser_interact': {
        const { chromium } = require('playwright');
        const url = input.url;
        const steps = input.steps || [];
        let browser = null;
        const results = [];
        try {
          browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
          });
          const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          });
          const page = await context.newPage();
          page.setDefaultTimeout(60000);
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          results.push({ step: 0, action: 'navigate', status: 'ok', url });
          for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            try {
              if (step.action === 'click') {
                await page.click(step.selector, { timeout: 10000 });
                results.push({ step: i + 1, action: 'click', selector: step.selector, status: 'ok' });
              } else if (step.action === 'type') {
                await page.fill(step.selector, step.value || '', { timeout: 10000 });
                results.push({ step: i + 1, action: 'type', selector: step.selector, status: 'ok' });
              } else if (step.action === 'select') {
                await page.selectOption(step.selector, step.value || '', { timeout: 10000 });
                results.push({ step: i + 1, action: 'select', selector: step.selector, value: step.value, status: 'ok' });
              } else if (step.action === 'wait') {
                const ms = parseInt(step.value) || 1000;
                await page.waitForTimeout(ms);
                results.push({ step: i + 1, action: 'wait', ms, status: 'ok' });
              } else if (step.action === 'scroll') {
                await page.evaluate(() => window.scrollBy(0, 500));
                results.push({ step: i + 1, action: 'scroll', status: 'ok' });
              } else if (step.action === 'screenshot') {
                const screenshotDir = '/tmp/browser_screenshots';
                if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
                const screenshotPath = \`\${screenshotDir}/step_\${i + 1}_\${Date.now()}.png\`;
                await page.screenshot({ path: screenshotPath, fullPage: false });
                results.push({ step: i + 1, action: 'screenshot', path: screenshotPath, status: 'ok' });
              } else if (step.action === 'get_text') {
                const sel = step.selector || 'body';
                const text = await page.evaluate((s) => {
                  const el = document.querySelector(s);
                  return el ? el.innerText : '';
                }, sel);
                results.push({ step: i + 1, action: 'get_text', selector: sel, text: text.slice(0, 2000), status: 'ok' });
              } else {
                results.push({ step: i + 1, action: step.action, status: 'unknown_action' });
              }
            } catch (stepErr) {
              results.push({ step: i + 1, action: step.action, status: 'error', error: stepErr.message });
            }
          }
          await browser.close();
          return { ok: true, url, steps_completed: results.length - 1, results };
        } catch (e) {
          if (browser) await browser.close().catch(() => {});
          return { ok: false, error: \`browser_interact failed: \${e.message}\`, url, results };
        }
      }

      case 'pc_browse_url': {
        const url = input.url;
        const action = input.action || 'open';
        if (action === 'open') {
          // Open URL in Jed's default browser (uses his logged-in sessions)
          const cmd = \`Start-Process '\${url}'\`;
          const res = await executeTool('pc_execute', { command: cmd, timeout_ms: 15000 });
          return res.ok
            ? { ok: true, message: \`Opened \${url} in Jed's browser\` }
            : { ok: false, error: \`Failed to open URL: \${res.error}\` };
        } else if (action === 'screenshot') {
          // Take a screenshot of Jed's current screen
          const screenshotPcPath = 'D:\\\\pc_screenshot.png';
          const screenshotCmd = \`Add-Type -AssemblyName System.Windows.Forms; $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height); $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size); $bmp.Save('\${screenshotPcPath}'); $g.Dispose(); $bmp.Dispose()\`;
          const ssRes = await executeTool('pc_execute', { command: screenshotCmd, timeout_ms: 20000 });
          if (!ssRes.ok) return { ok: false, error: \`Screenshot failed: \${ssRes.error}\` };
          // Read the screenshot back from PC
          const readRes = await executeTool('file_read', { path: screenshotPcPath });
          if (!readRes.ok) return { ok: false, error: \`Could not read screenshot: \${readRes.error}\` };
          // Save locally on VPS
          const localDir = '/tmp/browser_screenshots';
          if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });
          const localPath = \`\${localDir}/pc_screen_\${Date.now()}.png\`;
          // The relay returns base64 content for binary files
          const buf = Buffer.from(readRes.content, 'base64');
          fs.writeFileSync(localPath, buf);
          return { ok: true, path: localPath, message: "Screenshot of Jed's PC saved to VPS" };
        } else {
          return { ok: false, error: \`Unknown action: \${action}. Use 'open' or 'screenshot'.\` };
        }
      }

      default:\n        return { ok: false, error: \`Unknown tool:`;

if (code.includes(EXECUTOR_ANCHOR)) {
  code = code.replace(EXECUTOR_ANCHOR, NEW_EXECUTORS);
  console.log('✅ Added browser tool executors');
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
  ["browse_url definition", patched.includes("name: 'browse_url'")],
  ["browser_interact definition", patched.includes("name: 'browser_interact'")],
  ["pc_browse_url definition", patched.includes("name: 'pc_browse_url'")],
  ["Playwright import in executor", patched.includes("require('playwright')")],
  ["Headless chromium launch", patched.includes("'--no-sandbox'")],
  ["Screenshot dir creation", patched.includes('/tmp/browser_screenshots')],
  ["browser_interact steps loop", patched.includes('steps_completed')],
  ["pc_browse_url Start-Process", patched.includes('Start-Process')],
  ["generate_image still present", patched.includes("name: 'generate_image'")],
  ["module.exports intact", patched.includes('module.exports = { TOOL_DEFINITIONS, executeTool }')],
];
let allPass = true;
for (const [label, ok] of checks) {
  console.log(`  ${ok ? '✅' : '❌'} ${label}`);
  if (!ok) allPass = false;
}
if (allPass) console.log('\nALL CHECKS PASSED');
else { console.log('\nSOME CHECKS FAILED'); process.exit(1); }
