#!/usr/bin/env python3
"""
CRITICAL PATCH: Adds OpenAI function calling / tool_use to Sol's GPT calls.
This gives Sol the ability to ACTUALLY DO THINGS instead of just chatting.

Changes:
1. Adds a callLLMWithTools() function that supports function calling
2. Defines tool schemas for: queueTask, executePC, webSearch, getTaskStatus, scrapeURL
3. Replaces the handleText GPT call with the tool-use version
4. Adds a tool execution loop that processes tool calls and feeds results back to GPT
"""
import sys, subprocess

BOT_PATH = '/root/solomon-bot/bot.js'

with open(BOT_PATH, 'r') as f:
    bot = f.read()

# ── 1. Define the tools and the callLLMWithTools function ──────────────────────

TOOLS_AND_FUNCTION = '''
// ─── FUNCTION CALLING: Tool Definitions ───────────────────────────────────────
const SOL_TOOLS = [
  {
    type: "function",
    function: {
      name: "queue_task",
      description: "Queue a background task for Sol's worker to execute. Use this when Jed asks you to do something that requires time or background processing (research, scraping, file generation, code work). The task will be added to the work queue and processed automatically.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short descriptive title for the task" },
          type: { type: "string", enum: ["research", "scrape", "pc_command", "code_generation", "self_upgrade", "file_creation"], description: "Type of task" },
          description: { type: "string", description: "Detailed description of what needs to be done" },
          url: { type: "string", description: "URL to scrape (only for scrape type tasks)" },
          command: { type: "string", description: "PowerShell command (only for pc_command type tasks)" }
        },
        required: ["title", "type", "description"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "execute_pc_command",
      description: "Send a PowerShell command to Jed's PC via the PC Agent relay for IMMEDIATE execution. Use for quick commands that need to run on Jed's physical machine (open apps, check files, run scripts). Results come back within seconds.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The PowerShell command to execute on Jed's PC" },
          reason: { type: "string", description: "Brief reason why this command is needed" }
        },
        required: ["command"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web using Perplexity Sonar for real-time information. Use this for any research, product lookup, fact-checking, or information gathering. Returns structured results with URLs and snippets.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" },
          num_results: { type: "number", description: "Number of results to return (default 5, max 10)" }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_task_status",
      description: "Check the current state of Sol's task queue. Returns all pending, active, and recently completed tasks. Use this BEFORE reporting any progress to Jed.",
      parameters: { type: "object", properties: {}, required: [] }
    }
  },
  {
    type: "function",
    function: {
      name: "scrape_url",
      description: "Immediately scrape a URL using Playwright headless browser. Returns the page text content. Use for reading web pages, extracting data from dashboards, or checking product pages.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL to scrape" },
          selector: { type: "string", description: "Optional CSS selector to extract specific content" }
        },
        required: ["url"]
      }
    }
  }
];

// Execute a tool call and return the result
async function executeToolCall(toolCall) {
  const { name, arguments: argsStr } = toolCall.function;
  let args;
  try {
    args = JSON.parse(argsStr);
  } catch (e) {
    return { error: `Invalid JSON arguments: ${e.message}` };
  }
  
  console.log(`[TOOL] Executing: ${name}(${JSON.stringify(args).slice(0, 200)})`);
  
  switch (name) {
    case 'queue_task': {
      const fs = require('fs');
      const path = require('path');
      const qPath = path.join(__dirname, 'task-queue.json');
      const queue = JSON.parse(fs.readFileSync(qPath, 'utf8'));
      const tasks = queue.tasks || [];
      const newTask = {
        id: `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        title: args.title,
        type: args.type,
        description: args.description,
        status: 'pending',
        attempts: 0,
        priority: 10,
        createdAt: new Date().toISOString(),
        ...(args.url && { url: args.url }),
        ...(args.command && { command: args.command })
      };
      tasks.push(newTask);
      queue.tasks = tasks;
      fs.writeFileSync(qPath, JSON.stringify(queue, null, 2));
      console.log(`[TOOL] Task queued: ${newTask.id} - ${newTask.title}`);
      return { success: true, taskId: newTask.id, message: `Task "${args.title}" queued successfully. It will be processed by the worker on the next tick.` };
    }
    
    case 'execute_pc_command': {
      try {
        const result = await executeOnPC(args.command);
        return { success: result.success, output: (result.output || result.stdout || '').slice(0, 2000), reason: args.reason || '' };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
    
    case 'web_search': {
      try {
        const results = await webSearch(args.query, args.num_results || 5);
        return results;
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
    
    case 'get_task_status': {
      return getActiveTaskStatus();
    }
    
    case 'scrape_url': {
      try {
        const browserAgent = require('./browser-agent');
        const result = await browserAgent.navigateAndExtract(args.url, args.selector || 'body');
        return { success: true, content: (result || '').slice(0, 3000) };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
    
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// Call LLM with function calling support — loops until GPT gives a final text response
async function callLLMWithTools(messages, model = config.MODEL, maxToolCalls = 5) {
  let toolCallCount = 0;
  
  while (toolCallCount < maxToolCalls) {
    try {
      console.log(`[LLM+TOOLS] Calling ${model} (tool loop ${toolCallCount})`);
      const res = await fetch(config.OPENROUTER_URL, {
        method: 'POST',
        signal: AbortSignal.timeout(45000),
        headers: {
          'Authorization': `Bearer ${config.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://solomon-bot.local',
          'X-Title': 'Sol Bot'
        },
        body: JSON.stringify({
          model,
          messages,
          tools: SOL_TOOLS,
          tool_choice: 'auto',
          max_tokens: 4096,
          temperature: 0.7
        })
      });
      
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`OpenRouter ${res.status}: ${errText}`);
      }
      
      const data = await res.json();
      const choice = data.choices?.[0];
      
      if (!choice) throw new Error('Empty LLM response');
      
      const msg = choice.message;
      
      // If GPT wants to call tools
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        toolCallCount++;
        console.log(`[LLM+TOOLS] GPT requested ${msg.tool_calls.length} tool call(s)`);
        
        // Add the assistant message with tool calls to the conversation
        messages.push(msg);
        
        // Execute each tool call and add results
        for (const tc of msg.tool_calls) {
          const result = await executeToolCall(tc);
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(result)
          });
          console.log(`[LLM+TOOLS] Tool ${tc.function.name} result: ${JSON.stringify(result).slice(0, 200)}`);
        }
        
        // Continue the loop — GPT will see the tool results and either call more tools or respond
        continue;
      }
      
      // GPT gave a final text response (no more tool calls)
      const content = msg.content;
      if (!content) throw new Error('Empty content in final response');
      console.log(`[LLM+TOOLS] Final response (${content.length} chars, ${toolCallCount} tool calls made)`);
      return content;
      
    } catch (e) {
      logError(`llm_tools_${toolCallCount}`, e);
      // On error, try fallback model without tools (simple text response)
      if (toolCallCount === 0) {
        console.log('[LLM+TOOLS] Falling back to simple callLLM (no tools)');
        return await callLLM(messages, config.MODEL_FALLBACK, 0);
      }
      throw e;
    }
  }
  
  // Max tool calls reached — force a final response without tools
  console.log('[LLM+TOOLS] Max tool calls reached, forcing final response');
  return await callLLM(messages, model, 0);
}
'''

# ── 2. Insert the tools code after the existing callLLM function ───────────────

# Find the end of callLLM function
callllm_marker = '// ─── LLM CALL ─────────────────────────────────────────────────────────────────'
if callllm_marker not in bot:
    print('[FAIL] Could not find callLLM marker')
    sys.exit(1)

# Find the end of the callLLM function (next section marker or function)
callllm_idx = bot.find(callllm_marker)
# Find the next major section after callLLM
next_section_markers = [
    '// ─── AUTO PC COMMAND',
    '// ─── WEB SEARCH',
    '// ─── KNOWLEDGE',
    '// ─── HEALTH',
    'async function handleText',
]
insert_pos = None
for marker in next_section_markers:
    pos = bot.find(marker, callllm_idx + 100)
    if pos > 0:
        if insert_pos is None or pos < insert_pos:
            insert_pos = pos
        break

if insert_pos is None:
    print('[FAIL] Could not find insertion point after callLLM')
    sys.exit(1)

# Check if already patched
if 'SOL_TOOLS' in bot:
    print('[SKIP] Function calling already present in bot.js')
else:
    bot = bot[:insert_pos] + TOOLS_AND_FUNCTION + '\n' + bot[insert_pos:]
    print(f'[OK] Inserted SOL_TOOLS and callLLMWithTools at position {insert_pos}')

# ── 3. Replace the GPT call in handleText to use callLLMWithTools ──────────────

# Replace the simple callLLM call with callLLMWithTools
old_call = 'rawReply = await callLLM(messages);'
new_call = 'rawReply = await callLLMWithTools(messages);'

# Only replace the FIRST occurrence in handleText (not in other functions)
handletext_idx = bot.find('async function handleText')
if handletext_idx > 0:
    first_call_in_handletext = bot.find(old_call, handletext_idx)
    if first_call_in_handletext > 0:
        bot = bot[:first_call_in_handletext] + new_call + bot[first_call_in_handletext + len(old_call):]
        print('[OK] Replaced callLLM with callLLMWithTools in handleText')
    else:
        if new_call in bot[handletext_idx:handletext_idx+2000]:
            print('[SKIP] callLLMWithTools already in handleText')
        else:
            print('[WARN] Could not find callLLM call in handleText')

with open(BOT_PATH, 'w') as f:
    f.write(bot)
print('[OK] bot.js written')

# ── 4. Syntax validation ──────────────────────────────────────────────────────
result = subprocess.run(['node', '--check', BOT_PATH], capture_output=True, text=True)
if result.returncode == 0:
    print('[OK] bot.js syntax check passed')
else:
    print(f'[FAIL] Syntax error: {result.stderr}')
    sys.exit(1)

print('[DONE] Function calling patch applied successfully')
