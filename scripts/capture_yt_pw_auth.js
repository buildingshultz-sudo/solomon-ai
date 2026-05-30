// One-time YouTube auth capture for Solomon's Playwright community-post tool.
// Run this on your PC (not the VPS - Playwright needs a real display).
//
//   node capture_yt_pw_auth.js
//
// Drives YOUR real installed Google Chrome using your existing User Data /
// Default profile (where you are already signed in to your Google accounts).
// Because we are reusing the real signed-in profile, NO login UI appears -
// Chrome opens already authenticated. This bypasses Google's "this browser
// or app may not be secure" check entirely because the session is identical
// to the one you use day-to-day.
//
// IMPORTANT: Chrome cannot already be running with that profile when this
// starts. The accompanying setup-yt-pw.ps1 detects + offers to close Chrome
// before invoking this script. If you ran this script directly, close every
// Chrome window first.
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

  // Locate the user's installed Chrome executable.
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

  // Point at the real Chrome User Data directory + Default profile.
  // This is where your day-to-day Chrome stores cookies / sessions / logged-in
  // accounts. Reusing it means YouTube opens already authenticated.
  const userDataDir = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data')
    : null;
  if (!userDataDir || !fs.existsSync(userDataDir)) {
    console.error('\n[ERROR] Chrome User Data directory not found.');
    console.error('Expected at: ' + (userDataDir || 'C:\\Users\\<you>\\AppData\\Local\\Google\\Chrome\\User Data'));
    process.exit(1);
  }

  const outPath = path.resolve('.pw_state_youtube.json');

  console.log('\n=== Solomon YouTube auth capture ===');
  console.log('Chrome:      ' + chromeExe);
  console.log('Profile dir: ' + userDataDir + '  (Default profile)');
  console.log('Output:      ' + outPath);
  console.log('');
  console.log('Opening YouTube Studio in your real Chrome - you should already be signed in.');
  console.log('No login UI will appear if your Chrome already has a Google account signed in.\n');

  // Launch the real Chrome with the Default profile. NO --no-sandbox, NO
  // automation flags - we want this to look identical to a normal Chrome run.
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

  // Use the first page Chrome opened (it always has at least one).
  const page = context.pages()[0] || await context.newPage();
  try {
    await page.goto('https://studio.youtube.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (e) {
    console.error('\n[WARN] Could not load YouTube Studio: ' + e.message);
    console.error('You can still navigate manually inside the open Chrome window.');
  }

  console.log('\nIf YouTube Studio loaded with the BUILDING SHULTZ channel selected, you are good.');
  console.log('If it opened a different channel: click your avatar (top right) -> Switch account -> pick Building Shultz.');
  console.log('If you see a Google sign-in page, sign in normally - it will be remembered for next time.\n');

  await prompt('Press Enter here once YouTube Studio shows the Building Shultz channel...\n> ');

  // Sanity check: make sure we are not still on the Google sign-in page.
  const finalUrl = page.url();
  if (/accounts\.google\.com/.test(finalUrl)) {
    console.error('\n[WARN] Still on the Google sign-in page. Sign in first, then re-run.');
    await context.close();
    process.exit(3);
  }

  // Save Playwright storage state (cookies + localStorage) for the headless
  // postViaBrowser tool on the VPS. setup-yt-pw.ps1 will scp this up.
  try {
    await context.storageState({ path: outPath });
  } catch (e) {
    console.error('\n[ERROR] storageState save failed: ' + e.message);
    await context.close();
    process.exit(4);
  }
  await context.close();
  console.log('\n[OK] Saved Playwright storage state to: ' + outPath);
  console.log('Next: upload to VPS as /root/solomon-v4/.pw_state_youtube.json (the .ps1 wrapper does this).');
})().catch(err => {
  console.error('\n[ERROR]', err && err.message ? err.message : err);
  process.exit(1);
});
