# Solomon V4 — Agent Operating Guide

Personal AI chief-of-staff bot for Jed Shultz (Shultz Enterprises: Building Shultz +
Irish Craftsman). Relays Telegram messages to Claude and back, with PC remote control,
scheduled tasks, and social-media tools. Read this file at the start of every session.

## Server / Access
- VPS: DigitalOcean at `167.99.237.26`, SSH as `root`
- SSH key: `C:\Users\Ashle\.ssh\hostinger_solomon`
- Connect: `ssh -i "C:\Users\Ashle\.ssh\hostinger_solomon" -o StrictHostKeyChecking=no root@167.99.237.26`
- Project dir: `/root/solomon-v4/`
- Git remote: `origin` → `github.com/buildingshultz-sudo/solomon-ai` (master)
- Secrets live in `.env` (gitignored) — never commit it or print token values.

## Process management (PM2)
| PM2 process        | Entry file    | Role                                  |
|--------------------|---------------|---------------------------------------|
| `solomon-v4`       | bot.js        | Telegram bot + core LLM loop          |
| `solomon-scheduler`| scheduler.js  | All cron/interval jobs                |
| `solomon-dashboard`| dashboard.js  | Web dashboard                         |
- Restart after a change: `pm2 restart solomon-v4` (or the relevant process)
- Persist: `pm2 save`
- Always confirm the process returns to `online` and check logs after restarting.

## Approved task list (what Solomon is allowed to do)
1. **Telegram ↔ Claude relay** — core: owner messages relayed to Claude, replies returned.
2. **Facebook comment monitoring** — poll Building Shultz + Irish Craftsman pages for new
   comments; alert the owner on Telegram with a Claude-generated reply suggestion.
3. **Email triage** — monitor inbox, surface important mail to Telegram. (NOTE: blocked —
   EMAIL_* / SMTP_* creds in .env need verifying before this runs.)
4. **Video folder watcher** — watch `D:\RawFootage\Inbox` for new footage (alerts).
5. **6 AM briefing** — morning brief delivered at 6:00 AM CT.
6. **Scheduled social posts** — publish queued Facebook/Instagram posts at their due time.
7. **On-demand PC commands** — pc_execute, pc_screenshot, pc_launch_app, pc_get_windows,
   pc_gui_control via the PC relay.

## Architecture summary
- **bot.js** (~1238 ln) — Telegram handler + `askSolomon()` core LLM loop: prompt caching,
  tool loop (client tools + server web_search via pause_turn), budget tracking, structured
  logging with 50MB cap, hallucination guard, auto-continue.
- **tools.js** (~2701 ln) — all tool definitions + executors: web search, memory, file
  read/write/edit (workshop), PC relay calls, Facebook/Instagram posting, FB comment
  tools (`get_fb_comments`, `reply_fb_comment`), email, etc. Holds the self-patch guard.
- **scheduler.js** (~542 ln) — interval/cron jobs: morning brief, FB comment monitor,
  scheduled social posts, video folder watch, batch polling.
- **memory.js** (~540 ln) — SQLite (`solomon.db`): conversation messages (content stored as
  plain TEXT strings), tasks, budget, lessons, projects, scheduled_posts, native memory.
- **dashboard.js** (~228 ln) — web dashboard (separate PM2 process).
- **pc-relay.js** (~85 ln) — PC relay bridge; the bot reaches the Windows PC for remote
  control via `PC_RELAY_URL` / `PC_RELAY_SECRET`.
- **activity-logger.js** (~188 ln) — live status + activity feed for the dashboard.

## Bugs fixed 2026-05-28 (three stability fixes)
1. **Log cap** (bot.js) — structured/activity logging now capped at **50MB per file** with
   numbered rotation (`solomon-YYYY-MM-DD.log.N`) and 7-day cleanup, so a crash can never
   fill the disk again.
2. **Self-patch lockdown** (tools.js) — core bot files are fully protected: `file_read`,
   `file_write`, and `file_edit` all reject them. Claude may only edit dashboard files.
3. **History accumulation** (bot.js) — `workingHistory` threads the full tool-call chain
   through every API iteration, and `sanitizeMessages()` strips **orphaned
   `web_search_tool_result` blocks** (results whose `server_tool_use` id never appeared),
   which were causing API 400s and crashing turns. Applied to all 5 `messages.create` calls.

## Protected core files — DO NOT self-patch
These files are off-limits to Solomon's own file tools (`file_read`/`file_write`/`file_edit`),
enforced by `CORE_PROTECTED_PATHS` in tools.js:
- `bot.js`
- `tools.js`
- `scheduler.js`
- `memory.js`
- `activity-logger.js`

Only `dashboard.html` and `dashboard.js` may be edited by Solomon. Changes to the protected
core files are made by a human operator (or Sam during a Code session), never by the bot.

## Working agreement
- **Always show changes as a diff before applying them.** Show the diff, then apply.
- Back up a file before editing it on the server, and re-check syntax (`node --check`) before
  restarting.
- After any change: restart the affected PM2 process, confirm it returns to `online`, and
  check logs for errors before considering the task done.
- Commit meaningful changes to git and push to `origin master`; keep `.env` and `*.bak*`
  backups out of the repo.
