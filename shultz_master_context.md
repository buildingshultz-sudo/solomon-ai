# SHULTZ ENTERPRISES — MASTER CONTEXT
### Single source of truth for Jedidiah Shultz & Shultz Enterprises LLC

> PERMANENT living document — **never delete, summarize, or compress it.** Read it in full
> before any task. Sections are only updated/appended. Auto-update triggers append
> timestamped entries under the `<!-- LOG:* -->` markers so nothing is ever lost. `/brief`
> on Telegram returns this whole file. Built from the three Nathan source documents
> (Soul Document, Context Brief, Master Prompt — focus session May 28–29, 2026).
> NOTE: live credentials/passwords are NOT stored here (committed file) — they live in
> `.env` / a password manager and are only referenced by name.

**LAST UPDATED:** 2026-06-04 07:47 CT — [STACK] Agent-routing lessons (locked this session): TWO "Sams" — DESKTOP Claude Code on <!-- LASTUPDATED -->

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
- [2026-06-04 07:47 CT] Agent-routing lessons (locked this session): TWO "Sams" — DESKTOP Claude Code on the PC has the SSH key + local shell, fully capable (SSH to VPS, drive the relay); MOBILE/cloud Code = isolated sandbox, fresh repo clone, NO SSH/PC/VPS reach, cannot run infra tasks. To spawn a capable Sam remotely from the phone, use Dispatch's native start_code_task (spawns a real local_ Code session on the PC) — NOT Caleb typing into Code (Code/terminals are IDE tier-restricted; the paste hangs). Caleb's role = launch + stand down + release the cowork lock; it is NOT a message relay to Sam. Solomon punts run-jobs to the Sam queue when the matching tool isn't loaded in its running process (new tools need deploy + solomon-v4 restart). D: read-only bridge enforcement CONFIRMED in live smoke test (PUT/POST/DELETE on D: footage paths → 405 as designed).
- [2026-06-03 18:42 CT] Nathan MCP usage note: append_master_context (and the other Nathan/Solomon Comms tools) are DEFERRED MCP tools — they do NOT appear in the default tool list and do NOT require a connector reconnect or a fresh chat to use. Load them by calling tool_search (e.g. query "append master context") at the start of any session where Nathan will lock decisions, then call directly. The earlier "switch to a new chat / reconnect the connector" diagnosis was wrong; the write tool was reachable all along via search. Standing rule: Nathan persists confirmed decisions to master context via this tool mid-chat, no manual relay.
- [2026-06-02 15:58 CT] FB token refreshed for irish_craftsman (Irish Craftsman) [auto-exchanged → long-lived]
- [2026-06-02 15:57 CT] FB token refreshed for building_shultz (Building Shultz) [auto-exchanged → long-lived]
- [2026-06-02 15:51 CT] FB token refreshed for building_shultz (Building Shultz)
- [2026-06-02 15:31 CT] FB token refreshed for irish_craftsman (Irish Craftsman)
- [2026-06-02 15:25 CT] FB token refreshed for building_shultz (Building Shultz)
- [2026-06-01 05:37 CT] FB token refreshed for irish_craftsman (Irish Craftsman)
- [2026-06-01 05:36 CT] FB token refreshed for building_shultz (Building Shultz)

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
- **Solomon V4 (the bot)** — LIVE. DONE: relay; stability fixes (50MB log cap, self-patch lockdown, history/web_search fix); model→sonnet-4-6; email triage (IMAP, 5-min); FB comment monitor (5-min suggestions); social cross-posting (`/post`); slash menu (`/status /post /launch /brief /help`); 30-day campaign engine; context.md + this master-context system; scheduledPosts SQL bug fixed; morning scorecard + inline-button approvals; multi-photo album batching; Gumroad webhook; `/generate` (Flux); dispatch system (`/dispatch`, classifier + 28 templates + Nathan bridge, shadow default). PENDING: Facebook (Irish Craftsman) token; Instagram connect; Playwright browser automation; Solomon/Cowork conflict detection; **PC-side Caleb `/caleb-task` endpoint** (unlocks 4 Caleb templates); **auto-dispatch on free text** (Jed-flippable `/dispatch mode live|shadow`).
- **Building Shultz (YouTube + brand)** — channel ~**1,450 subscribers, 287 videos (96% Shorts)**. Brand = community, projects, personality, story — **NOT an AI/tech channel; keep AI invisible.** Tagline: *Be Inspired. Stay Humble. And Build.*
- **Irish Craftsman** — previous brand; active Facebook page (in Solomon's social monitoring).
- **Book "Motivation for Tough Guys"** — Gumroad LIVE (`/l/ihjobd`); **KDP DRAFT — not published yet** (publish button never clicked).
- **Builder's AI Blueprint** — 7-module curriculum DONE; Gumroad LIVE ($19, `/l/ygmuv`).
- **Merch "Building Shultz Gear"** — LIVE on Spreadshop.
- **30-Day Book & Merch Campaign** — **LAUNCHED** (`/launch` sent; first post fired 6 PM CT 2026-05-29). FB auto-posts 7 AM & 6 PM CT; IG/YT handed to Telegram.
- **IronEdit** — App #1 of the roadmap; AI video-editing desktop app, foundation being built (needs DaVinci Resolve Studio $295).
<!-- LOG:PROJECTS -->
- [2026-06-03 21:45 CT] Feature shipped — commit 92104c5: fix(d-bridge): gate watcher on cowork_active only — Caleb stood down, CSV is now an output not a trigger
- [2026-06-03 21:30 CT] Feature shipped — commit 0f88e85: feat(d-bridge): read-only D: drive access via pc-relay + cowork conflict gate
- [2026-06-03 20:45 CT] Feature shipped — commit 9ee605b: docs(master-context): Nathan append [REVENUE]
- [2026-06-03 20:30 CT] Feature shipped — commit 6a5471c: docs(master-context): Nathan append [REVENUE]
- [2026-06-03 18:45 CT] Feature shipped — commit f23455b: docs(master-context): Nathan append [STACK]
- [2026-06-03 18:41 CT] IronEdit (App #1) packaging feature locked (Nathan+Jed): before upload, IronEdit auto-detects the tools used in the footage, pulls their Amazon affiliate links, and injects those plus any other revenue links into the video description prior to the scheduled YouTube auto-post — extending the existing packaging step (thumbnail/title/desc/tags/SEO). Recognizing tools from raw video is the harder AI slice, so it lands as a LATER IronEdit phase, not the V1.0 MVP (V1.0 floor stays: finished cut on desktop ready to upload). The manual affiliate-link fill Solomon is doing now on the top-5 videos is the prototype/dogfood of this feature.
- [2026-06-03 17:15 CT] Feature shipped — commit cd93700: feat(mcp): append-only append_master_context tool for Nathan
- [2026-06-03 CT] PRODUCT & ROADMAP LOCK-IN (Nathan+Jed session) — supersedes the section-10 list where they differ:
  - ROADMAP FIT FILTER (locked): an app earns an active slot ONLY if Jed has lived/understands the problem (mission into software), not opportunity-chasing.
  - App #1 IronEdit (fka RoughCut Pro): AI auto-builds rough cut from raw footage; Jed dogfoods own footage; built on DaVinci Resolve. North star: voice-trigger IP-cam record → auto-ingest → AI edits → packages thumbnail/title/desc/tags/SEO → scheduled YouTube auto-post. V1.0 MVP floor = finished cut on desktop ready to upload; phase the rest. GATED on $295 DaVinci Studio (cash, not credit). This gate holds the whole roadmap.
  - App #2 TradeQuote (name LOCKED; no "AI" in name — AI is the engine, kept invisible; do not rebrand — name the front door not the feature list). Mental-load tool for solo contractors. 4 pillars: (1) voice walkthrough on site → pro quote in the driveway; (2) built-in checklist (permits/disposal/contingency/waste factor) that ELICITS detail, not just transcribes; (3) automated 3-touch follow-up Day 2/5/10 with clean breakup close; (4) quote pipeline pending/approved/dead. Hook "Talk the job. Send the quote." Hero "Done before you leave the driveway." TWO add-on modules folded in: Permit Scout (fka PermitPuller — flags likely permits at quote time, does NOT file) and Paydirt (fka BlueCollar Bookkeeper — snap receipts → AI books actual job costs → answers "did this job make money?" by comparing quote vs actual; organizes/prepares books, does NOT file taxes or give tax advice = CPA's job). Paydirt/Permit Scout are marketing/feature names; in-app labels stay plain so users learn nothing new. BUILD DIRECTIVE: simplest, easiest program to operate + master fast, zero user frustration — hard UX requirement and likely north star for all apps.
  - App #3 ImmiNav (scope LOCKED): business compliance only for immigrant entrepreneurs (LLC/EIN/licenses/permits/tax in plain language). Does NOT touch immigration status (UPL, uninsurable) — routes those to attorneys/accredited nonprofits/USCIS. Informs/organizes, never legal advice; E&O matters most here.
  - App "Lantern" (WORKING NAME, fka Co-Parent Sync): co-parenting app Jed lived. Gap analysis: rivals (OurFamilyWizard, BestInterest, Divvito, TalkingParents) all fight at the MESSAGE/tone level + court records; NOBODY does the DECISION or centers the actual CHILD. WEDGE = neutral "third chair" that facilitates kid-centered DECISIONS + a child-wellbeing/outcomes layer (explicitly NOT a therapist; facilitate only; routes distress/abuse/legal to humans). MOAT: own decision+child+outcomes (rivals anchored to court-records identity); win the professionals (coordinators/GALs/mediators/courts) to beat OFW's court lock-in; plus Jed's authenticity + design-partner family. NAME: space saturated (Lantern, Tandem=OFW's parent co, Polaris, Heartwood, Kinwell, Hearth, Kindred, Common Ground all taken) — defer final name to build time with lawyer trademark + domain clearance. Status: hardest/latest app — DEFINE now, BUILD only if wedge still holds at its turn.
  - ToolShare Pro (KEEP): P2P marketplace — contractors rent out idle equipment, Shultz takes a fee. Liability: pushing liability to owner+renter via ToS is the aim but ToS is NOT a shield (plaintiffs sue the platform; heavy equipment = catastrophic) — lawyer-drafted ToS + required proof-of-insurance + deposits + a real lawyer mandatory pre-launch; E&O won't cover physical injury. S&H angle: Jed already holds the S&H Rentals LLC (no fleet capital); ToolShare is software so needs none — could activate S&H Rentals capital-light AND run through the S&H LLC to isolate equipment liability from Shultz Enterprises + Jed personally (confirm with lawyer/accountant).
  - ShiftSwap AI: UNDER REVIEW / PARKED — market saturated (Shyft is a near-identical dedicated shift-swap marketplace; swapping is table-stakes in 7shifts/When I Work/Deputy/HotSchedules; Shiftn already does AI coverage), two-sided + heavy B2B adoption friction, bumps the fit-filter (lived but already-solved market). Decision deferred pending a lived wedge from Jed (cross-employer coverage? worker-first fairness? tiny-shop simplicity?); if none surfaces, move to back-burner.
  - CUT: RuralRoute Logistics (no lived fit; hardest model + heaviest liability).
  - FOLDED into TradeQuote: PermitPuller → Permit Scout; BlueCollar Bookkeeper → Paydirt.
  - BACK-BURNER: Community Grant Navigator.
  - ACTIVE KEEP list (build ONE at a time per build order): IronEdit, TradeQuote, ImmiNav, ToolShare Pro, Builder's AI Blueprint platform, Lantern/co-parenting, ShiftSwap (under review), Fleet Predictive Maintenance.
  - E&O INSURANCE: Hiscox Tech E&O + General Liability bundle (~$57/mo) — circle back before any app/consulting takes paying customers.
  - ASSET-PROTECTION / ENTITY ISOLATION: higher-risk apps each get their OWN standalone LLC (e.g. Wyoming) to wall off liability; higher-risk = Lantern/co-parenting and ToolShare Pro (route ToolShare via the existing S&H Rentals LLC). NOT a substitute for ToS + insurance + E&O (belt AND suspenders). Structure with lawyer/accountant before paying customers.
  - REVENUE PRIORITY (locked): hold apps from market until ready + E&O-backed + revenue covers business expenses — do NOT rush an app out to fund the $295 IronEdit gap; build-order holds. FIRST push = monetize existing traffic, zero liability: (1) add Amazon store ID buildingshu0e-20 to top 5 videos (230k+ views, currently un-monetized); (2) once EIN is in hand, submit affiliate apps (1Password/NordVPN/DaVinci/Amazon); (3) diagnose book + Blueprint at 0 sales. Keep defining apps (free) meanwhile.
  - NATHAN WORKING-STYLE: Jed wants MAX thoroughness — front-load depth, lock decisions in one pass, avoid back-and-forth; latency from research/long replies is acceptable, do NOT trim depth for speed. Workday ~6am–4pm = low-stress phone brainstorming/Q&A + quick dispatch prompts; reserve heavy PC/keyboard work for build windows (4–6am, 4–6pm).
- [2026-06-02 16:30 CT] Feature shipped — commit 82449d6: feat(scheduler): VPS date-gated FB data-access reminder for 2026-08-24
- [2026-06-02 16:15 CT] Feature shipped — commit 12bc8ba: fix(fb): treat permanent tokens (expires_at===0) as never-expiring
- [2026-06-02 13:00 CT] Feature shipped — commit 0638b6b: feat(fb): weekly token expiry monitor with 14d + 7d Telegram alerts
- [2026-06-02 12:30 CT] Feature shipped — commit 53c98f9: fix(manus-catalog): use items: not rows: for briefToPdf table sections
- [2026-06-02 12:15 CT] Feature shipped — commit 4860e7f: fix(facebook): use Graph API page-access check instead of token-owner-ID match for Irish Craftsman/Building Shultz validation
- [2026-06-02 11:30 CT] Feature shipped — commit 7979b7c: feat(document-registry): index reports/ docs, weekly scan + search_documents tool
- [2026-06-02 07:45 CT] Feature shipped — commit 3c277f4: feat(campaign): skip-topic filter + /campaign skip|unskip commands
- [2026-06-02 06:30 CT] Feature shipped — commit 8427542: feat(caleb-runner): Playwright executor + Canva auth + synthetic smoke + security doc
- [2026-06-01 19:45 CT] Feature shipped — commit f3cd3bb: feat(T0-G): caleb_dispatch + caleb_queue_status tools, HMAC opt-in on relay, queue-path swap, offline monitor, Drive backup stub
- [2026-06-01 19:30 CT] Feature shipped — commit 2cf1d6c: feat(T0-C): post-purchase email drip (4-step sequence, preview-gated)
- [2026-06-01 19:00 CT] Feature shipped — commit 86faf37: feat: phase 8 v2 — Claude-picked autonomous priority queue with confidence ladder + IronEdit V1 gate
- [2026-06-01 12:15 CT] Feature shipped — commit 1f4ba83: feat(pc-relay): add GET /file + GET /file/list for D:\ drive bridge
- [2026-06-01 11:30 CT] Feature shipped — commit 5473c20: feat(yt-affiliate): shorts filter + duration classifier + scope db ref
- [2026-06-01 11:00 CT] Feature shipped — commit 3f3c6e2: feat(tools): add youtube_affiliate_audit_and_fill (dry-run default)
- [2026-06-01 08:00 CT] Feature shipped — commit 991735b: feat(mcp): add OAuth 2.0 wrapper so claude.ai connector UI completes the handshake
- [2026-06-01 06:15 CT] Feature shipped — commit 3a88bda: feat: nginx reverse proxy + cert-ready setup for MCP HTTPS
- [2026-06-01 05:15 CT] Feature shipped — commit ff3df4c: feat(jed_tasks): SQLite-backed action queue, add_jed_task tool, done-detect, /tasks, brief prepend
- [2026-06-01 05:00 CT] Feature shipped — commit 1b9765d: playwright capture: auto-kill Chrome, no prompt
- [2026-05-31 20:15 CT] Feature shipped — commit 27c05a1: feat: remote MCP server (port 3001) for Nathan integration
- [2026-05-31 18:15 CT] Feature shipped — commit c6cbc5a: feat(tools): route post_via_browser to browser-poster module
- [2026-05-31 17:15 CT] Feature shipped — commit 9cd110f: feat: add browser-poster module + IG playwright auth scaffold
- [2026-05-31 17:00 CT] Feature shipped — commit 7dc4ba8: send_email: SMTP-first + Gmail API fallback + multipart HTML + cc/bcc/reply_to + sensitive guard + dispatch template
- [2026-05-31 16:15 CT] Feature shipped — commit ca86043: klein-newsletter-watcher: auto-click hidden reward links in Klein Tools Tradesman Club emails
- [2026-05-31 13:00 CT] Feature shipped — commit bc26244: scheduler: terse 3-5 line morning + new evening summary + autonomous priority cron
- [2026-05-31 11:30 CT] Feature shipped — commit 3daf0d4: Solomon improvements: reply cache + tighter dispatch classifier + /stats command
- [2026-05-30 17:30 CT] Feature shipped — commit b776d1d: PDF pipeline: briefToPdf helper + generate_pdf_report + employee_stack_audit tools
- [2026-05-30 16:00 CT] Feature shipped — commit 11555be: YT Playwright: reuse user real Chrome + Default profile (no login UI)
- [2026-05-30 15:45 CT] Feature shipped — commit cde4bc2: gitignore: dispatch-live-smoke-results.json (runtime test artifact)
- [2026-05-30 14:30 CT] Feature shipped — commit 6a2ebe9: feat(dispatch): invisible auto-dispatch on free text + master context update
- [2026-05-30] PENDING (Sam, in progress): PC-side Caleb `/caleb-task` endpoint (unlocks affiliate_link_verify, gmail_labels_setup, mercury_upload, kdp_upload); auto-dispatch on free text with Jed-flippable `/dispatch mode live|shadow` toggle.
- [2026-05-30 14:00 CT] Feature shipped — commit 61e8d15: Dispatch system: templates + Nathan bridge + classifier (opt-in via /dispatch)
- [2026-05-30 13:15 CT] Feature shipped — commit 8784e34: Morning scorecard, FB approval buttons, campaign preview, KDP scrape, weekly repurpose
- [2026-05-30 12:00 CT] Feature shipped — commit 260b6dd: OAuth brand-channel fix, Gumroad webhook, /generate (BFL), Playwright setup
- [2026-05-30 10:45 CT] Feature shipped — commit 5e520aa: Multi-photo album batching + sharp resize + 429 retry
- [2026-05-29 17:15 CT] Feature shipped — commit 49712bf: T6 — /setfbtoken receiver for FB page token rotation
- [2026-05-29 17:00 CT] Feature shipped — commit 09ff196: T3 — Weekly revenue report (Mon 6 AM CT, Gumroad/Spreadshirt/Amazon)
- [2026-05-29 14:45 CT] Feature shipped — commit 79bc40e: CLAUDE.md: add FULL CONTEXT section; fully populate master context from Nathan docs

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
| Motivation for Tough Guys — audiobook | TBD (Gumroad / Audible) | PLANNED — not recorded yet | — |
- _Revenue notification emails (Gumroad/Stripe/PayPal) auto-append here as detected._
<!-- LOG:REVENUE -->
- [2026-06-03 20:33 CT] Revenue map REFINED via Q&A (6/3). Jed wants NO client-facing work (passive/system-run only) → DROP service/agency, B2B consulting, recruiting. Has all 4 assets + some capital; time = windows + some weekend. NEW passive idle-asset plays: (A) License the D: footage library to AI training-data marketplaces (Troveo/Versos; ~$1-4/min; real-world trades/hands/tools footage in high demand for world-model/robotics; agencies handle deals = passive; one-time organize + rights-clear via Solomon/Caleb; CAVEAT footage with faces needs signed releases). (B) Sell build plans/cut lists as digital downloads (build skills + footage = build-once products; footage = free marketing). Network reframed = distribution/credibility amplifier, NOT a sales target. CAPITAL steer: best guaranteed return = pay down ~20% debt; otherwise only cheap build-once inputs (DaVinci $295, domains), not speculation. First moves: confirm YT monetization + Shopping; start footage pipeline; convert 2-3 builds to plans.
- [2026-06-03 20:22 CT] Revenue map (Nathan+Jed 6/3, beyond affiliate). Principle: AI removes labor from value you already have — lead with unfair advantages: niche trades audience, trades credibility, Solomon engine, built products. TIER 1 (found money, ~0 added time): YouTube monetization (past 1k subs; entry tier ~3M Shorts views/90d unlocks YouTube Shopping to tag own book/merch in 230k-view videos; full ad-rev needs 10M Shorts views/90d, steep — Solomon pull real 90d stats) + fix book/Blueprint funnel (0 sales = plumbing). TIER 2 (audience, low time): niche newsletter sponsorships; AI-built digital products/templates/KDP. TIER 3 (real cash, costs TIME): done-for-you social + lead-followup for trades businesses ($600-2500/mo, Solomon delivers, AI invisible, needs contract + E&O); Blueprint sold B2B. REC: ride Tier 1+2 (Tuesday-vision safe) to cover burn + dent debt; Tier 3 only as deliberate time-for-money choice. CAUTION: YT/Amazon crack down on inauthentic AI spam.
- [2026-06-03 17:35 CT] Revenue/billing email from Soundstripe Team: "Your social post just became a commercial. Now what? 📲"
- [2026-06-03 16:35 CT] Revenue/billing email from Google Play: "Your Google Play Order Receipt from Jun 3, 2026"
- [2026-06-02 21:25 CT] Revenue/billing email from OpenAI: "OpenAI API Invoice 4PUTIXIO-0012"
- [2026-06-01 24:50 CT] Revenue/billing email from DigitalOcean Support: "[DigitalOcean] Your 2026-05 invoice is available"

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
10. **PC-side Caleb endpoint** — IN PROGRESS 2026-05-30: build `/caleb-task` on the PC relay so Solomon-dispatched Caleb payloads execute; unlocks 4 Caleb templates (affiliate_link_verify, gmail_labels_setup, mercury_upload, kdp_upload).
11. **Auto-dispatch on free text** — IN PROGRESS 2026-05-30: route any non-slash Telegram message through the dispatch classifier automatically; Jed-flippable `/dispatch mode live` / `/dispatch mode shadow`.
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
9. **YouTube OAuth test user (QUICK — unblocks Error 403):** Google Cloud Console → APIs & Services → OAuth consent screen → Test users → + ADD USERS → add `irishcraftsman7@gmail.com` (app is in "Testing" status). Clears the YouTube OAuth Error 403 access_denied. Full numbered steps in runbook `YouTube_OAuth_TestUser_and_BrandTransfer_Runbook.md`.
10. **Transfer "Building Shultz" YouTube channel ownership (CAREFUL — Jedidiah-only):** Move Brand Account primary ownership `irishcraftsman7@gmail.com` → `buildingshultz@gmail.com` (invite → Manager → Owner → Make primary owner; ~7-day Google hold period). **Solomon's YT OAuth refresh token will likely need re-auth via `/oauth/start` after the move.** Sam/Solomon must NOT execute this — documented steps only in the same runbook.

## 10. THE 12-APP ROADMAP (build order is NON-NEGOTIABLE — IronEdit first; App #2 can't start until IronEdit V1.0 has ≥1 paying customer)
1. **IronEdit** *(formerly RoughCut Pro)* — AI video-editing desktop app. *(App #1, foundation in progress; needs DaVinci Resolve Studio $295.)*
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
12. **Builder's AI Blueprint platform** — trades education SaaS. *(RoughCut Pro consolidated into App #1 — IronEdit — they are the same product under different working names.)*
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
- [2026-06-04 05:00 CT] Daily 5 AM check-in — context refreshed; Solomon online.
- [2026-06-03 17:10 CT] append_master_context MCP tool deployed + verified live via end-to-end test (rejection paths + happy path). (Sam)
- [2026-06-03 CT] Product & roadmap lock-in appended under LOG:PROJECTS (TradeQuote modules Paydirt+Permit Scout, ToolShare/S&H, Lantern wedge+moat, ShiftSwap parked, RuralRoute cut, fit-filter, asset-protection, revenue priority). (Sam)
- [2026-06-03 05:00 CT] Daily 5 AM check-in — context refreshed; Solomon online.
- [2026-06-02 05:00 CT] Daily 5 AM check-in — context refreshed; Solomon online.
- [2026-06-01 05:00 CT] Daily 5 AM check-in — context refreshed; Solomon online.
- [2026-05-31 05:00 CT] Daily 5 AM check-in — context refreshed; Solomon online.
- [2026-05-30 19:00 CT] YT milestone crossed: 1,000 subscribers
- [2026-05-30 19:00 CT] YT milestone crossed: 750 subscribers
- [2026-05-30 19:00 CT] YT milestone crossed: 500 subscribers
- [2026-05-30] Queued two new pending Sam tasks (section 7 #10/#11): PC-side Caleb `/caleb-task` endpoint and auto-dispatch on free text. Master context pushed to VPS. (Sam)
- [2026-05-30 CT] Documented two pending Jedidiah-only YouTube tasks (section 9 #9/#10): (a) add irishcraftsman7@gmail.com as OAuth test user to clear Error 403 access_denied; (b) transfer Building Shultz Brand Account ownership irishcraftsman7→buildingshultz. Runbook: YouTube_OAuth_TestUser_and_BrandTransfer_Runbook.md. Transfer is doc-only, NOT executed (Sam).
- [2026-05-30 05:00 CT] Daily 5 AM check-in — context refreshed; Solomon online.
- [2026-05-29] Fully repopulated from the three Nathan source documents (Soul Document, Context Brief, Master Prompt). Credentials referenced, not committed. (Sam)
- [2026-05-29 12:51 CT] Append-only master-context auto-update system deployed and verified live (Sam).
- [2026-05-29 — initial build] Master context created by Sam (Claude Code).

---
_End of master context. Source file: /root/solomon-v4/shultz_master_context.md — never delete or compress._
