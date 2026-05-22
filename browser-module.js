/**
 * Solomon Browser Automation Module
 * Multi-step Puppeteer browser control for the PC agent.
 * Maintains a persistent browser session across commands.
 * 
 * Commands:
 *   browser_open [url]           - Open URL, return title + text
 *   browser_fill [selector] [value] - Fill a form field
 *   browser_click [selector]     - Click an element
 *   browser_screenshot           - Take screenshot, return base64
 *   browser_text [selector]      - Extract text from element(s)
 *   browser_wait [selector]      - Wait for element to appear (up to 15s)
 *   browser_navigate [url]       - Navigate to URL in existing session
 *   browser_eval [js]            - Evaluate JavaScript in page context
 *   browser_close                - Close browser session
 */

const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

let browser = null;
let page = null;

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  process.env.CHROME_PATH || ''
].filter(Boolean);

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  
  let execPath = null;
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) { execPath = p; break; }
  }
  if (!execPath) throw new Error('No Chrome/Edge found. Install Chrome or set CHROME_PATH.');
  
  browser = await puppeteer.launch({
    executablePath: execPath,
    headless: false,  // Visible so OBS can record it
    defaultViewport: { width: 1920, height: 1080 },
    args: ['--start-maximized', '--no-sandbox', '--disable-blink-features=AutomationControlled'],
    userDataDir: path.join(process.env.USERPROFILE || 'C:\\Users\\Ashle', 'SolomonBrowser')
  });
  
  const pages = await browser.pages();
  page = pages[0] || await browser.newPage();
  
  // Set user agent to avoid bot detection
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
  
  return browser;
}

async function getPage() {
  await getBrowser();
  if (!page || page.isClosed()) {
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
  }
  return page;
}

async function handleBrowserCommand(fullCommand) {
  const parts = fullCommand.trim().split(/\s+/);
  const cmd = parts[0];
  const args = fullCommand.trim().slice(cmd.length).trim();
  
  try {
    switch (cmd) {
      case 'browser_open':
      case 'browser_navigate': {
        const url = args;
        if (!url) return { exitCode: 1, stdout: JSON.stringify({ error: 'No URL provided' }) };
        const p = await getPage();
        await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await p.waitForTimeout(2000); // Let dynamic content load
        const title = await p.title();
        const pageUrl = p.url();
        const text = await p.evaluate(() => {
          const el = document.body;
          return el ? el.innerText.slice(0, 5000) : '';
        });
        return { exitCode: 0, stdout: JSON.stringify({ title, url: pageUrl, text, step: 'page_loaded' }) };
      }
      
      case 'browser_fill': {
        // Format: browser_fill selector|||value
        const sepIdx = args.indexOf('|||');
        if (sepIdx === -1) return { exitCode: 1, stdout: JSON.stringify({ error: 'Use format: browser_fill selector|||value' }) };
        const selector = args.slice(0, sepIdx).trim();
        const value = args.slice(sepIdx + 3).trim();
        const p = await getPage();
        await p.waitForSelector(selector, { timeout: 10000 });
        await p.click(selector, { clickCount: 3 }); // Select existing text
        await p.type(selector, value, { delay: 50 });
        return { exitCode: 0, stdout: JSON.stringify({ step: 'field_filled', selector, valueLength: value.length }) };
      }
      
      case 'browser_click': {
        const selector = args;
        if (!selector) return { exitCode: 1, stdout: JSON.stringify({ error: 'No selector provided' }) };
        const p = await getPage();
        await p.waitForSelector(selector, { timeout: 10000 });
        await p.click(selector);
        await p.waitForTimeout(2000); // Wait for navigation/response
        const newUrl = p.url();
        const newTitle = await p.title();
        return { exitCode: 0, stdout: JSON.stringify({ step: 'clicked', selector, url: newUrl, title: newTitle }) };
      }
      
      case 'browser_screenshot': {
        const p = await getPage();
        const screenshotDir = path.join(process.env.USERPROFILE || 'C:\\Users\\Ashle', 'Desktop', 'AI Journey', 'Screen Recordings');
        if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
        const filename = `screenshot_${Date.now()}.png`;
        const filepath = path.join(screenshotDir, filename);
        await p.screenshot({ path: filepath, fullPage: false });
        const base64 = fs.readFileSync(filepath).toString('base64').slice(0, 500); // Just confirm it exists
        return { exitCode: 0, stdout: JSON.stringify({ step: 'screenshot_taken', path: filepath, size: fs.statSync(filepath).size }) };
      }
      
      case 'browser_text': {
        const selector = args || 'body';
        const p = await getPage();
        await p.waitForSelector(selector, { timeout: 10000 });
        const text = await p.evaluate((sel) => {
          const els = document.querySelectorAll(sel);
          return Array.from(els).map(el => el.innerText).join('\n').slice(0, 5000);
        }, selector);
        return { exitCode: 0, stdout: JSON.stringify({ step: 'text_extracted', selector, text }) };
      }
      
      case 'browser_wait': {
        const selector = args;
        if (!selector) return { exitCode: 1, stdout: JSON.stringify({ error: 'No selector provided' }) };
        const p = await getPage();
        await p.waitForSelector(selector, { timeout: 15000 });
        return { exitCode: 0, stdout: JSON.stringify({ step: 'element_found', selector }) };
      }
      
      case 'browser_eval': {
        const js = args;
        if (!js) return { exitCode: 1, stdout: JSON.stringify({ error: 'No JS provided' }) };
        const p = await getPage();
        const result = await p.evaluate((code) => {
          try { return String(eval(code)); }
          catch (e) { return 'ERROR: ' + e.message; }
        }, js);
        return { exitCode: 0, stdout: JSON.stringify({ step: 'eval_complete', result: result.slice(0, 3000) }) };
      }
      
      case 'browser_close': {
        if (browser) {
          await browser.close();
          browser = null;
          page = null;
        }
        return { exitCode: 0, stdout: JSON.stringify({ step: 'browser_closed' }) };
      }
      
      default:
        return null; // Not a browser command
    }
  } catch (e) {
    return { exitCode: 1, stdout: JSON.stringify({ error: e.message, step: 'failed' }) };
  }
}

module.exports = { handleBrowserCommand, getBrowser, getPage };
