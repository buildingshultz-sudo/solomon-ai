/**
 * queue_upgrades.js
 * Injects 10 self_upgrade tasks into Sol's task-queue.json.
 * Run on VPS: node /root/solomon-bot/queue_upgrades.js
 */
const fs = require('fs');
const path = require('path');

const QUEUE_FILE = path.join(__dirname, 'task-queue.json');
const queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));

const now = Date.now();

const upgrades = [
  {
    id: `upgrade_01_mcp_${now}`,
    title: 'MCP Integration Engine',
    description: `Install @modelcontextprotocol/sdk for Node.js on the VPS. Create a new file /root/solomon-bot/mcp-client.js that:
1. Imports and initializes the MCP SDK client
2. Implements a dynamic tool registry: connects to configured MCP servers (list stored in config.js as MCP_SERVERS array), fetches their available tools via tools/list
3. Exposes a getMCPTools() function that returns all available tools in OpenAI function-calling format
4. Exposes a callMCPTool(serverName, toolName, args) function that routes tool calls to the correct MCP server
5. Exports the registry so bot.js can import it
Then update bot.js to:
- Import mcp-client.js
- In the main GPT-4o call, merge getMCPTools() into the tools array alongside existing tools
- In the tool dispatch logic, check if a tool call matches an MCP tool and route it via callMCPTool()
Add MCP_SERVERS: [] to config.js as an empty array placeholder.
Target files: new /root/solomon-bot/mcp-client.js, update /root/solomon-bot/bot.js and /root/solomon-bot/config.js`,
    type: 'self_upgrade',
    priority: 10,
    status: 'pending',
    attempts: 0,
    category: 'capabilities',
    roadmapPhase: 1,
    targetFile: 'mcp-client.js',
    restartProcess: 'solomon-bot',
    createdAt: now + 1
  },
  {
    id: `upgrade_02_chromadb_${now}`,
    title: 'ChromaDB Vector Memory',
    description: `Install chromadb npm package on the VPS (npm install chromadb). Create a new file /root/solomon-bot/vector-memory.js that:
1. Imports chromadb and initializes a persistent ChromaDB client pointing to /root/solomon-bot/chroma-data/
2. Creates/opens a collection called "sol_knowledge"
3. Implements addMemory(id, text, metadata) — embeds text using OpenAI text-embedding-3-small via OpenRouter and upserts into ChromaDB
4. Implements searchMemory(query, nResults=5) — embeds query, queries ChromaDB, returns top results with metadata
5. Implements migrateFromJSON(knowledgeBasePath) — reads existing sol-knowledge.json, embeds each entry, and upserts into ChromaDB
6. On module load, checks if collection is empty and auto-migrates from sol-knowledge.json if so
Then update bot.js to:
- Import vector-memory.js
- Replace all direct sol-knowledge.json reads with searchMemory() calls for context retrieval
- Replace all knowledge base writes with addMemory() calls
Target files: new /root/solomon-bot/vector-memory.js, update /root/solomon-bot/bot.js`,
    type: 'self_upgrade',
    priority: 9,
    status: 'pending',
    attempts: 0,
    category: 'capabilities',
    roadmapPhase: 1,
    targetFile: 'vector-memory.js',
    restartProcess: 'solomon-bot',
    createdAt: now + 2
  },
  {
    id: `upgrade_03_parallel_${now}`,
    title: 'Parallel Subtask Processing (MapReduce)',
    description: `Update /root/solomon-bot/worker.js to implement a MapReduce pattern for research tasks:
1. Add a new function executeParallelResearch(task) that:
   a. MAP phase: Calls GPT-4o with the task description and asks it to generate an array of 5-8 specific sub-queries as JSON
   b. EXECUTE phase: Runs all sub-queries concurrently via Promise.all(), each calling _webSearchStructured() via the Perplexity Sonar backend
   c. REDUCE phase: Collects all results into a single context string, calls GPT-4o once more to synthesize a final comprehensive report
2. In the main executeResearchTask() function, check if the task description is complex (>50 words or contains "comprehensive", "full", "deep", "all", "every") — if so, delegate to executeParallelResearch() instead of the sequential approach
3. Add concurrency limiting: use a semaphore (simple counter) to cap concurrent OpenRouter calls at 5 to avoid rate limits
4. Log [WORKER][PARALLEL] prefix for parallel execution steps
Target file: /root/solomon-bot/worker.js`,
    type: 'self_upgrade',
    priority: 8,
    status: 'pending',
    attempts: 0,
    category: 'capabilities',
    roadmapPhase: 1,
    targetFile: 'worker.js',
    restartProcess: 'solomon-bot',
    createdAt: now + 3
  },
  {
    id: `upgrade_04_bullmq_${now}`,
    title: 'Advanced Cron Scheduling with BullMQ',
    description: `Install Redis and BullMQ on the VPS:
1. Run: apt-get install -y redis-server && systemctl enable redis && systemctl start redis
2. Run: npm install bullmq in /root/solomon-bot/
3. Create new file /root/solomon-bot/scheduler.js that:
   a. Imports BullMQ Queue and Worker
   b. Creates a "sol-scheduled" queue connected to Redis at localhost:6379
   c. Implements scheduleTask(name, cronExpression, taskData) — adds a repeatable job to the queue
   d. Implements listScheduled() — returns all scheduled jobs with their next run time
   e. Implements removeScheduled(name) — removes a scheduled job
   f. Implements a BullMQ Worker that processes jobs by adding them to the main task-queue.json
   g. Exports all functions
4. Update bot.js to:
   a. Import scheduler.js
   b. Add /schedule command handler: parses natural language like "every day at 9am" using GPT-4o to extract cron syntax, then calls scheduleTask()
   c. Add /scheduled command: lists all active scheduled tasks
   d. Add /unschedule command: removes a scheduled task by name
5. Add scheduler.js to PM2 ecosystem or start it within bot.js startup
Target files: new /root/solomon-bot/scheduler.js, update /root/solomon-bot/bot.js`,
    type: 'self_upgrade',
    priority: 7,
    status: 'pending',
    attempts: 0,
    category: 'capabilities',
    roadmapPhase: 2,
    targetFile: 'scheduler.js',
    restartProcess: 'solomon-bot',
    createdAt: now + 4
  },
  {
    id: `upgrade_05_videogen_${now}`,
    title: 'Video Generation Pipeline',
    description: `Create new file /root/solomon-bot/video-gen.js that integrates with video generation APIs:
1. Implement generateVideo(prompt, options) function that:
   a. First tries Luma Dream Machine API (POST https://api.lumalabs.ai/dream-machine/v1/generations) using LUMA_API_KEY env var
   b. Falls back to Runway Gen-3 API (POST https://api.runwayml.com/v1/image_to_video) using RUNWAY_API_KEY env var
   c. Falls back to Kling AI API using KLING_API_KEY env var
   d. If no video API keys are set, uses OpenAI DALL-E 3 to generate a storyboard of 4 images instead and returns them as a ZIP
2. Implement pollVideoStatus(generationId, apiName) — polls the API until the video is ready (max 5 minutes)
3. Implement downloadVideo(url, outputPath) — downloads the completed video to /tmp/
4. Export generateVideo as the main function
5. Update bot.js to:
   a. Import video-gen.js
   b. Add /video command handler: accepts a text prompt, calls generateVideo(), downloads result, sends .mp4 to Telegram chat via sendVideo()
   c. Add video generation as a tool available to GPT-4o function calling
Target files: new /root/solomon-bot/video-gen.js, update /root/solomon-bot/bot.js`,
    type: 'self_upgrade',
    priority: 6,
    status: 'pending',
    attempts: 0,
    category: 'capabilities',
    roadmapPhase: 2,
    targetFile: 'video-gen.js',
    restartProcess: 'solomon-bot',
    createdAt: now + 5
  },
  {
    id: `upgrade_06_elevenlabs_${now}`,
    title: 'ElevenLabs Voice & Audio Generation',
    description: `Create new file /root/solomon-bot/audio-gen.js that integrates ElevenLabs API:
1. Implement textToSpeech(text, voiceId, options) function that:
   a. Calls ElevenLabs API: POST https://api.elevenlabs.io/v1/text-to-speech/{voiceId}
   b. Uses ELEVENLABS_API_KEY environment variable for auth
   c. Default voiceId: "21m00Tcm4TlvDq8ikWAM" (Rachel — natural English voice)
   d. Saves output to /tmp/sol-audio-{timestamp}.mp3
   e. Returns the file path
2. Implement listVoices() — calls GET https://api.elevenlabs.io/v1/voices, returns array of {id, name, description}
3. Implement cloneVoice(name, audioFilePath) — calls POST https://api.elevenlabs.io/v1/voices/add with audio sample
4. Implement soundEffect(text) — calls POST https://api.elevenlabs.io/v1/sound-generation
5. Update bot.js to:
   a. Import audio-gen.js
   b. Add /speak command handler: accepts text, calls textToSpeech(), sends resulting .mp3 as Telegram voice message via sendVoice()
   c. Add /voices command: lists available ElevenLabs voices
   d. Add TTS as a GPT-4o tool: when GPT-4o wants to respond with audio, it can call textToSpeech()
   e. If ELEVENLABS_API_KEY is not set, /speak falls back to a simple notification that the key is needed
Target files: new /root/solomon-bot/audio-gen.js, update /root/solomon-bot/bot.js`,
    type: 'self_upgrade',
    priority: 5,
    status: 'pending',
    attempts: 0,
    category: 'capabilities',
    roadmapPhase: 2,
    targetFile: 'audio-gen.js',
    restartProcess: 'solomon-bot',
    createdAt: now + 6
  },
  {
    id: `upgrade_07_dataviz_${now}`,
    title: 'Data Visualization & Reporting',
    description: `Install chartjs-node-canvas on VPS: npm install chartjs-node-canvas chart.js
Create new file /root/solomon-bot/data-viz.js that:
1. Imports ChartJSNodeCanvas from chartjs-node-canvas
2. Implements renderChart(config, outputPath) — takes a Chart.js config object, renders to PNG at outputPath (1200x800px), returns the file path
3. Implements generateDataReport(data, title, description) function that:
   a. Calls GPT-4o with the data and asks it to: (1) analyze the data, (2) return a Chart.js config JSON for the most appropriate chart type, (3) write a 3-paragraph analysis
   b. Renders the chart using renderChart()
   c. Returns {chartPath, analysis, chartConfig}
4. Implements common chart helpers: barChart(labels, datasets, title), lineChart(labels, datasets, title), pieChart(labels, data, title)
5. Update bot.js to:
   a. Import data-viz.js
   b. Add /chart command handler: accepts data as text or CSV, calls generateDataReport(), sends PNG chart + analysis to Telegram
   c. Add chart generation as a GPT-4o tool so it can proactively generate charts when presenting research data
   d. In the research task completion handler, if the result contains numerical data, automatically generate a summary chart
Target files: new /root/solomon-bot/data-viz.js, update /root/solomon-bot/bot.js`,
    type: 'self_upgrade',
    priority: 4,
    status: 'pending',
    attempts: 0,
    category: 'capabilities',
    roadmapPhase: 2,
    targetFile: 'data-viz.js',
    restartProcess: 'solomon-bot',
    createdAt: now + 7
  },
  {
    id: `upgrade_08_playwright_${now}`,
    title: 'Authenticated Browser Automation (Playwright)',
    description: `Install Playwright on VPS: npm install playwright && npx playwright install chromium
Create new file /root/solomon-bot/browser-agent.js that:
1. Imports playwright
2. Implements runBrowserTask(instructions, options) function that:
   a. Calls GPT-4o with the instructions and asks it to write a complete Playwright script as a JavaScript string
   b. The script should use page.goto(), page.click(), page.fill(), page.screenshot(), page.evaluate() etc.
   c. Saves the generated script to /tmp/playwright-task-{timestamp}.js
   d. Executes it via child_process.exec("node /tmp/playwright-task-{timestamp}.js")
   e. Returns stdout, stderr, and any screenshots taken
3. Implements scrapeURL(url, extractionInstructions) — launches browser, navigates to URL, takes screenshot, extracts text, returns structured data
4. Implements loginAndScrape(url, credentials, extractionInstructions) — handles login flows
5. Stores session cookies in /root/solomon-bot/browser-sessions/{domain}.json for reuse
6. Update bot.js to:
   a. Import browser-agent.js
   b. Add /browse command handler: accepts URL + optional instructions, calls scrapeURL(), returns extracted content + screenshot
   c. Add browser automation as a GPT-4o tool for research tasks
Target files: new /root/solomon-bot/browser-agent.js, update /root/solomon-bot/bot.js`,
    type: 'self_upgrade',
    priority: 3,
    status: 'pending',
    attempts: 0,
    category: 'capabilities',
    roadmapPhase: 3,
    targetFile: 'browser-agent.js',
    restartProcess: 'solomon-bot',
    createdAt: now + 8
  },
  {
    id: `upgrade_09_stripe_${now}`,
    title: 'Stripe Financial Orchestration',
    description: `Install stripe-node on VPS: npm install stripe
Create new file /root/solomon-bot/stripe-tools.js that:
1. Imports stripe and initializes with process.env.STRIPE_SECRET_KEY
2. Implements getBalance() — calls stripe.balance.retrieve(), returns formatted balance object
3. Implements listCharges(limit=10) — calls stripe.charges.list(), returns array of {id, amount, currency, description, status, created}
4. Implements listCustomers(limit=10) — calls stripe.customers.list(), returns customer summaries
5. Implements createPaymentLink(priceId, quantity=1) — calls stripe.paymentLinks.create(), returns the URL
6. Implements createCheckoutSession(items, successUrl, cancelUrl) — creates a Stripe Checkout session, returns URL
7. Implements getRevenueSummary(days=30) — aggregates charges from the past N days, returns {total, count, avgCharge, topProducts}
8. Exports all functions
9. Update bot.js to:
   a. Import stripe-tools.js
   b. Add /stripe command handler with subcommands: /stripe balance, /stripe charges, /stripe revenue, /stripe link [price_id]
   c. Add all Stripe functions as GPT-4o tools so Sol can answer financial questions autonomously
   d. If STRIPE_SECRET_KEY is not set, commands return a helpful message about setting the env var
Target files: new /root/solomon-bot/stripe-tools.js, update /root/solomon-bot/bot.js`,
    type: 'self_upgrade',
    priority: 2,
    status: 'pending',
    attempts: 0,
    category: 'capabilities',
    roadmapPhase: 3,
    targetFile: 'stripe-tools.js',
    restartProcess: 'solomon-bot',
    createdAt: now + 9
  },
  {
    id: `upgrade_10_appdeployer_${now}`,
    title: 'Automated App Scaffolding & Deployment',
    description: `Create new file /root/solomon-bot/app-deployer.js that automates full-stack app creation and deployment:
1. Implement scaffoldNextApp(projectName, description, features) function that:
   a. Calls GPT-4o to generate a complete Next.js 14 + Tailwind CSS app structure based on description and features
   b. Creates the directory at /root/projects/{projectName}/
   c. Writes all generated files: package.json, next.config.js, tailwind.config.js, app/page.tsx, app/layout.tsx, app/globals.css, and any additional pages/components GPT-4o generates
   d. Runs npm install in the project directory
   e. Returns the project path
2. Implement initGitRepo(projectPath, repoName) function that:
   a. Runs git init, git add ., git commit -m "Initial commit by Sol"
   b. Creates a GitHub repo via GitHub API (POST https://api.github.com/user/repos) using GITHUB_TOKEN env var
   c. Pushes to the new repo
   d. Returns the GitHub repo URL
3. Implement deployToVercel(projectPath, repoUrl) function that:
   a. Uses Vercel API (POST https://api.vercel.com/v13/deployments) with VERCEL_TOKEN env var
   b. Triggers a deployment from the GitHub repo
   c. Polls for deployment completion
   d. Returns the live deployment URL
4. Implement deployApp(projectName, description, features) — orchestrates all three steps
5. Update bot.js to:
   a. Import app-deployer.js
   b. Add /deploy command handler: accepts project name + description, calls deployApp(), reports progress to Telegram, sends final live URL
   c. Add app deployment as a GPT-4o tool
Target files: new /root/solomon-bot/app-deployer.js, update /root/solomon-bot/bot.js`,
    type: 'self_upgrade',
    priority: 1,
    status: 'pending',
    attempts: 0,
    category: 'capabilities',
    roadmapPhase: 3,
    targetFile: 'app-deployer.js',
    restartProcess: 'solomon-bot',
    createdAt: now + 10
  }
];

// Remove any existing pending upgrade tasks with the same titles to avoid duplicates
const upgradeTitles = new Set(upgrades.map(u => u.title));
const before = queue.tasks.length;
queue.tasks = queue.tasks.filter(t => {
  if (upgradeTitles.has(t.title) && t.status === 'pending') {
    console.log(`Removing duplicate pending task: ${t.title}`);
    return false;
  }
  return true;
});
if (before !== queue.tasks.length) {
  console.log(`Removed ${before - queue.tasks.length} duplicate tasks`);
}

// Append all 10 upgrade tasks
queue.tasks.push(...upgrades);

// Update stats
queue.stats = queue.stats || {};
queue.stats.total = queue.tasks.length;

fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2), 'utf8');

console.log(`\n✅ Queued ${upgrades.length} self_upgrade tasks`);
console.log(`Total tasks in queue: ${queue.tasks.length}`);
console.log('\nQueued in order:');
upgrades.forEach((u, i) => {
  console.log(`  ${i + 1}. [priority ${u.priority}] ${u.title} → ${u.targetFile}`);
});
console.log('\nWorker will process highest priority first (priority 10 = MCP first).');
