// One-time KDP auth capture for Solomon's daily royalty scrape.
// Run this on your PC (not the VPS — Playwright needs a real display).
//
//   node capture_kdp_pw_auth.js
//
// A Chromium window opens at https://kdp.amazon.com. Sign in with the Amazon
// account that owns your KDP books. If Amazon prompts for a 2FA code, enter
// it normally. Once you see your KDP Bookshelf / Reports page, return to the
// terminal and press Enter. The script saves the storage state to
// .pw_state_kdp.json in the current directory, which you then scp to the VPS
// at /root/solomon-v4/.pw_state_kdp.json (the setup-kdp-pw.ps1 helper does
// this upload automatically).
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

  const outPath = path.resolve('.pw_state_kdp.json');
  console.log('\n=== Solomon KDP auth capture ===');
  console.log('A browser will open. Sign in with the Amazon account that owns your KDP books.');
  console.log('If Amazon asks for a 2FA code, enter it normally.\n');

  const browser = await chromium.launch({ headless: false, args: ['--no-first-run'] });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'
  });
  const page = await ctx.newPage();
  await page.goto('https://kdp.amazon.com/', { waitUntil: 'domcontentloaded' });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => {
    rl.question('\nAfter you are signed in and see your KDP Bookshelf or Reports page, press Enter here to save the session...\n> ', () => {
      rl.close();
      resolve();
    });
  });

  const finalUrl = page.url();
  if (/ap\/signin|amazon\.com\/ap\//i.test(finalUrl)) {
    console.error('\n[WARN] Still on the Amazon login page. Sign in first, then re-run this script.');
    await browser.close();
    process.exit(2);
  }

  await ctx.storageState({ path: outPath });
  await browser.close();
  console.log(`\n✅ Saved Playwright storage state to: ${outPath}`);
  console.log('Next: upload this file to the VPS at /root/solomon-v4/.pw_state_kdp.json');
  console.log('  scp -i C:\\Users\\Ashle\\.ssh\\hostinger_solomon .pw_state_kdp.json root@167.99.237.26:/root/solomon-v4/.pw_state_kdp.json');
})().catch(err => {
  console.error('\n[ERROR]', err && err.message ? err.message : err);
  process.exit(1);
});
