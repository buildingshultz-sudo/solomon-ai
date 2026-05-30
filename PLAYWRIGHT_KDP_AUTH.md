# Playwright Auth Setup — KDP (one-time)

This lets Solomon read your **Amazon KDP** royalty reports every morning so your 6 AM brief shows yesterday's book sales. Amazon doesn't offer a real-time KDP API on your tier — this is the substitute.

You only have to do this **once**, then redo it only if Amazon signs you out (months apart).

---

## What you're doing in one sentence

Sign into kdp.amazon.com **once** in a special browser on your PC, then the saved login is sent to the VPS so Solomon can pull your daily royalty number.

---

## The steps — pick ONE path

### Path A — Easiest (PowerShell, ~3 minutes)

Open **PowerShell** on your Windows PC. Paste this **one line** and hit Enter:

```powershell
scp -i C:\Users\Ashle\.ssh\hostinger_solomon root@167.99.237.26:/root/solomon-v4/scripts/setup-kdp-pw.ps1 $env:TEMP\setup-kdp-pw.ps1; powershell -ExecutionPolicy Bypass -File $env:TEMP\setup-kdp-pw.ps1
```

Then:
1. Wait a moment — first run installs Playwright + Chromium (~250MB, only happens once; reuses the YouTube install if you've already done that).
2. A **Chromium browser window opens** at kdp.amazon.com.
3. **Sign in with the Amazon account** that owns your KDP books. If Amazon asks for a 2FA code, enter it normally.
4. Once you see your KDP **Bookshelf** or **Reports** page logged in, **return to the PowerShell window and press Enter**.
5. The script saves the login session and **automatically uploads it to the VPS**. Done.

When it's done you'll see: `✅ Uploaded .pw_state_kdp.json to VPS — Solomon can now read KDP royalties daily.`

If anything fails, send me the last few lines of the PowerShell output and I'll fix it.

---

### Path B — Manual (if Path A's PowerShell line doesn't work)

1. **Download the capture script:**
   ```powershell
   scp -i C:\Users\Ashle\.ssh\hostinger_solomon root@167.99.237.26:/root/solomon-v4/scripts/capture_kdp_pw_auth.js C:\Users\Ashle\Desktop\capture_kdp_pw_auth.js
   ```

2. **In a folder, install Playwright** (skip if you already have it for the YouTube setup):
   ```powershell
   cd C:\Users\Ashle\Desktop
   mkdir solomon-pw-auth -Force; cd solomon-pw-auth
   npm init -y
   npm install playwright
   npx playwright install chromium
   ```

3. **Move the script and run it:**
   ```powershell
   move ..\capture_kdp_pw_auth.js .
   node capture_kdp_pw_auth.js
   ```

4. **Browser opens** → sign into Amazon for KDP → wait until you see your Bookshelf or Reports → return to PowerShell and press Enter.

5. **Upload the saved file to the VPS:**
   ```powershell
   scp -i C:\Users\Ashle\.ssh\hostinger_solomon .pw_state_kdp.json root@167.99.237.26:/root/solomon-v4/.pw_state_kdp.json
   ```

Done.

---

## How to know it worked

Tomorrow morning's 6 AM brief will include a `📚 KDP yesterday: $X.XX` line instead of `📚 KDP: auth setup pending`. If it stays `pending`, the upload didn't land — rerun Path A.

You can also test on-demand by asking Solomon: "run the KDP royalty check now."

## Privacy / safety

- The saved file (`.pw_state_kdp.json`) is your Amazon login cookies. **Never share or commit it.**
- It is gitignored on the VPS (pattern `.pw_state_*.json`).
- File permissions on the VPS are chmod 600 (root-only).
- You can revoke at any time via Amazon → Login & security → Sign out everywhere.

## When you need to redo this

- If the morning brief starts showing `📚 KDP: auth expired`
- If you changed your Amazon password and got logged out
- If Amazon's 2FA forces a fresh sign-in (rare — Playwright cookies last months)
