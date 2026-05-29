# SHULTZ ENTERPRISES — MASTER CONTEXT
### Single source of truth for Jedidiah Shultz & Shultz Enterprises

> This is a PERMANENT living document. Sections are never deleted — only updated and
> appended to. Auto-update triggers append timestamped entries under the `<!-- LOG:* -->`
> markers so nothing is ever lost. `/brief` on Telegram returns this whole file.

**LAST UPDATED:** 2026-05-29 12:51 CT — [GENERAL] Append-only master-context auto-update system deployed and verified live (Sam). <!-- LASTUPDATED -->

---

## 1. WHO IS JEDIDIAH
- **Name:** Jedidiah Shultz. Goes by Jed.
- **Trade:** Journeyman pipefitter from Indiana — a real tradesman (welding, fabrication,
  woodworking, finish carpentry). Hands-on builder, *not* a "tech guy" by background.
- **Business owner:** Runs Shultz Enterprises — the brands **Building Shultz** and
  **Irish Craftsman**.
- **Family:** Married; has kids. Family is the core motivation behind everything. Wants to
  be present — protect weekends and dinners, not lose his life to paperwork.
- **Mission (personal):** Use AI as a "digital apprentice" to get his time back from the
  business side (estimates, scheduling, admin, marketing) so he can be in the shop and
  with his family — and help thousands of other tradesmen do the same.
- **Values:** Direct, practical, no fluff, grounded in real jobsite experience. Faith-
  oriented. Signature: **"Be Inspired, Stay Humble, and Build."** Also: "Protect what
  you've been given," "Things that last take time," "Nobody cares. Figure it out."
- **Fears:** Burnout; the business eating his life; losing time with his wife and kids;
  working himself to the bone while the admin side drowns him (the exact pain his book
  "Motivation for Tough Guys" addresses).
- _Gaps to confirm with Jed: exact ages/names of family, hometown specifics, faith details._

## 2. THE TEAM
- **Nathan** = the Claude **chat** assistant (claude.ai / Claude app). Strategy, planning,
  drafting. Reads this file (via `/brief`) to get full context instantly.
- **Sam** = **Claude Code** (this agent). Builds + maintains Solomon and the infrastructure
  on the VPS. Edits protected core files; commits to GitHub. Operates from a Windows PC,
  SSH'ing into the VPS.
- **Solomon** = the **Telegram bot** on the VPS (the always-on chief-of-staff). Relays
  messages to Claude, runs scheduled jobs, posts socials, triages email, owns this file.
- **Cowork** = the **desktop agent** (runs on Jed's PC for local/desktop tasks).
- **Dispatch** = the **phone interface for Cowork** (mobile control surface).

## 3. THE STACK
- **VPS:** DigitalOcean, `167.99.237.26`, SSH as `root` (key `C:\Users\Ashle\.ssh\hostinger_solomon`).
- **Project dir:** `/root/solomon-v4/`  |  **GitHub:** `github.com/buildingshultz-sudo/solomon-ai` (master).
- **Runtime:** Node.js, PM2, better-sqlite3 (`solomon.db`). Model: `claude-sonnet-4-5`.
- **PM2 processes:** `solomon-v4` (bot.js), `solomon-scheduler` (scheduler.js), `solomon-dashboard` (dashboard.js).
- **API keys (references only — values live in gitignored `.env`, never printed/committed):**
  ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN, OWNER_CHAT_ID, SMTP_USER/SMTP_PASS (Gmail app pw),
  FB_BUILDING_SHULTZ_TOKEN/_ID, FB_IRISH_CRAFTSMAN_TOKEN/_ID, FACEBOOK_PAGE_TOKEN,
  YOUTUBE_CLIENT_ID/SECRET/REDIRECT_URI/REFRESH_TOKEN, SERPER_API_KEY, ELEVENLABS_API_KEY,
  BFL_API_KEY, PC_RELAY_URL/SECRET, DASHBOARD_PASSWORD/PORT, MONTHLY_BUDGET_ALERT/HARD_STOP,
  EMAIL_* (PLACEHOLDER — Gmail uses SMTP_* instead).
- **Connected services & status (as of 2026-05-29):**
  - Telegram bot — WORKING.
  - Gmail (buildingshultz@gmail.com) — IMAP triage WORKING (SMTP app password). Gmail MCP
    connector reaches buildingshultz only (not irishcraftsman7 / jedidiahshultz3).
  - YouTube OAuth (Building Shultz channel) — VALID (upload + gmail.send). NO community-post API.
  - Facebook — Building Shultz: WORKING via FACEBOOK_PAGE_TOKEN (spare). Irish Craftsman:
    DOWN (FB_IRISH_CRAFTSMAN_TOKEN expired 2026-05-24).
  - Instagram — NOT CONNECTED (no Business account linked to the page).
  - PC relay (Windows PC) — via PC_RELAY_URL/SECRET; status varies (check `/status`).
- **AI budget:** monthly cap via MONTHLY_BUDGET_HARD_STOP (last seen ~$11 / $100 MTD).
<!-- LOG:STACK -->

## 4. BUSINESS DETAILS
- **Entity:** Shultz Enterprises. Brands: **Building Shultz**, **Irish Craftsman**.
- **Emails:** buildingshultz@gmail.com (primary), irishcraftsman7@gmail.com, jedidiahshultz3@gmail.com.
- **Accounts/platforms:** GitHub (buildingshultz-sudo), Amazon KDP + Gumroad (book),
  Printful / Spreadshop (merch), beehiiv (The WRENCH newsletter), YouTube (Building Shultz),
  Facebook Pages (Building Shultz, Irish Craftsman), TikTok Shop, Pinterest, LinkedIn,
  Canva, Squarespace.
- **LLC / legal:** UNCONFIRMED — needs Jed to confirm legal entity name(s), EIN, state of
  formation, registered address.
- **Addresses / phone:** UNCONFIRMED — needs Jed.
- _Gaps to confirm with Jed: LLC name(s), business address, payment/bank accounts, EIN._
<!-- LOG:STACK -->

## 5. ACTIVE PROJECTS AND STATUS
- **Solomon V4 (the bot)** — LIVE. Done: Telegram↔Claude relay; 50MB log cap; self-patch
  lockdown; history/web_search fix; FB comment monitor (5-min suggestion alerts); IMAP email
  triage; social cross-posting (`/post`); slash menu (`/status /post /launch /brief /help`);
  30-day book+merch campaign engine; live `context.md` brief; scheduledPosts SQL bug fixed.
  Pending: Facebook (Irish Craftsman) token refresh; Instagram connection; IronEdit fix.
- **Builder's AI Blueprint** — 7-module curriculum scaffold DONE (`builders_ai_blueprint_curriculum.md`).
  Pending: produce the actual video lessons + worksheets.
- **30-Day Book & Merch Campaign** — engine built; armed via `/launch` (see Active Campaigns
  in `/status`). Pending: confirm armed/disarmed state with Jed.
- **RoughCut Pro** — $59 one-time AI video-editing tool. Status: launch phase.
- **IronEdit** — video pipeline; KNOWN ISSUE: produces no finished video output — needs
  investigation/fix.
- **Book "Motivation for Tough Guys"** — published (digital + hardback planner + audiobook).
- **Merch "Building Shultz Gear"** — live (Printful/Spreadshop).
- **The WRENCH newsletter** — active (beehiiv).
<!-- LOG:PROJECTS -->

## 6. REVENUE STREAMS
| Stream | Platform | Status | Last known amount |
|---|---|---|---|
| Book "Motivation for Tough Guys" | KDP / Gumroad | Published, promoting | Not tracked |
| Merch "Building Shultz Gear" | Printful / Spreadshop | Live | Not tracked |
| RoughCut Pro ($59 one-time) | Gumroad/own store | Launch phase | Not tracked |
| YouTube (Building Shultz) | YouTube | Early (~0 subs, 1 video) | Not tracked |
| The WRENCH newsletter | beehiiv | Active | Not tracked |
| Trade services | Building Shultz / Irish Craftsman | Ongoing | Not tracked |
- _Amounts/MRR not yet wired into Solomon. Revenue notification emails (Gumroad, Stripe,
  PayPal) auto-append here as they're detected._
<!-- LOG:REVENUE -->

## 7. SAM TASK QUEUE (Claude Code build priorities)
1. **Facebook reauth** — refresh Irish Craftsman page token (Meta Business Suite) OR add a
   Meta App ID/secret so Sam can wire a one-click `/fb/oauth` flow. (Irish Craftsman posting
   is DOWN.)
2. **Instagram connection** — link a Business account to the FB page, then enable IG auto-post
   (needs image + `instagram_content_publish`).
3. **IronEdit pipeline** — investigate why it produces no finished video output; fix.
4. **12-App Roadmap** — build out the remaining apps (see section 10; list needs Jed).
5. **Refresh CLAUDE.md** — stale items: scheduledPosts SQL bug is FIXED (commit d2c785c);
   "6 AM briefing" is now `/brief` reading context files.
6. **Revenue tracking** — wire Gumroad/Stripe so revenue amounts populate section 6.
<!-- LOG:SAMQUEUE -->

## 8. COWORK TASK QUEUE (desktop-agent priorities)
1. Manual social posting that has no API: Instagram posts + YouTube community posts handed
   back by Solomon (until IG/YT auto-post is available).
2. Desktop/local tasks on Jed's PC (file org, footage handling in `D:\RawFootage\Inbox`).
- _To be populated with Jed — Cowork-specific tasks weren't enumerated in session history._

## 9. REMAINING TO-DOS REQUIRING JEDIDIAH (only he can do)
1. **Facebook reauth** — reply to Solomon's Telegram: create a Meta app OR regenerate
   long-lived Page tokens in Meta Business Suite.
2. **Instagram** — convert/link a Business/Creator IG account to the FB page.
3. **Confirm business details** — LLC name(s), EIN, address, bank/payment accounts (section 4).
4. **Rotate GitHub token** — the PAT is stored in plaintext in the git remote URL; rotate it.
5. **Provide revenue figures** — so section 6 reflects real numbers.
6. **Enumerate the 12 apps** — confirm the full 12-App Roadmap (section 10).
7. **Confirm the 30-day campaign** should be armed (it auto-posts to FB at 7 AM & 6 PM CT).

## 10. THE 12-APP ROADMAP
Status of the 12 apps Jed plans to build (the "App Factory"). Known so far:
1. **Solomon V4** — LIVE (Telegram chief-of-staff bot).
2. **RoughCut Pro** — launch phase (AI video editing).
3. **IronEdit** — in progress (video pipeline; output bug).
4. **Builder's AI Blueprint** — curriculum scaffolded (course product).
5–12. **TO BE ENUMERATED by Jed** — the remaining apps weren't specified in session history.
- _Action: Jed to list all 12 apps + desired order so Sam can track each one's status here._
<!-- LOG:PROJECTS -->

## 11. JEDIDIAH'S VISION AND MISSION
- **The Tuesday vision:** _(Jed's exact words needed.)_ Inferred from his work: an ordinary
  Tuesday where the business runs smoothly with AI handling the admin, so Jed is in the shop
  building and home for dinner — freedom on a normal weekday, not just someday.
- **What he wants the kids to know:** Hard work and craftsmanship matter; stay humble;
  protect what you've been given (family, faith, name); things that last take time; take
  ownership ("nobody cares, figure it out"). Build a legacy worth inheriting.
- **The generosity mission:** Give thousands of tradesmen, contractors, and makers their
  time back using AI as a "digital apprentice" — the same freedom Jed found. Teach it plainly
  (the Builder's AI Blueprint) with no fluff and no gatekeeping.
- **The fears (what drives the urgency):** Burning out; the business consuming his life;
  losing weekends and presence with his family; working hard just to break even.
- _Gaps to confirm with Jed: the exact Tuesday-vision wording, specific generosity goals
  (numbers/causes), faith specifics._

## 12. KEY RULES NATHAN FOLLOWS
**Prompt format (how Nathan briefs Sam / Claude Code):**
- Lead with the single goal, then ordered steps; name exact files/paths; specify the order.
- Always require: "show the diff before applying," restart + verify, commit + push.
- Ask for a Dispatch update after each component completes.

**Approval / safety requirements:**
- **Always show changes as a diff before applying.** Show, then apply.
- Back up a file before editing on the server; `node --check` before restart; after a change
  restart the PM2 process, confirm `online`, check logs.
- **Get explicit approval before destructive/irreversible actions** (bulk email delete,
  force-push, data loss). Count first, approve, then act.
- Never auto-post to live public pages as a "test."
- Never commit `.env` or secrets; keep `*.bak*` out of the repo.

**What Solomon (the bot) can/can't do autonomously:**
- CAN: relay to Claude, monitor FB comments (suggest replies, no auto-post), triage email,
  cross-post on command, run scheduled campaign posts, run PC relay commands, update this file.
- CANNOT self-patch the protected core files (`bot.js`, `tools.js`, `scheduler.js`,
  `memory.js`, `activity-logger.js`) — only `dashboard.html`/`dashboard.js`. Core changes are
  made by a human operator or Sam during a Code session.

## 13. CHANGE LOG (append-only — never edited or deleted)
> Every auto-update and major event appends here with a timestamp. Tagged by section.
<!-- LOG:GENERAL -->
- [2026-05-29 12:51 CT] Append-only master-context auto-update system deployed and verified live (Sam).
- [2026-05-29 — initial build] Master context created by Sam (Claude Code).

---
_End of master context. Source file: /root/solomon-v4/shultz_master_context.md_
