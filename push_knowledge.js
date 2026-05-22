#!/usr/bin/env node
/**
 * Push critical knowledge into Sol's persistent memory (sol-knowledge.json)
 */
const fs = require('fs');
const path = require('path');

const KB_PATH = path.join(__dirname, 'sol-knowledge.json');

// Load existing knowledge base
let kb = {};
try {
  kb = JSON.parse(fs.readFileSync(KB_PATH, 'utf8'));
} catch (e) {
  kb = { entries: [], metadata: {} };
}

if (!kb.entries) kb.entries = [];
if (!kb.metadata) kb.metadata = {};

// Helper to add/update an entry
function upsert(category, key, data) {
  const existing = kb.entries.findIndex(e => e.category === category && e.key === key);
  const entry = {
    category,
    key,
    data,
    updatedAt: new Date().toISOString(),
    source: 'architect-transfer'
  };
  if (existing !== -1) {
    kb.entries[existing] = entry;
  } else {
    kb.entries.push(entry);
  }
}

// ═══════════════════════════════════════════════════════════
// 1. THE 12 PAIN-POINT APP IDEAS
// ═══════════════════════════════════════════════════════════
upsert('business', 'pain-point-apps', {
  title: '12 Pain-Point App Pipeline',
  description: 'Jedidiah\'s pipeline of 12 app ideas, each solving a real pain point for tradesmen, creators, and small business owners.',
  strategy: 'Build MVPs, validate with audience, monetize via subscription. Each app feeds the Building Shultz ecosystem.',
  apps: [
    {
      name: 'IronEdit',
      status: 'ACTIVE — TOP PRIORITY',
      painPoint: 'Creators shoot great footage but hate editing. No "drop and forget" solution exists.',
      description: 'Drop-to-Post video production pipeline. User drops raw footage, app handles everything (silence removal, smart cuts, color, titles, SEO, upload).',
      target: 'Non-technical creators, tradesmen, wedding videographers, small business owners',
      pricing: 'Tiered subscription: Weekend Warrior / Pro / Enterprise',
      moat: '12-18 months ahead of Adobe/Google/Runway on full pipeline for non-technical users'
    },
    {
      name: 'TradeCalc Pro',
      status: 'Concept',
      painPoint: 'Tradesmen waste time doing manual calculations for pipe fitting, electrical, HVAC, carpentry.',
      description: 'All-in-one trade calculator with pipe offset, conduit bending, material estimation, cut lists, and unit conversion. Voice input for hands-on-tools use.',
      target: 'Pipefitters, electricians, HVAC techs, carpenters',
      pricing: '$4.99/mo or $39.99/year'
    },
    {
      name: 'JobSight',
      status: 'Concept',
      painPoint: 'Construction workers can\'t easily document job progress, safety issues, or material needs on-site.',
      description: 'Photo-first job documentation app. Snap photos, AI auto-tags location/trade/issue, generates daily reports for foremen.',
      target: 'Construction crews, foremen, project managers',
      pricing: '$9.99/mo per crew'
    },
    {
      name: 'ShopManager',
      status: 'Concept',
      painPoint: 'Small workshop owners have no simple way to track inventory, projects, and client orders.',
      description: 'Workshop/garage business manager. Track materials, client orders, project timelines, invoicing. Built for one-man shops.',
      target: 'Custom woodworkers, welders, small fabrication shops',
      pricing: '$7.99/mo'
    },
    {
      name: 'ContentForge',
      status: 'Concept',
      painPoint: 'Small creators struggle to maintain consistent posting across platforms.',
      description: 'AI content repurposing engine. Take one long-form video, auto-generate shorts, tweets, newsletter, blog post, thumbnails.',
      target: 'YouTube creators under 10K subs',
      pricing: '$14.99/mo'
    },
    {
      name: 'BidBuilder',
      status: 'Concept',
      painPoint: 'Independent contractors lose jobs because their bids look unprofessional or take too long to prepare.',
      description: 'Professional bid/estimate generator. Input job details, AI generates formatted PDF bid with material costs, labor, timeline.',
      target: 'Independent contractors, handymen, small construction firms',
      pricing: '$12.99/mo'
    },
    {
      name: 'SafetyFirst',
      status: 'Concept',
      painPoint: 'Small construction companies struggle with OSHA compliance documentation.',
      description: 'Safety compliance tracker. Daily toolbox talks, incident reports, training records, OSHA-ready documentation.',
      target: 'Small construction companies (5-50 employees)',
      pricing: '$19.99/mo'
    },
    {
      name: 'RentalTracker',
      status: 'Concept',
      painPoint: 'Small equipment rental businesses use spreadsheets or nothing to track inventory and bookings.',
      description: 'Equipment rental management. Track availability, bookings, maintenance schedules, customer deposits, late fees.',
      target: 'Small rental businesses (trailers, tools, equipment)',
      pricing: '$14.99/mo',
      note: 'Directly applicable to S&H Rentals'
    },
    {
      name: 'MentorMatch',
      status: 'Concept',
      painPoint: 'Young tradesmen have no easy way to find mentors in their specific trade.',
      description: 'Trade mentorship platform. Connect apprentices with journeymen/masters. Video calls, project reviews, career guidance.',
      target: 'Trade apprentices and experienced tradesmen',
      pricing: 'Freemium + $9.99/mo premium'
    },
    {
      name: 'DadOps',
      status: 'Concept',
      painPoint: 'Working dads struggle to balance family time, side hustles, and personal goals.',
      description: 'Life operating system for busy dads. Time blocking, family calendar sync, side hustle tracker, goal accountability.',
      target: 'Working fathers with side businesses',
      pricing: '$6.99/mo'
    },
    {
      name: 'FlipFinder',
      status: 'Concept',
      painPoint: 'People who flip furniture/items waste time searching multiple platforms for deals.',
      description: 'Aggregated marketplace scanner. Monitors FB Marketplace, Craigslist, estate sales for underpriced items matching your criteria.',
      target: 'Furniture flippers, resellers, pickers',
      pricing: '$9.99/mo'
    },
    {
      name: 'UnionHub',
      status: 'Concept',
      painPoint: 'Union members have no centralized app for job calls, training hours, benefit tracking, and local news.',
      description: 'Union member companion app. Job call alerts, training hour tracker, benefit calculator, local meeting reminders.',
      target: 'Union tradesmen (pipefitters, electricians, ironworkers)',
      pricing: '$4.99/mo or union-sponsored'
    }
  ]
});

// ═══════════════════════════════════════════════════════════
// 2. BUILDING SHULTZ BRAND IDENTITY
// ═══════════════════════════════════════════════════════════
upsert('brand', 'building-shultz-identity', {
  title: 'Building Shultz Brand Identity',
  tagline: 'Be Inspired, Stay Humble, and Build.',
  mission: 'Bridge the gap between blue-collar trades and modern technology. Show tradesmen, makers, and dads that AI and tech are tools — not threats.',
  audience: {
    primary: 'Tradesmen and makers (25-45, male, hands-on workers)',
    secondary: 'DIY enthusiasts and fathers pursuing self-improvement',
    tertiary: 'Small business owners in trades/construction'
  },
  tone: 'Authentic, hands-on, blue-collar wisdom meets modern ambition. No corporate speak. Real talk.',
  visualIdentity: {
    colors: 'Dark/industrial tones, metallic gold accents, forge/anvil aesthetic',
    typography: 'Bold, clean, masculine',
    imagery: 'Workshop, tools, raw materials, builds in progress, family'
  },
  platforms: {
    youtube: { handle: '@BuildingShultz', subs: '~1,450', videos: 287 },
    instagram: '@building_shultz',
    tiktok: '@buildingshultz',
    merch: 'Spreadshop — "Building What Matters" line'
  },
  differentiator: 'Nobody else speaks to tradesmen about AI. Most AI content is from tech people. Jed bridges that gap — he IS the target audience AND the creator.',
  contentPillars: [
    'Woodworking & metalworking builds',
    'AI tools for makers and tradesmen',
    'Fatherhood and self-improvement',
    'Small business / entrepreneurship from the trades',
    'The AI Journey (documenting Sol\'s development)'
  ]
});

// ═══════════════════════════════════════════════════════════
// 3. FINANCIAL GOALS AND TIMELINE
// ═══════════════════════════════════════════════════════════
upsert('business', 'financial-goals', {
  title: 'Financial Goals & Timeline',
  fiveYearGoal: 'Build a million-dollar company (Shultz Enterprises)',
  currentIncome: 'Journeyman pipefitter salary (union, full-time)',
  strategy: {
    phase1: 'YouTube as funnel → audience → trust → product sales',
    phase2: 'IronEdit launch → SaaS recurring revenue',
    phase3: 'App pipeline → multiple revenue streams',
    phase4: 'Passive income (KDP, merch, rentals) covers base expenses',
    phase5: 'Go full-time entrepreneur when math makes sense'
  },
  revenueStreams: [
    { source: 'IronEdit SaaS', status: 'In development', potential: '$50K-500K ARR' },
    { source: 'YouTube AdSense', status: 'Active (~$50-100/mo)', potential: '$2K-10K/mo at scale' },
    { source: 'Brand deals/sponsorships', status: 'Not yet', potential: '$500-5K per deal' },
    { source: 'KDP books/products', status: 'Active (low volume)', potential: '$500-2K/mo passive' },
    { source: 'Merch (Spreadshop)', status: 'Active (low volume)', potential: '$200-1K/mo' },
    { source: 'Pain-point apps (pipeline)', status: 'Concept phase', potential: '$10K-100K ARR each' },
    { source: 'S&H Rentals', status: 'Back burner', potential: '$1K-5K/mo' },
    { source: 'Newsletter/community', status: 'Not started', potential: '$500-5K/mo' }
  ],
  principles: [
    'Every idle dollar is a wasted soldier — keep money working',
    'Tax efficiency: maximize deductions, structure entities properly',
    'Compound toward the million-dollar goal with every decision',
    'Hands-off businesses where possible — Jed\'s time is the scarcest resource',
    'Only go full-time when passive income covers 80% of expenses'
  ]
});

// ═══════════════════════════════════════════════════════════
// 4. IRONEDIT PRODUCT CONCEPT (DETAILED)
// ═══════════════════════════════════════════════════════════
upsert('product', 'ironedit-full-concept', {
  title: 'IronEdit — Full Product Concept',
  vision: 'Drop-to-Post content production pipeline',
  userFlow: 'User drops raw footage → app handles EVERYTHING → finished video ready to upload or auto-posted',
  targetMarket: [
    'Non-technical creators who shoot great footage but hate editing',
    'Tradesmen who want YouTube presence without tech learning curve',
    'Wedding videographers drowning in footage',
    'Small business owners making content for marketing'
  ],
  pricing: {
    weekendWarrior: { price: '$9.99/mo', features: 'Basic cuts, silence removal, 5 videos/mo' },
    pro: { price: '$29.99/mo', features: 'Full pipeline, unlimited videos, SEO, thumbnails' },
    enterprise: { price: '$99.99/mo', features: 'Teams, API access, white-label, priority rendering' }
  },
  techStack: {
    desktop: 'Electron (switched from Tauri — Rust compilation failed on Jed\'s PC)',
    pipeline: 'Python (roughcut-pro) — silence removal, transcoding, proxy building',
    api: 'WebSocket cloud server (built, tested, functional)',
    mobile: 'React Native/Expo (47 tests passing)',
    ai: 'GPT-4o for titles/descriptions/tags, frame extraction for thumbnails'
  },
  currentStatus: {
    desktop: 'Switching to Electron (Tauri abandoned)',
    pipeline: 'Python v0.4 — stuck at 80.4% on real render (GPU encoding bug)',
    api: 'Functional',
    mobile: 'v0.5 with tests',
    endToEnd: 'NOT working yet — no complete drop-to-post flow'
  },
  competitiveEdge: '12-18 months ahead of Adobe/Google/Runway/ByteDance on full pipeline for non-technical users. Nobody else has built the complete drop-to-post workflow.',
  branding: 'NO "AI" in the name. It\'s a tool, not a gimmick. "IronEdit" — strong, reliable, gets the job done.'
});

// ═══════════════════════════════════════════════════════════
// 5. SOL'S OWN ARCHITECTURE (SELF-AWARENESS)
// ═══════════════════════════════════════════════════════════
upsert('system', 'sol-architecture', {
  title: 'Solomon v5.0 — System Architecture',
  version: '5.0',
  host: 'DigitalOcean VPS (167.99.237.26)',
  runtime: 'Node.js v20, Ubuntu 22.04',
  processManager: 'PM2 (solomon-bot + solomon-relay)',
  llm: {
    primary: 'openai/gpt-5.1-codex (via OpenRouter)',
    fallback: 'openai/gpt-4.1 (via OpenRouter)',
    search: 'perplexity/sonar (live web search with citations)'
  },
  modules: {
    core: ['bot.js', 'worker.js', 'config.js', 'knowledge-base.js'],
    capabilities: [
      'mcp-client.js — Model Context Protocol for SaaS integrations',
      'vector-memory.js — ChromaDB semantic memory with JSON fallback',
      'video-gen.js — Video generation (Luma/Runway APIs)',
      'audio-gen.js — ElevenLabs TTS and voice generation',
      'data-viz.js — Chart/graph generation (chartjs-node-canvas)',
      'browser-agent.js — Playwright headless browser automation',
      'scheduler.js — node-cron task scheduling with persistence',
      'stripe-tools.js — Stripe payment/financial tools',
      'app-deployer.js — Next.js app scaffolding and deployment',
      'ironedit-pipeline.js — IronEdit video processing commands'
    ]
  },
  selfUpgrade: {
    model: 'gpt-5.1-codex',
    method: 'Incremental code generation (skeleton → function-by-function → assemble → validate → deploy)',
    safety: 'node --check pre-flight, automatic rollback on failure, 3-attempt limit',
    messageLimit: '3-second rate limit, 60-second deduplication'
  },
  pcAgent: {
    location: 'Jed\'s Windows PC (via solomon-relay WebSocket)',
    capabilities: 'PowerShell execution, file access, git, npm, python, OBS control, DaVinci Resolve scripting',
    heartbeat: 'Every 5 seconds'
  },
  memory: {
    shortTerm: 'Telegram conversation history (100 messages)',
    longTerm: 'sol-knowledge.json (structured entries)',
    semantic: 'ChromaDB vector store (when available)',
    projects: 'project-state.json (active project tracking)'
  }
});

// Save the knowledge base
fs.writeFileSync(KB_PATH, JSON.stringify(kb, null, 2), 'utf8');
console.log(`[OK] Knowledge base updated: ${kb.entries.length} total entries`);
console.log(`     - pain-point-apps: 12 app ideas with full details`);
console.log(`     - building-shultz-identity: brand positioning and audience`);
console.log(`     - financial-goals: timeline, revenue streams, principles`);
console.log(`     - ironedit-full-concept: product vision, tech stack, status`);
console.log(`     - sol-architecture: full self-awareness of own system`);
console.log(`     File: ${KB_PATH} (${(JSON.stringify(kb).length / 1024).toFixed(1)} KB)`);
