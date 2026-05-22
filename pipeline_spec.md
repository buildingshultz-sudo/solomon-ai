# Raw Footage → YouTube Pipeline Specification

**Version:** 1.0  
**Date:** May 22, 2026  
**Owner:** Solomon (Chief of Staff for Jedidiah Shultz / Building Shultz)  
**Priority:** #1 — Everything else is secondary to this pipeline working end-to-end.

---

## Goal

Jed drops raw footage → Solomon handles everything → a scheduled, SEO-optimized YouTube video goes live with ZERO additional input from Jed.

---

## Pipeline Steps

### Step 1: Raw Footage Ingestion
**Trigger:** Jed signals Sol (via Telegram message: "new footage ready") or PC Agent detects new files.

| Item | Detail |
|------|--------|
| Source | External drive connected to Jed's Windows PC (likely D: drive or USB) |
| Formats | .mp4, .mov, .mkv (from camera/phone) |
| Detection | PC Agent monitors a designated folder (e.g., `D:\RawFootage\Inbox\`) |
| Action | Copy files to working directory, log metadata (duration, resolution, date) |

**Current Status:** PC Agent can execute PowerShell commands and detect files.  
**Needs:** Folder watch script on PC Agent, or manual trigger via Telegram.

---

### Step 2: PC Agent Loads Footage into Editor
**Editor Options:** DaVinci Resolve (free, professional) or Filmora (simpler, paid)

| Item | Detail |
|------|--------|
| Primary | DaVinci Resolve (free tier is sufficient) |
| Fallback | Filmora (if already installed and preferred) |
| Action | PC Agent opens editor, creates new project, imports footage |
| Automation | Via keyboard shortcuts + window detection (AutoHotKey or direct scripting) |

**Current Status:** PC Agent can open Chrome and execute commands. Editor automation NOT yet built.  
**Needs:** 
- DaVinci Resolve installed on Jed's PC
- Editor automation module (keyboard macro sequences for import, timeline, export)
- OR: Use FFmpeg for basic cuts (no GUI needed) — simpler but less flexible

---

### Step 3: AI-Generated Edit Decisions
**Purpose:** Analyze raw footage and produce an edit decision list (EDL).

| Item | Detail |
|------|--------|
| Input | Raw footage file(s) |
| Analysis | Scene detection, silence removal, highlight identification |
| Output | Edit Decision List (timestamps for cuts, transitions, music cues) |
| Tools | FFmpeg (scene detect), Whisper (transcription for content-aware cuts), GPT (narrative structure) |

**Current Status:** OpenAI Whisper available via API. FFmpeg can be installed on PC.  
**Needs:**
- FFmpeg installed on Jed's PC (or use VPS for analysis if files are small enough)
- Scene detection script (FFmpeg `select='gt(scene,0.3)'`)
- Whisper transcription → GPT analysis → EDL generation
- Music suggestion engine (royalty-free library or AI-generated)

---

### Step 4: Execute Edits
**Two paths available:**

#### Path A: Automated (FFmpeg-based, no GUI)
- Use FFmpeg to execute cuts, add transitions, overlay music
- Best for: simple vlogs, talking-head videos, compilation content
- Limitation: No complex effects, color grading, or motion graphics

#### Path B: Semi-Automated (DaVinci Resolve via PC Agent)
- PC Agent drives DaVinci Resolve using keyboard macros
- Load EDL, apply cuts, add transitions, export
- Best for: polished content requiring color grading or effects
- Limitation: Requires PC Agent to be online and DaVinci open

| Item | Detail |
|------|--------|
| Default Path | A (FFmpeg) for speed and reliability |
| Premium Path | B (DaVinci) for showcase videos |
| Decision | Based on content type flag in trigger message |

**Current Status:** Neither path is built yet.  
**Needs:**
- FFmpeg edit script (takes EDL + source → outputs edited video)
- DaVinci macro library (import, cut, transition, export sequences)
- Quality check: verify output file exists and has reasonable duration

---

### Step 5: Export Edited Video
| Item | Detail |
|------|--------|
| Format | H.264 MP4, 1080p (or 4K if source supports) |
| Bitrate | 8-12 Mbps for 1080p, 35-45 Mbps for 4K |
| Audio | AAC 320kbps |
| Output Location | `D:\EditedFootage\Ready\` or designated export folder |
| Verification | Check file size > 10MB, duration > 30s, codec correct |

**Current Status:** FFmpeg can handle export. DaVinci export is a render queue operation.  
**Needs:** Export verification script.

---

### Step 6: AI-Generated Metadata (SEO Optimization)
**This is where Solomon's AI capabilities shine.**

| Item | Detail |
|------|--------|
| Title | GPT generates 5 options, picks best based on vidIQ keyword data |
| Description | 2000+ chars, keyword-rich, includes timestamps, links, CTAs |
| Tags | 30 tags based on vidIQ keyword research + competitor analysis |
| Thumbnail Concept | Text description for thumbnail (Sol can't generate images yet without DALL-E key) |
| Category | Auto-select based on content (Education, Howto & Style, Entertainment) |
| Publish Time | Based on YouTube Analytics best-performing upload times |

**Current Status:** 
- GPT available for title/description/tag generation ✅
- vidIQ API key NOT yet configured ❌
- YouTube Data API key NOT yet configured ❌
- Thumbnail generation requires DALL-E or Flux API key ❌

**Needs:**
- vidIQ API key (for keyword research and competitor data)
- YouTube Data API key (for analytics on best upload times)
- DALL-E or Flux key (for thumbnail generation)
- Fallback: Generate thumbnail text instructions for Jed to create manually

---

### Step 7: Upload to YouTube
**Two methods:**

#### Method A: YouTube Data API (Preferred)
- Direct upload via API from VPS or PC
- Requires OAuth2 authentication (one-time browser login)
- Can set all metadata programmatically

#### Method B: PC Agent Browser Upload (Fallback)
- PC Agent opens Chrome → YouTube Studio → Upload
- Fill in title, description, tags via DOM manipulation
- More fragile but works without API key

| Item | Detail |
|------|--------|
| Primary | YouTube Data API (once OAuth is configured) |
| Fallback | PC Agent browser automation |
| File Transfer | If using API from VPS, need to transfer file from PC to VPS first |
| Verification | Check YouTube Studio for successful upload status |

**Current Status:** Neither method is configured.  
**Needs:**
- YouTube Data API OAuth2 flow (requires Jed's browser login once)
- Upload script (Python `google-api-python-client`)
- OR: PC Agent YouTube Studio automation script

---

### Step 8: Schedule Publish Time
| Item | Detail |
|------|--------|
| Strategy | Publish when audience is most active (check YouTube Analytics) |
| Default | Tuesday/Thursday 6:00 AM EST (typical DIY/maker audience) |
| Override | Jed can specify in trigger message |
| Visibility | Set to "Scheduled" not "Public" — gives time for thumbnail review |

**Current Status:** Can be set via YouTube API during upload step.  
**Needs:** YouTube Analytics data access for optimal time calculation.

---

### Step 9: Cross-Platform Announcements
**REQUIRES JED'S APPROVAL before posting.**

| Platform | Content | Status |
|----------|---------|--------|
| Instagram (@building_shultz) | Reel clip (15-60s) + story announcement | Needs Meta Graph API |
| TikTok (@buildingshultz) | Short clip (15-60s) | Needs TikTok API |
| Facebook (Irish Craftsman) | Link post + teaser | Needs Facebook Pages API |
| Facebook (Building Shultz) | Link post + teaser | Needs Facebook Pages API |
| Email (WRENCH newsletter) | Weekly digest including new video | Needs SendGrid/Mailchimp |

**Current Status:** No social APIs configured.  
**Needs:** All social media API keys + OAuth flows.

---

## What's Currently Possible vs. What Needs to Be Built

### Currently Working ✅
1. PC Agent can receive commands from relay and execute on Jed's PC
2. GPT can generate titles, descriptions, tags, and content plans
3. Web search can research competitors and trending topics
4. PDF reports can be generated and sent to Jed via Telegram
5. Task queue processes work in parallel
6. Solomon has full business context and memory

### Needs to Be Built 🔨
1. **Folder watch script** — PC Agent monitors inbox folder for new footage
2. **FFmpeg edit pipeline** — Scene detect → EDL → automated cuts → export
3. **DaVinci Resolve macros** — For premium edits (optional, Phase 2)
4. **YouTube upload script** — Either API-based or browser-based
5. **Metadata generation prompt** — Optimized for Building Shultz's niche
6. **Thumbnail generation** — Requires image gen API or manual workflow
7. **Cross-platform posting** — Requires social media API keys

### Dependencies & Blockers 🚧

| Dependency | Blocker | Resolution |
|-----------|---------|------------|
| YouTube Data API key | Requires Google Cloud Console setup | Jed creates project, enables API, generates OAuth credentials |
| vidIQ API key | Requires vidIQ Pro subscription | Check if current plan includes API access |
| DaVinci Resolve | Must be installed on Jed's PC | Jed downloads free version from Blackmagic |
| FFmpeg on PC | Must be installed | PC Agent can install via `winget install ffmpeg` |
| OAuth2 for YouTube | Requires one-time browser login | PC Agent handles via Chrome |
| Social media APIs | Requires developer accounts | Jed applies for Meta/TikTok developer access |

---

## Implementation Phases

### Phase 1: Minimum Viable Pipeline (Week 1-2)
- Install FFmpeg on Jed's PC via PC Agent
- Build folder watch + trigger system
- Build FFmpeg-based simple edit (silence removal + scene cuts)
- Build metadata generation (GPT-powered, no vidIQ yet)
- Build YouTube upload via PC Agent browser (no API needed)
- **Result:** Jed drops footage → gets a basic edited, uploaded video

### Phase 2: SEO & Quality Upgrade (Week 3-4)
- Configure YouTube Data API
- Configure vidIQ API
- Add intelligent edit decisions (content-aware cuts via Whisper)
- Add thumbnail generation (text-based instructions or DALL-E)
- Add scheduled publishing with analytics-based timing
- **Result:** Videos are SEO-optimized and published at optimal times

### Phase 3: Full Automation (Month 2)
- DaVinci Resolve integration for premium edits
- Cross-platform posting (Instagram, TikTok, Facebook)
- WRENCH newsletter integration
- A/B testing thumbnails
- Performance tracking and iteration
- **Result:** Fully autonomous content pipeline, zero Jed input needed

---

## Success Metric

> Jed records a video in his shop, drops the SD card in his PC, sends Sol "new footage ready" on Telegram, and 24 hours later a fully edited, SEO-optimized, scheduled YouTube video is ready to go live — without Jed touching a keyboard again.

---

## Cost Estimate

| Item | Monthly Cost |
|------|-------------|
| VPS (current) | $12 |
| OpenAI API (edit decisions, metadata) | ~$5-15 |
| YouTube Data API | Free (quota-based) |
| vidIQ | Already subscribed |
| FFmpeg | Free |
| DaVinci Resolve | Free |
| **Total** | **~$17-27/month** |

Well within the $100/month budget ceiling.
