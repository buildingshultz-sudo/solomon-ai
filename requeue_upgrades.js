const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const queuePath = path.join(__dirname, 'task-queue.json');
const q = JSON.parse(fs.readFileSync(queuePath, 'utf8'));

// Helper to generate a simple ID without uuid
function genId(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

// Define the tasks to ensure are in the queue
const requiredTasks = [
  {
    id: genId('mcp_engine'),
    type: 'self_upgrade',
    title: 'MCP Integration Engine',
    description: `Create a new file mcp-client.js. This module implements a Model Context Protocol (MCP) client for Node.js. It should:
1. Import @modelcontextprotocol/sdk or use raw HTTP to connect to MCP servers
2. Export a function connectToServer(serverUrl) that connects to an MCP server
3. Export a function listTools(serverUrl) that returns available tools from a connected MCP server
4. Export a function callTool(serverUrl, toolName, params) that calls a tool on an MCP server
5. Export a function getAvailableServers() that returns a list of configured MCP server URLs from config or env vars
6. Use proper async/await error handling
7. Use module.exports at the end
8. Do NOT use any duplicate variable or function names within the file
9. Keep it simple - no external dependencies beyond built-in Node.js http/https modules`,
    targetFile: 'mcp-client.js',
    restartProcess: 'solomon-bot',
    status: 'pending',
    attempts: 0,
    priority: 10,
    createdAt: new Date().toISOString()
  },
  {
    id: genId('chromadb_v2'),
    type: 'self_upgrade',
    title: 'ChromaDB Vector Memory',
    description: `Create a new file vector-memory.js. This module implements vector-based memory storage. Since ChromaDB requires a running server, use a simpler approach:
1. Use the 'chromadb' npm package with the default in-memory client (new ChromaClient())
2. Export initVectorMemory() - initializes the client and creates a 'solomon_memory' collection
3. Export addMemory(text, metadata) - adds a text entry with metadata to the collection
4. Export searchMemory(query, nResults) - searches for similar memories using text search
5. Export getAllMemories() - returns all stored memories
6. Handle the case where chromadb is not installed by falling back to a simple JSON array stored in vector-memory-store.json
7. Use module.exports at the end with all 4 functions
8. Do NOT declare any variable more than once in the file
9. No duplicate function names`,
    targetFile: 'vector-memory.js',
    restartProcess: 'solomon-bot',
    status: 'pending',
    attempts: 0,
    priority: 9,
    createdAt: new Date().toISOString()
  },
  {
    id: genId('parallel_v2'),
    type: 'self_upgrade',
    title: 'Parallel Subtask Processing',
    description: `Modify the existing worker.js file to add a new task type called 'parallel_research'. When this task type is encountered:
1. Read the task's 'subQueries' array field (list of search queries to run in parallel)
2. Use Promise.all() to run all queries concurrently via the existing webSearch function
3. Collect all results and pass them to callLLM() with a synthesis prompt
4. Save the synthesized result to the task's result field and mark as completed
5. Add the handler in the main task dispatch switch/if block alongside other task types
6. Do NOT rewrite the entire worker.js - only ADD the new parallel_research handler
7. The addition should be a self-contained block that does not conflict with existing code`,
    targetFile: 'worker.js',
    restartProcess: 'solomon-bot',
    status: 'pending',
    attempts: 0,
    priority: 8,
    createdAt: new Date().toISOString()
  },
  {
    id: genId('scheduler_v2'),
    type: 'self_upgrade',
    title: 'Advanced Cron Scheduling',
    description: `Create a new file scheduler.js. This module implements cron-based scheduling. Requirements:
1. Use the 'node-cron' npm package (require('node-cron'))
2. Export initScheduler(bot, chatId) - initializes the scheduler with the Telegram bot instance
3. Export addSchedule(id, cronExpression, taskDescription, callback) - adds a new scheduled task
4. Export removeSchedule(id) - removes a scheduled task by ID
5. Export listSchedules() - returns all active scheduled tasks
6. Store schedules in a schedules.json file for persistence across restarts
7. On init, reload and restart any saved schedules from the JSON file
8. Use module.exports at the end
9. No duplicate variable or function names in the file`,
    targetFile: 'scheduler.js',
    restartProcess: 'solomon-bot',
    status: 'pending',
    attempts: 0,
    priority: 7,
    createdAt: new Date().toISOString()
  },
  {
    id: genId('videogen_v2'),
    type: 'self_upgrade',
    title: 'Video Generation Pipeline',
    description: `Create a new file video-gen.js. This module integrates with video generation APIs. Requirements:
1. Export generateVideo(prompt, outputPath) - calls the Luma Dream Machine API or Runway Gen-3 API to generate a video from a text prompt. Use process.env.LUMA_API_KEY or process.env.RUNWAY_API_KEY
2. Export pollVideoStatus(jobId) - polls the API until the video is ready and returns the download URL
3. Export downloadVideo(url, outputPath) - downloads the generated video to a local file path
4. If no API key is available, return a clear error message explaining which env var to set
5. Use async/await and proper error handling
6. Use module.exports at the end with all 3 functions
7. No duplicate variable or function names in the file
8. Use only built-in Node.js modules (https, fs, path) plus fetch for HTTP calls`,
    targetFile: 'video-gen.js',
    restartProcess: 'solomon-bot',
    status: 'pending',
    attempts: 0,
    priority: 6,
    createdAt: new Date().toISOString()
  },
  {
    id: genId('audiogen_v2'),
    type: 'self_upgrade',
    title: 'ElevenLabs Voice and Audio Generation',
    description: `Create a new file audio-gen.js. This module integrates with ElevenLabs API. Requirements:
1. Use process.env.ELEVENLABS_API_KEY for authentication
2. Export textToSpeech(text, voiceId, outputPath) - converts text to speech and saves as MP3 to outputPath. Default voiceId should be '21m00Tcm4TlvDq8ikWAM' (Rachel)
3. Export listVoices() - returns available voices from ElevenLabs API
4. Export cloneVoice(name, audioFilePath) - creates a voice clone from an audio file
5. If ELEVENLABS_API_KEY is not set, throw a clear error
6. Use the fetch API for HTTP calls
7. Use module.exports at the end with all 3 functions
8. No duplicate variable or function names in the file
9. No markdown code fences in the output`,
    targetFile: 'audio-gen.js',
    restartProcess: 'solomon-bot',
    status: 'pending',
    attempts: 0,
    priority: 5,
    createdAt: new Date().toISOString()
  },
  {
    id: genId('dataviz_v2'),
    type: 'self_upgrade',
    title: 'Data Visualization and Reporting',
    description: `Create a new file data-viz.js. This module generates charts and reports. Requirements:
1. Use the 'chartjs-node-canvas' npm package to render charts as PNG images
2. Export generateBarChart(labels, data, title, outputPath) - creates a bar chart PNG
3. Export generateLineChart(labels, data, title, outputPath) - creates a line chart PNG
4. Export generatePieChart(labels, data, title, outputPath) - creates a pie chart PNG
5. Each function should return the outputPath on success
6. Use 800x600 canvas size
7. Use module.exports at the end with all 3 functions
8. No duplicate variable or function names in the file`,
    targetFile: 'data-viz.js',
    restartProcess: 'solomon-bot',
    status: 'pending',
    attempts: 0,
    priority: 4,
    createdAt: new Date().toISOString()
  },
  {
    id: genId('browser_v2'),
    type: 'self_upgrade',
    title: 'Authenticated Browser Automation',
    description: `Create a new file browser-agent.js. This module implements browser automation. Requirements:
1. Use the 'playwright' npm package with chromium
2. Export launchBrowser(headless) - launches a Playwright browser instance, returns browser object
3. Export navigateTo(browser, url) - navigates to a URL and returns page text content
4. Export scrapeSelector(browser, url, cssSelector) - scrapes text from a CSS selector on a page
5. Export takeScreenshot(browser, url, outputPath) - takes a screenshot and saves to outputPath
6. Export closeBrowser(browser) - closes the browser instance
7. Handle errors gracefully - if playwright is not installed, return an error message
8. Use module.exports at the end with all 5 functions
9. No duplicate variable or function names in the file`,
    targetFile: 'browser-agent.js',
    restartProcess: 'solomon-bot',
    status: 'pending',
    attempts: 0,
    priority: 3,
    createdAt: new Date().toISOString()
  }
];

// Check which tasks are already done or pending
const existingTitles = new Set(q.tasks.map(t => t.title));
let added = 0;

requiredTasks.forEach(task => {
  // Check if a task with this title is already completed or pending
  const existing = q.tasks.find(t => t.title === task.title);
  if (!existing) {
    q.tasks.push(task);
    console.log(`ADDED: ${task.title}`);
    added++;
  } else if (existing.status === 'failed') {
    // Reset failed tasks
    existing.status = 'pending';
    existing.attempts = 0;
    existing.description = task.description; // Use improved description
    delete existing.failReason;
    delete existing.lastSyntaxError;
    console.log(`RESET (was failed): ${task.title}`);
    added++;
  } else {
    console.log(`SKIP (${existing.status}): ${task.title}`);
  }
});

fs.writeFileSync(queuePath, JSON.stringify(q, null, 2));
console.log(`\nDone. ${added} tasks added/reset.`);
