# Playwright Auth Setup — YouTube (one-time)

This is a **one-time** setup. Once done, Solomon can post to the Building Shultz YouTube community page automatically (no API restrictions, no manual pasting).

You only have to do this **once per Google account**. You only have to redo it if Google logs you out (rare — usually months apart).

---

## What you're doing in one sentence

You're logging into YouTube **once** in a special browser on your PC, then sending the saved login session file to the VPS. After that, Solomon uses your saved session to post on your behalf.

---

## The steps — pick ONE path

### Path A — Easiest (PowerShell, ~3 minutes)

Open **PowerShell** on your Windows PC. Paste this **one line** and hit Enter:

```powershell
scp -i C:\Users\Ashle\.ssh\hostinger_solomon root@167.99.237.26:/root/solomon-v4/scripts/setup-yt-pw.ps1 $env:TEMP\setup-yt-pw.ps1; powershell -ExecutionPolicy Bypass -File $env:TEMP\setup-yt-pw.ps1
```

Then:
1. Wait a moment — the first run installs Playwright + Chromium (~250MB, only happens once).
2. A **Chromium browser window will open** and go to YouTube.
3. **Sign in as the Google account that owns the Building Shultz brand channel** (NOT your personal account if they're different).
4. If YouTube asks "Which channel?", pick **Building Shultz**.
5. Once you see the YouTube home page logged in as Building Shultz, **return to the PowerShell window and press Enter**.
6. The script saves your login session and **automatically uploads it to the VPS**. Done.

When it's done you'll see: `✅ Uploaded .pw_state_youtube.json to VPS — Solomon can now post to YouTube community.`

If anything fails, send me the last few lines of the PowerShell output and I'll fix it.

---

### Path B — Manual (if Path A's PowerShell line doesn't work)

1. **Download the capture script:**
   ```powershell
   scp -i C:\Users\Ashle\.ssh\hostinger_solomon root@167.99.237.26:/root/solomon-v4/scripts/capture_yt_pw_auth.js C:\Users\Ashle\Desktop\capture_yt_pw_auth.js
   ```

2. **In a new folder, install Playwright** (~250MB, one-time):
   ```powershell
   cd C:\Users\Ashle\Desktop
   mkdir solomon-pw-auth -Force; cd solomon-pw-auth
   npm init -y
   npm install playwright
   npx playwright install chromium
   ```

3. **Move the script and run it:**
   ```powershell
   move ..\capture_yt_pw_auth.js .
   node capture_yt_pw_auth.js
   ```

4. **Browser opens** → sign in to YouTube as the Building Shultz account → pick the Building Shultz channel if asked → return to PowerShell and press Enter.

5. **Upload the saved file to the VPS:**
   ```powershell
   scp -i C:\Users\Ashle\.ssh\hostinger_solomon .pw_state_youtube.json root@167.99.237.26:/root/solomon-v4/.pw_state_youtube.json
   ```

Done.

---

## How to know it worked

After the upload, send Solomon: `/post test community post — please ignore`. Solomon should post it to the Building Shultz YouTube community page within a minute. If you see a "auth state expired" error, the session is bad — just run Path A again.

## Privacy / safety

- The saved file (`.pw_state_youtube.json`) is your YouTube login cookies. **Never share it** with anyone or commit it to git.
- It is gitignored on the VPS (pattern `.pw_state_*.json`).
- File permissions on the VPS are chmod 600 (root-only).
- You can revoke the saved session at any time by signing out everywhere from your Google Account → Security → Manage devices, then redoing Path A.

## When you need to redo this

- If Solomon's YouTube community post returns "auth state expired"
- If you've signed out from YouTube everywhere
- If you changed the Google account's password recently and got logged out
