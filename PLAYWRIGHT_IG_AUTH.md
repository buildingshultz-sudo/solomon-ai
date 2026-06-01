# Playwright Auth Setup — Instagram (one-time)

This lets Solomon post to Instagram (feed posts only — IG Reels and Stories need different flows) using your real, already-signed-in IG session. You only do this **once per IG account**; redo only if Instagram logs you out (rare).

Mirror of the YouTube auth setup — same architecture, different platform.

---

## What you're doing in one sentence

Sign into Instagram **once** in your real Chrome on your PC, then the saved login session is sent to the VPS so Solomon can post on your behalf.

---

## The steps — pick ONE path

### Path A — Easiest (PowerShell, ~3 minutes)

Open **PowerShell** on your Windows PC. Paste this **one line** and hit Enter:

```powershell
scp -i C:\Users\Ashle\.ssh\hostinger_solomon root@167.99.237.26:/root/solomon-v4/scripts/setup-ig-pw.ps1 $env:TEMP\setup-ig-pw.ps1; powershell -ExecutionPolicy Bypass -File $env:TEMP\setup-ig-pw.ps1
```

Then:
1. The script checks Node + Chrome + your Chrome profile dir, then **auto-closes any running Chrome** (no prompt — Ctrl+Shift+T in the new Chrome restores last-closed tabs after the capture finishes). If sandbox-helper Chrome processes survive (ACL-protected), it bails with a clear elevation hint.
2. Wait a moment — the first run installs the Playwright npm package (no big browser download; we use your real Chrome).
3. **Your Google Chrome will open** and go to instagram.com.
4. If IG loads with your feed → you're good (you're already signed in).
5. If IG shows a login page → sign in normally. The session will be remembered.
6. **Return to the PowerShell window and press Enter** when you see your IG home feed.
7. The script saves the IG session and **automatically uploads it to the VPS**. Done.

When it's done you'll see: `✅ Done. Solomon can now post to Instagram (feed).`

---

### Path B — Manual (if Path A's PowerShell line doesn't work)

1. **Download the capture script:**
   ```powershell
   scp -i C:\Users\Ashle\.ssh\hostinger_solomon root@167.99.237.26:/root/solomon-v4/scripts/capture_ig_pw_auth.js C:\Users\Ashle\Desktop\capture_ig_pw_auth.js
   ```

2. **In a folder, install Playwright** (skip if you already have it from the YouTube setup):
   ```powershell
   cd C:\Users\Ashle\Desktop
   mkdir solomon-pw-auth -Force; cd solomon-pw-auth
   npm init -y
   npm install playwright
   ```

3. **Move the script and run it:**
   ```powershell
   move ..\capture_ig_pw_auth.js .
   node capture_ig_pw_auth.js
   ```

4. **Browser opens** → confirm you see your IG home feed signed in → return to PowerShell and press Enter.

5. **Upload the saved file to the VPS:**
   ```powershell
   scp -i C:\Users\Ashle\.ssh\hostinger_solomon .pw_state_instagram.json root@167.99.237.26:/root/solomon-v4/.pw_state_instagram.json
   ```

Done.

---

## How to know it worked

Once Jed has approved the `post_via_browser` tools.js wiring (separate orchestrator approval), ask Solomon: `post via browser to instagram — caption "test from solomon", image /some/path.jpg`. If the auth session is good and the wiring is approved, Solomon will post and reply with a confirmation + screenshot link.

If you see `AUTH_EXPIRED` in any logs, redo Path A.

## Privacy / safety

- The saved file (`.pw_state_instagram.json`) is your Instagram login cookies. **Never share or commit it.**
- It is gitignored on the VPS (pattern `.pw_state_*.json`).
- File permissions on the VPS are chmod 600 (root-only).
- You can revoke at any time via Instagram → Settings → Login activity → log out of the device.

## When you need to redo this

- If Solomon's Instagram post returns `AUTH_EXPIRED`
- If you've signed out from Instagram everywhere
- If you changed your IG password and got logged out
- If you want Solomon to post from a different IG account (sign into that account in Chrome, then re-run Path A)
