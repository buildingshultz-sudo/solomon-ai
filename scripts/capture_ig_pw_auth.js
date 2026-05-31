// One-time Instagram auth capture for Solomon's Playwright feed-post tool.
// Run on Jed's PC (not the VPS - Playwright needs a real display).
//
//   node capture_ig_pw_auth.js
//
// Drives YOUR real installed Google Chrome using your existing User Data /
// Default profile (where you are already signed in to Instagram). Because we
// are reusing the real signed-in profile, NO login UI appears - Chrome opens
// already authenticated.
//
// IMPORTANT: Chrome cannot already be running with that profile when this
// starts. The accompanying setup-ig-pw.ps1 detects + offers to close Chrome
// before invoking this script.
'use strict';
const path = require('path');
const fs = require('fs');
const readline = require('readline');

function prompt(q) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, () => { rl.close(); resolve(); });
  });
}

(async () => {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (e) {
    console.error('\n[ERROR] Playwright is not installed in this folder.');
    console.error('Run:  npm install playwright\n');
    process.exit(1);
  }

  const chromeCandidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : null
  ].filter(Boolean);
  const chromeExe = chromeCandidates.find(p => { try { return fs.existsSync(p); } catch (_) { return false; } });
  if (!chromeExe) {
    console.error('\n[ERROR] Could not find Google Chrome on this PC.');
    console.error('Install it from https://www.google.com/chrome/ and re-run.\n');
    process.exit(1);
  }

  const userDataDir = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data')
    : null;
  if (!userDataDir || !fs.existsSync(userDataDir)) {
    console.error('\n[ERROR] Chrome User Data directory not found.');
    console.error('Expected at: ' + (userDataDir || 'C:\\Users\\<you>\\AppData\\Local\\Google\\Chrome\\User Data'));
    process.exit(1);
  }

  const outPath = path.resolve('.pw_state_instagram.json');

  console.log('\n=== Solomon Instagram auth capture ===');
  console.log('Chrome:      ' + chromeExe);
  console.log('Profile dir: ' + userDataDir + '  (Default profile)');
  console.log('Output:      ' + outPath);
  console.log('');
  console.log('Opening Instagram in your real Chrome - you should already be signed in.');
  console.log('No login UI will appear if your Chrome already has your IG account signed in.\n');

  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: chromeExe,
      channel: 'chrome',
      headless: false,
      viewport: null,
      args: ['--profile-directory=Default']
    });
  } catch (err) {
    console.error('\n[ERROR] Could not launch Chrome with your profile.');
    console.error('Most common cause: another Chrome window is still open holding the profile lock.');
    console.error('Close ALL Chrome windows (check the system tray for background Chrome too) and re-run.');
    console.error('\nUnderlying error: ' + (err && err.message ? err.message : err));
    process.exit(2);
  }

  const page = context.pages()[0] || await context.newPage();
  try {
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (e) {
    console.error('\n[WARN] Could not load instagram.com: ' + e.message);
    console.error('You can still navigate manually inside the open Chrome window.');
  }

  console.log('\nIf Instagram loaded already signed in (you see your feed / home, NOT a login page), you are good.');
  console.log('If you see a login page, sign in normally - the session will be remembered for next time.');
  console.log('If your IG account is not the one you want Solomon to post from: log out and log into the right one.\n');

  await prompt('Press Enter here once Instagram shows your home feed signed in...\n> ');

  const finalUrl = page.url();
  if (/accounts\/login/.test(finalUrl)) {
    console.error('\n[WARN] Still on the Instagram login page. Sign in first, then re-run.');
    await context.close();
    process.exit(3);
  }

  try {
    await context.storageState({ path: outPath });
  } catch (e) {
    console.error('\n[ERROR] storageState save failed: ' + e.message);
    await context.close();
    process.exit(4);
  }
  await context.close();
  console.log('\n[OK] Saved Playwright storage state to: ' + outPath);
  console.log('Next: upload to VPS as /root/solomon-v4/.pw_state_instagram.json (the .ps1 wrapper does this).');
})().catch(err => {
  console.error('\n[ERROR]', err && err.message ? err.message : err);
  process.exit(1);
});
