# Playwright auth setup — one-time, per platform

Solomon's `post_via_browser` tool drives a real headless Chromium on the VPS to post to
YouTube (community posts) and Instagram (feed), because their public APIs don't allow it.
The browser needs a saved login session. This file tells you how to create that.

**The state files contain login cookies — never commit them. They're gitignored as
`.pw_state_*.json` already.**

## One-time setup (per platform)

### A. On Jed's PC (the one signed into the target Google/Instagram account)

1. In a terminal, create a temp folder and install Playwright:
   ```
   mkdir pw_setup && cd pw_setup
   npm init -y
   npm i playwright
   npx playwright install chromium
   ```

2. Save this as `save_state.js` in that folder (replace `youtube` with `instagram` to do IG):
   ```js
   // save_state.js — opens a real browser, you log in once, it saves the session.
   const { chromium } = require('playwright');
   (async () => {
     const platform = process.argv[2] || 'youtube';
     const url = platform === 'youtube'
       ? 'https://studio.youtube.com/'
       : 'https://www.instagram.com/accounts/login/';
     const browser = await chromium.launch({ headless: false });
     const ctx = await browser.newContext();
     const page = await ctx.newPage();
     await page.goto(url);
     console.log(`\n>> A browser window just opened. Log into ${platform} normally`);
     console.log(`>> (do 2FA / pass the consent screens / land on the home page).`);
     console.log(`>> When you're fully signed in, come back here and press ENTER.\n`);
     process.stdin.once('data', async () => {
       await ctx.storageState({ path: `.pw_state_${platform}.json` });
       await browser.close();
       console.log(`Saved .pw_state_${platform}.json`);
       process.exit(0);
     });
   })();
   ```

3. Run it:
   ```
   node save_state.js youtube
   ```
   A Chromium window opens. Log into the target Google account, click through any
   "Brand account" picker so you land on **Building Shultz** YouTube Studio. Once you
   see the Studio dashboard, return to the terminal and press ENTER. It writes
   `.pw_state_youtube.json` in the current folder.

4. Upload it to the VPS:
   ```
   scp -i C:\Users\Ashle\.ssh\hostinger_solomon .pw_state_youtube.json root@167.99.237.26:/root/solomon-v4/.pw_state_youtube.json
   ```

5. Repeat for Instagram: `node save_state.js instagram`, then scp the file. (Note:
   IG auto-posting via browser is more fragile than YT and IG actively detects
   automation — start with YT.)

## Test it

After the state file is in place, on the VPS:
```
ssh -i C:\Users\Ashle\.ssh\hostinger_solomon root@167.99.237.26
cd /root/solomon-v4
node -e "require('./tools').executeTool('post_via_browser',{platform:'youtube',content:'Test post from Solomon — please ignore'}).then(r=>console.log(JSON.stringify(r)))"
```

You should see `{"ok":true,"platform":"youtube","message":"YouTube community post submitted via browser."}` and the post should appear on the channel.

## When auth expires

Sessions eventually expire (Google ~weeks-to-months, IG faster). When `post_via_browser`
starts returning an "auth state expired" error, repeat step 3 + 4 to refresh.

## Important

- **Never share or commit `.pw_state_*.json`** — anyone with the file can post as Jed.
- IG/YT may flag automated activity. Use sparingly; don't post identical content rapidly.
- Selectors in `_ytCommunityPost` / `_igFeedPost` are defensive but may break when
  YouTube/Instagram updates their UI. If a post fails with a selector error, fall back
  to manual posting and ping Sam to refresh the selectors.
