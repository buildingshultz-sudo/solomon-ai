'use strict';

const fs = require('fs');
const path = require('path');

let playwright = null;

// Lazy-load playwright to avoid crash if not installed
function getPlaywright() {
  if (!playwright) {
    try {
      playwright = require('playwright');
    } catch (err) {
      throw new Error('Playwright not installed. Run: npm install playwright && npx playwright install chromium');
    }
  }
  return playwright;
}

// Launch a headless browser instance
async function launchBrowser(headless) {
  const pw = getPlaywright();
  const browser = await pw.chromium.launch({
    headless: headless !== false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  return browser;
}

// Navigate to URL and return page text content
async function navigateTo(browser, url) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);
  const text = await page.evaluate(() => document.body.innerText);
  await context.close();
  return (text || "").slice(0, 10000); // Limit to 10k chars
}

// Scrape text from a specific CSS selector
async function scrapeSelector(browser, url, cssSelector) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const elements = await page.$$(cssSelector);
  const results = [];
  for (const el of elements) {
    const text = await el.innerText();
    results.push(text);
  }
  await context.close();
  return results;
}

// Take a screenshot of a page
async function takeScreenshot(browser, url, outputPath) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

  const resolvedPath = path.resolve(outputPath || `./screenshot_${Date.now()}.png`);
  await page.screenshot({ path: resolvedPath, fullPage: true });
  await context.close();
  return resolvedPath;
}

// Close the browser instance
async function closeBrowser(browser) {
  if (browser) {
    await browser.close();
  }
  return { closed: true };
}

// Convenience: scrape a page and return structured data
async function scrapePage(url, selectors) {
  const browser = await launchBrowser(true);
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const results = {};
  if (selectors && typeof selectors === 'object') {
    for (const [key, selector] of Object.entries(selectors)) {
      const els = await page.$$(selector);
      results[key] = [];
      for (const el of els) {
        results[key].push(await el.innerText());
      }
    }
  } else {
    results.body = (await page.innerText('body')).slice(0, 10000);
  }

  await context.close();
  await browser.close();
  return results;
}


// Navigate to URL and extract text (auto-manages browser lifecycle)
async function navigateAndExtract(url, selector) {
  const browser = await launchBrowser(true);
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    let text;
    if (selector && selector !== 'body') {
      const els = await page.$(selector);
      const parts = [];
      for (const el of els) { parts.push(await el.innerText()); }
      text = parts.join('\n');
    } else {
      await page.waitForTimeout(2000); text = await page.evaluate(() => document.body.innerText);
    }
    await context.close();
    await browser.close();
    return (text || "").slice(0, 10000);
  } catch (e) {
    await browser.close();
    throw e;
  }
}

// Full browser session with actions, login, screenshots
async function browserSession(options) {
  const { url, actions, screenshotPath, extractSelector } = options;
  const browser = await launchBrowser(true);
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  const results = { url, actions_performed: [] };
  if (actions && Array.isArray(actions)) {
    for (const action of actions) {
      try {
        if (action.type === 'click') {
          await page.click(action.selector, { timeout: 10000 });
          results.actions_performed.push('clicked: ' + action.selector);
        } else if (action.type === 'fill') {
          await page.fill(action.selector, action.value, { timeout: 10000 });
          results.actions_performed.push('filled: ' + action.selector);
        } else if (action.type === 'wait') {
          await page.waitForTimeout(action.ms || 2000);
          results.actions_performed.push('waited: ' + (action.ms || 2000) + 'ms');
        } else if (action.type === 'goto') {
          await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          results.actions_performed.push('navigated: ' + action.url);
        } else if (action.type === 'press') {
          await page.keyboard.press(action.key);
          results.actions_performed.push('pressed: ' + action.key);
        }
      } catch (e) {
        results.actions_performed.push('FAILED ' + action.type + ': ' + e.message);
      }
    }
  }
  if (screenshotPath) {
    await page.screenshot({ path: screenshotPath, fullPage: false });
    results.screenshot = screenshotPath;
  }
  const sel = extractSelector || 'body';
  try {
    if (sel === 'body') {
      results.text = (await page.evaluate(() => document.body.innerText) || '').slice(0, 8000);
    } else {
      const els = await page.$(sel);
      const parts = [];
      for (const el of els) { parts.push(await el.innerText()); }
      results.text = parts.join('\n').slice(0, 8000);
    }
  } catch (e) {
    results.text = '(extraction failed: ' + e.message + ')';
  }
  results.finalUrl = page.url();
  await context.close();
  await browser.close();
  return results;
}

module.exports = {
  launchBrowser,
  navigateTo,
  scrapeSelector,
  takeScreenshot,
  closeBrowser,
  scrapePage,
  navigateAndExtract,
  browserSession
};
