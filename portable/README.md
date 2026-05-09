# Solomon's Forge — Portable

This folder is a **fully built, ready-to-run** copy of Solomon's Forge for
Windows. There is **no compilation, no `npm install`, and no build step**.
You only need Node.js installed on the PC.

## Quick start (60 seconds)

1. Install **Node.js LTS** from <https://nodejs.org/> if you don't have it
   already (just click *Next* through the installer).
2. Open this folder.
3. Double-click **`launch.bat`**.
4. A black window opens and prints something like:

   ```
   On this PC          :  http://localhost:3737/
   On your home Wi-Fi  :  http://192.168.1.42:3737/
   From anywhere       :  (run "Setup Remote Access.bat" first)
   ```

5. Open the local URL in any browser. That's it.

Closing the black window stops the app. Re-run `launch.bat` to start again.

> Your data lives in `.\.solomon-data\data.db` next to `launch.bat`. Back up
> that one file and you have backed up everything: chats, memories, tasks,
> finance entries, scheduled jobs.

## Configure (optional)

Open **`.env`** in Notepad. The most useful settings:

| Key               | What it does                                                    |
|-------------------|-----------------------------------------------------------------|
| `OPENAI_API_KEY`  | Paste your OpenAI key for cloud LLM. Or switch to Ollama below. |
| `MODEL_PROVIDER`  | `openai` (cloud) or `ollama` (free, local — install Ollama too) |
| `PORT`            | Change if 3737 is already used.                                 |
| `OWNER_PASSWORD`  | The password Solomon greets you with.                           |
| `JWT_SECRET`      | Any long random string. Set it once.                            |

Save and re-launch.

## Access from your phone

Solomon's Forge is a **PWA** (Progressive Web App). Once you can reach the
URL on your phone you can install it like a native app — no App Store needed.

### Option A — Same Wi-Fi as the PC (easiest)

1. Make sure your phone is on the **same Wi-Fi** as the PC.
2. On the PC, run `launch.bat` and look for the line:
   `On your home Wi-Fi  :  http://192.168.x.x:3737/`
3. On your phone's browser (Safari on iPhone, Chrome on Android), open
   that URL.
4. Install it as an app:
   - **iPhone (Safari):** tap the Share icon → *Add to Home Screen* →
     *Add*. The Solomon icon appears like any other app.
   - **Android (Chrome):** menu (three dots) → *Install app* (or
     *Add to Home screen*) → *Install*.

### Option B — From anywhere (cellular, hotel Wi-Fi, on the road)

Use **Tailscale**, a free secure VPN that makes your phone behave as if it
were sitting on your home network — even when you're miles away.

1. On the PC, double-click **`Setup Remote Access.bat`** and follow the
   prompts. It installs Tailscale, signs you in, and prints your
   PC's Tailscale IP, e.g. `http://100.64.10.5:3737/`.
2. On your phone, install **Tailscale** from the App Store / Google Play
   and sign in with the **same account**.
3. Open the Tailscale URL printed in step 1 in your phone browser.
4. Add to home screen (same steps as Option A).

The Tailscale connection is end-to-end encrypted; nothing is exposed to the
public internet, no port forwarding, no firewall changes. The PC must be
running `launch.bat` whenever you want to use the app from the phone.

## Optional: Telegram bot

Run **`Setup Telegram Bot.bat`**. It walks you through:

1. Opening BotFather and creating a bot.
2. Pasting the token — it's saved into `.env` automatically.
3. (Optional) locking the bot to your personal chat ID.

Restart Solomon's Forge afterwards. Now you can text the bot from anywhere
and it replies as your AI chief of staff.

## Troubleshooting

- **Browser shows nothing / connection refused** — make sure the black
  `launch.bat` window is still open. Closing it kills the server.
- **Port 3737 already in use** — open `.env`, change `PORT=3737` to e.g.
  `PORT=8080`, save, and run `launch.bat` again.
- **"Node.js was not found"** — install it from <https://nodejs.org/> and
  re-run `launch.bat`.
- **Phone can't reach `http://192.168.x.x:3737/`** — your Windows firewall
  is blocking inbound traffic. Either allow Node.js through Windows
  Defender Firewall (a prompt usually appears the first time) or use
  Tailscale (Option B) which sidesteps the firewall.
- **Want to start over** — close `launch.bat`, delete the `.solomon-data`
  folder, re-launch. A fresh database is created.

## What's inside this folder

```
launch.bat                  ← double-click to start
Setup Telegram Bot.bat      ← create a Telegram bot interactively
Setup Remote Access.bat     ← install Tailscale for phone access
.env                        ← settings (edit in Notepad)
README.md                   ← this file
package.json                ← reference only
dist/                       ← pre-built app (server + web UI)
node_modules/               ← runtime libraries (already installed)
.solomon-data/              ← your database (created on first run)
```

Everything is self-contained. Move this folder anywhere; it stays portable.
