# SHULTZ ENTERPRISES — MASTER CONTEXT
### Single source of truth for Jedidiah Shultz & Shultz Enterprises LLC

> PERMANENT living document — **never delete, summarize, or compress it.** Read it in full
> before any task. Sections are only updated/appended. Auto-update triggers append
> timestamped entries under the `<!-- LOG:* -->` markers so nothing is ever lost. `/brief`
> on Telegram returns this whole file. Built from the three Nathan source documents
> (Soul Document, Context Brief, Master Prompt — focus session May 28–29, 2026).
> NOTE: live credentials/passwords are NOT stored here (committed file) — they live in
> `.env` / a password manager and are only referenced by name.

**LAST UPDATED:** 2026-05-29 — repopulated from the three Nathan source documents (Sam) <!-- LASTUPDATED -->

---

## 1. WHO IS JEDIDIAH
- **Name:** Jedidiah Shultz. **Journeyman pipefitter** from **Valparaiso, Indiana**; works a full-time trade job **6 AM–4 PM** daily.
- **Family:** Wife **Tasia** and **three kids aged 5, 3, and 1**. Family presence is the entire point of the operation.
- **The build:** Runs **Shultz Enterprises** as a side operation being built into a full business — on **a borrowed PC** (his buddy's wife Ashley's old Windows 10 Pro machine, `C:\Users\Ashle`) plus a DigitalOcean VPS, building between 4 PM and whenever Tasia needs him to stop.
- **Debt:** ~**$70,000 consumer debt** — a real, active variable in every decision. Active **debt snowball** strategy; every passive revenue stream is a dollar/month attacking it without costing him another hour.
- **Tasia:** The most important person in the operation (no formal role yet). Cautiously bought in — she's seen the time cost of past **failed ventures** and hasn't seen ROI yet. Her buy-in deepens every time he comes home and is **actually present** (phone down). She is the accountability system no software can replace. An Operations Manual (Solomon to maintain) should let her run things if Jed is unavailable.
- **Authentic, not performing.** Blue-collar, faith-oriented, family man, builder. A revolving-door **Thursday-night community** at his house — those people (and others like them) are exactly who he's building for and wants to be generous toward.
- **Mantra:** *"Failure is always an option."* Not recklessness — courage with context; failure is how you learn, success is the byproduct. Removes paralysis so he can move fast.
- **What motivates him day to day:** He's building tired, in debt, on borrowed gear. He doesn't need motivation explained — he needs tools that **respect his time, honor his vision, and make the most of every minute.** The operation must SHRINK demands on his time, not grow them.

## 2. THE TEAM (always use these names — they reduce mistakes when managing from a phone)
- **Nathan** = the Claude **chat** assistant — planning, strategy, walking Jedidiah through things.
- **Sam** = **Claude Code** — the builder: SSH, VPS, code fixes, new features.
- **Solomon** = the **Telegram bot** on the DigitalOcean VPS — 24/7 operator.
- **Cowork** = the **Claude desktop agent** — browser tasks, PC automation, multi-step tasks.
- **Dispatch** = **Cowork's phone interface** — remote control from Jedidiah's iPhone.

## 3. THE STACK
- **Anthropic API** — the brain for everything. **Model: `claude-sonnet-4-6`** (updated from 4-5). Budget **hard stop $100/month**.
- **Claude Max 5x** — $100/mo (iOS sub cancelled; rebill direct at claude.ai **June 27**, saves ~$25/mo).
- **DigitalOcean VPS** — $12/mo, IP **167.99.237.26**, Solomon lives here. SSH key: `C:\Users\Ashle\.ssh\hostinger_solomon`. Project: `/root/solomon-v4/`.
- **PM2 processes:** `solomon-v4` (bot.js), `solomon-scheduler` (scheduler.js), `solomon-dashboard` (dashboard.js).
- **Telegram:** Solomon's Forge bot. **Owner chat ID: 8762434280.**
- **PC relay:** running on Jedidiah's PC (endpoint + secret in `.env` as `PC_RELAY_URL` / `PC_RELAY_SECRET`).
- **Facebook page IDs:** Building Shultz `971242169408770`, Irish Craftsman `1737678489895417`.
- **Connected-service status (as of 2026-05-29):** YouTube OAuth — VALID (uploads; no community-post API). Facebook — Building Shultz WORKING via spare `FACEBOOK_PAGE_TOKEN`; **Irish Craftsman DOWN** (token expired). Instagram — NOT CONNECTED. Gmail IMAP triage — WORKING. Telegram — WORKING. Serper (web search) + BFL/Black Forest Labs (pay-as-you-go images) — in `.env`.
- **CREDENTIALS:** API keys, the PC relay secret, and the INBiz password are **NOT in this committed file** — they live in `.env` / a password manager. (Anthropic key was exposed in chat earlier — **rotate it.**)
<!-- LOG:STACK -->

## 4. BUSINESS DETAILS
- **LLC:** **Shultz Enterprises LLC** — FILED **2026-05-29** (Indiana, INBiz). Confirmation **#6435718975**. Registered agent: Jedidiah Shultz.
- **Address:** 454 Jefferson St, Valparaiso, IN 46385.
- **EIN:** Pending (free at irs.gov/ein; arrives 2–4 weeks).
- **Bank:** **Mercury** business account being set up (use LLC confirmation #; needs EIN to fully activate).
- **Business email:** buildingshultz@gmail.com. Other inboxes: irishcraftsman7@gmail.com, jedidiahshultz3@gmail.com.
- **Website:** buildingshultz.com (domain owned; Squarespace cancelled).
- **Storefronts:** Gumroad `shultzbuilds.gumroad.com`; Merch `buildingshultz.myspreadshop.com`.
- **GitHub:** `buildingshultz-sudo` (repo `solomon-ai`).
- **INBiz Access Indiana login:** buildingshultz@gmail.com (password in password manager — not committed).

## 5. ACTIVE PROJECTS AND STATUS
- **Solomon V4 (the bot)** — LIVE. DONE: relay; stability fixes (50MB log cap, self-patch lockdown, history/web_search fix); model→sonnet-4-6; email triage (IMAP, 5-min); FB comment monitor (5-min suggestions); social cross-posting (`/post`); slash menu (`/status /post /launch /brief /help`); 30-day campaign engine; context.md + this master-context system; scheduledPosts SQL bug fixed. PENDING: Facebook (Irish Craftsman) token; Instagram connect; Playwright browser automation; Solomon/Cowork conflict detection.
- **Building Shultz (YouTube + brand)** — channel ~**1,450 subscribers, 287 videos (96% Shorts)**. Brand = community, projects, personality, story — **NOT an AI/tech channel; keep AI invisible.** Tagline: *Be Inspired. Stay Humble. And Build.*
- **Irish Craftsman** — previous brand; active Facebook page (in Solomon's social monitoring).
- **Book "Motivation for Tough Guys"** — Gumroad LIVE (`/l/ihjobd`); **KDP DRAFT — not published yet** (publish button never clicked).
- **Builder's AI Blueprint** — 7-module curriculum DONE; Gumroad LIVE ($19, `/l/ygmuv`).
- **Merch "Building Shultz Gear"** — LIVE on Spreadshop.
- **30-Day Book & Merch Campaign** — **LAUNCHED** (`/launch` sent; first post fired 6 PM CT 2026-05-29). FB auto-posts 7 AM & 6 PM CT; IG/YT handed to Telegram.
- **IronEdit** — App #1 of the roadmap; AI video-editing desktop app, foundation being built (needs DaVinci Resolve Studio $295).
<!-- LOG:PROJECTS -->

## 6. REVENUE STREAMS
| Stream | Platform | Status | Last known amount |
|---|---|---|---|
| Spreadshirt merch | buildingshultz.myspreadshop.com | LIVE | ~$28/mo |
| Builder's AI Blueprint | Gumroad ($19) | LIVE | 0 sales yet |
| Motivation for Tough Guys | Gumroad | LIVE | 0 sales yet |
| KDP book | Amazon KDP | PENDING (publish tonight) | — |
| Amazon Associates | YouTube descriptions | LIVE | unverified |
| Acme Tools affiliate | YouTube descriptions | LIVE | unverified |
| Stripe | (Manus-connected?) | UNKNOWN — needs audit | unknown |
| YouTube AdSense | YouTube | NOT YET (needs 1,000 subs + 4,000 watch hrs) | — |
| 1Password / NordVPN / DaVinci affiliates | applications | PENDING | — |
- _Revenue notification emails (Gumroad/Stripe/PayPal) auto-append here as detected._
<!-- LOG:REVENUE -->

## 7. SAM TASK QUEUE (Claude Code build priorities)
1. **Context file + /brief** — ✅ DONE (this master-context system; /brief returns it).
2. **Playwright browser automation** — Solomon drives Chrome as if Jed were there (YouTube/Instagram posting without API limits).
3. **Conflict detection** — Solomon checks if Cowork is running before PC actions; queues if busy (never simultaneous).
4. **Instagram Business account link** — once Meta tokens are fixed.
5. **Irish Craftsman Facebook token fix.**
6. **Affiliate application push** — 1Password, NordVPN, DaVinci Resolve (packets in Manus library).
7. **Weekly revenue report** — Solomon sends Monday 6 AM CT P&L to Telegram (Gumroad + Spreadshirt + Amazon Associates).
8. **YouTube milestone monitor** — alerts at 500/750/1,000 subs and 2,000/4,000 watch hours.
9. **Stripe audit** — find and audit the Manus-connected Stripe account.
<!-- LOG:SAMQUEUE -->

## 8. COWORK TASK QUEUE (desktop-agent priorities)
1. Gmail labels & filters setup across all 3 accounts.
2. GitHub, Google Drive, Canva connector setup (may already be running).
3. Affiliate link verification across 30 YouTube videos.
4. Manual posts with no API: Instagram + YouTube community versions Solomon hands back.

## 9. REMAINING TO-DOS REQUIRING JEDIDIAH (only he can do; needs approval)
1. **KDP publish** — kdp.amazon.com → "Motivation for Tough Guys" → Continue Setup (Kindle + Paperback) → Save and Publish.
2. **KDP duplicate** — delete ASIN `CH7JED552C4` (hardcover with no cover).
3. **Facebook tokens** — developers.facebook.com/tools/explorer → regenerate long-lived tokens for Building Shultz + Irish Craftsman → paste to Solomon via Telegram.
4. **Instagram** — link IG Business account to the Building Shultz FB page in Meta Business Suite.
5. **Mercury bank** — mercury.com using LLC confirmation #6435718975 + buildingshultz.com (needs EIN to fully activate).
6. **IRS EIN** — apply free at irs.gov/ein (instant, ~5 min).
7. **Claude iOS rebill (June 27)** — cancel App Store sub, resubscribe at claude.ai ($100/mo, saves ~$25).
8. **Rotate the Anthropic API key** (was exposed in chat) and the GitHub PAT (plaintext in the git remote URL).

## 10. THE 12-APP ROADMAP (build order is NON-NEGOTIABLE — IronEdit first; App #2 can't start until IronEdit V1.0 has ≥1 paying customer)
1. **IronEdit** — AI video-editing desktop app. *(App #1, foundation in progress; needs DaVinci Resolve Studio $295.)*
2. **TradeQuote AI** — voice-first quoting for contractors ($49/mo, TAM $1.7B).
3. **ImmiNav** — AI compliance navigator for immigrant entrepreneurs ($15/mo or $99/filing).
4. **RuralRoute Logistics** — micro-freight matching for rural areas (10–15% fee).
5. **Co-Parent Sync** — financial/scheduling dashboard for divorced parents ($9.99/mo, 15M TAM).
6. **ToolShare Pro** — P2P heavy-equipment rental between contractors (20% fee).
7. **ShiftSwap AI** — shift-swapping for restaurants & retail.
8. **BlueCollar Bookkeeper** — OCR/AI bookkeeping for tradesmen.
9. **PermitPuller** — AI permit research (flagged high-risk by Manus).
10. **Community Grant Navigator** — AI for small communities finding federal grants.
11. **Fleet Predictive Maintenance** — AI maintenance scheduling for contractor fleets.
12. **RoughCut Pro / Builder's AI Blueprint platform** — trades education SaaS.
- _The roadmap is the mission made into software (e.g., ImmiNav helps immigrant business owners; Co-Parent Sync helps broken families) — not just a product portfolio._
- **Solomon phases:** Phase 8 = autonomous app factory (build the 12 apps); Phase 9 = revenue engine (Stripe, landing pages, funnels, ads); Phase 10 = organizational director (multi-agent, hiring, Tasia operations manual).
<!-- LOG:PROJECTS -->

## 11. JEDIDIAH'S VISION AND MISSION
- **The Tuesday vision (his exact answer for 3-year success — not revenue):** *"Less time spent at the computer. Wake up, work out, go to work. Come home and not be distracted by trying to build a solid foundation. Be present in the lives of the people he is blessed to have around him. Watch his kids grow up with complete financial freedom from debt and security for the future. While Tasia and he maintain a simple and humble life to be as giving as they want to be with their time and finances."* Everything else is infrastructure in service of that mission.
- **Mission in one sentence:** Build enough passive income to eliminate the $70k debt, free Jedidiah from financial distraction, and create a life of presence and generosity with his family and community — while helping real people through every product built.
- **What he wants his kids to know:** it was designed to **help people first and bring people together**, while giving the family more time together and securing their future. The overarching goal is being **generous in time, mind, body, spirit, love, and hope** — showing up legitimately for the people put in their path.
- **The three fears:** (1) **getting too big to handle** → answered by multi-agent architecture (Solomon manages more on his behalf, not Jed managing more); (2) **still spending too much time on it even when successful** → personal discipline + Tasia as accountability; "good enough to ship" is a practiced discipline; (3) **not knowing how to manage increased income** → debt snowball, S-Corp election (at threshold), Section 179 vehicle strategy, asset-based lending; Solomon to become a financial dashboard (weekly P&L, quarterly estimates, tax deadlines) to Telegram.
- **The mantra:** *"Failure is always an option"* — failure is how you learn; success is the byproduct.
- **The community:** Thursday nights at his house; a real neighborhood community. The generosity isn't abstract — it's those specific people and others like them.

## 12. KEY RULES NATHAN FOLLOWS
- **Prompt format:** send prompts as **one clean block, no paragraph breaks** — Jed copy-pastes on his iPhone from a job site in ~10 seconds.
- **Approval gates:** **always get explicit approval before any legal, financial, or irreversible action** (KDP/LLC/financial submissions). **Never open a bank account, submit legal docs, or make financial decisions autonomously.**
- **Context:** never make him explain context already in the files; never suggest rebuilding context or retraining; he's a team member who's been here the whole time.
- **The one lens:** filter every decision through — *does this give Jedidiah more time with his family, or less?*
- **/brief is authoritative:** the living context file (this file) maintained on the VPS is more current than uploaded docs — trust it as the current state.
- **Build rules (Sam):** always **show the diff before applying** code changes; back up + `node --check` before restart; restart the PM2 process, confirm `online`, check logs; commit + push meaningful changes; never commit `.env`/secrets; protected core files (`bot.js`, `tools.js`, `scheduler.js`, `memory.js`, `activity-logger.js`) are edited only by a human/Sam, never self-patched.
- **Coordination:** Solomon and Cowork must **never run PC-control tasks simultaneously.** Dispatch handles tasks while Jed is away from the PC; Sam/Code sessions handle tasks needing PC presence.
- **Tone (how Nathan shows up):** not a chatbot — a teammate who read the file, knows the mission, asks good questions, and pushes back when something doesn't serve the Tuesday vision. *Be inspired. Stay humble. And build.*

## 13. CHANGE LOG (append-only — never edited or deleted)
> Every auto-update and major event appends here with a timestamp, tagged by section.
<!-- LOG:GENERAL -->
- [2026-05-29] Fully repopulated from the three Nathan source documents (Soul Document, Context Brief, Master Prompt). Credentials referenced, not committed. (Sam)
- [2026-05-29 12:51 CT] Append-only master-context auto-update system deployed and verified live (Sam).
- [2026-05-29 — initial build] Master context created by Sam (Claude Code).

---
_End of master context. Source file: /root/solomon-v4/shultz_master_context.md — never delete or compress._
