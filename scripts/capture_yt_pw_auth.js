// One-time YouTube auth capture for Solomon's Playwright community-post tool.
// Run this on your PC (not the VPS — Playwright needs a real display).
//
//   node capture_yt_pw_auth.js
//
// A Chromium window opens at https://studio.youtube.com. Sign in as the
// Google account that owns the Building Shultz brand channel. If YouTube asks
// "Which channel?", pick Building Shultz. Return to the terminal and press
// Enter. The script saves the storage state to .pw_state_youtube.json in the
// current directory, which you then scp to the VPS at
// /root/solomon-v4/.pw_state_youtube.json (the setup-yt-pw.ps1 helper does
// this upload automatically; if you ran this script directly, scp it yourself).
'use strict';
const path = require('path');
const readline = require('readline');

(async () => {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (e) {
    console.error('\n[ERROR] Playwright is not installed in this folder.');
    console.error('Run:  npm install playwright   then:  npx playwright install chromium\n');
    process.exit(1);
  }

  const outPath = path.resolve('.pw_state_youtube.json');
  console.log('\n=== Solomon YouTube auth capture ===');
  console.log('A browser will open. Sign in as the Building Shultz brand channel.');
  console.log('If YouTube asks "Which channel?", pick Building Shultz, not your personal one.\n');

  const browser = await chromium.launch({ headless: false, args: ['--no-first-run'] });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 880 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'
  });
  const page = await ctx.newPage();
  await page.goto('https://studio.youtube.com/', { waitUntil: 'domcontentloaded' });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => {
    rl.question('\nAfter you are signed in and see YouTube Studio, press Enter here to save the session...\n> ', () => {
      rl.close();
      resolve();
    });
  });

  // Sanity check: confirm we're on a YouTube domain (not a Google login screen).
  const finalUrl = page.url();
  if (/accounts\.google\.com/.test(finalUrl)) {
    console.error('\n[WARN] Still on the Google login page. Sign in first, then re-run this script.');
    await browser.close();
    process.exit(2);
  }

  await ctx.storageState({ path: outPath });
  await browser.close();
  console.log(`\n✅ Saved Playwright storage state to: ${outPath}`);
  console.log('Next: upload this file to the VPS at /root/solomon-v4/.pw_state_youtube.json');
  console.log('  scp -i C:\\Users\\Ashle\\.ssh\\hostinger_solomon .pw_state_youtube.json root@167.99.237.26:/root/solomon-v4/.pw_state_youtube.json');
})().catch(err => {
  console.error('\n[ERROR]', err && err.message ? err.message : err);
  process.exit(1);
});
