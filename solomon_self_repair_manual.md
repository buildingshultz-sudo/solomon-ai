# Solomon Self-Repair Manual v1.0

This manual contains critical self-repair instructions for Solomon (Node.js Telegram bot v6.1 running via PM2 on Ubuntu). You must read this document carefully and execute the exact code changes provided to fix known issues in your system.

## Problem 1: Research Tasks Are Hallucinated

Your CrewAI agents lack internet access, causing them to hallucinate research content based on training data.

**FIX:** You must route research tasks through a new Playwright browser plugin instead of CrewAI's research agent.

### Step 1: Create the Web Research Tool
Create a new file at `/root/solomon-bot/plugins/web-research.js` with the following code:

```javascript
const { chromium } = require('playwright');

async function executeWebResearch(urlsOrQueries) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  let results = [];

  for (const target of urlsOrQueries) {
    try {
      // Basic heuristic: if it looks like a URL, navigate; else treat as search query (e.g., via DuckDuckGo)
      let url = target;
      if (!target.startsWith('http')) {
        url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(target)}`;
      }
      
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      
      // Extract main text content (simplified for this example)
      const textContent = await page.evaluate(() => {
        // Remove script and style elements
        document.querySelectorAll('script, style').forEach(el => el.remove());
        return document.body.innerText.replace(/\n\s*\n/g, '\n').trim();
      });
      
      results.push({ target, content: textContent.substring(0, 5000) }); // Limit to 5000 chars per page
    } catch (error) {
      results.push({ target, error: error.message });
    }
  }

  await browser.close();
  return results;
}

module.exports = {
  name: 'web_research',
  description: 'Visits URLs or performs searches to extract real-time web content using Playwright headless browser.',
  parameters: {
    type: 'object',
    properties: {
      targets: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of URLs to visit or search queries to look up.'
      }
    },
    required: ['targets']
  },
  execute: async (args) => {
    return await executeWebResearch(args.targets);
  }
};
```

### Step 2: Register the Tool
Update your main tool registry (e.g., in `bot.js` or `plugin-manager.js`) to include the new `web-research.js` plugin and instruct your LLM brain to use `web_research` instead of queuing CrewAI tasks for information gathering.

## Problem 2: Image Generation Quality

Your LLM brain writes vague prompts even with the prompt enhancer.

**FIX:** Update the system message in the prompt enhancer to force aggressive, highly detailed visual language.

### Step 1: Update the Prompt Enhancer
Open `/root/solomon-bot/plugins/openai.js` and locate the `promptEnhancer` function. Replace the system message with the following exact text:

```javascript
// Replace the existing system message in promptEnhancer with this:
const enhancerSystemMessage = `You are an expert prompt engineer for advanced AI image generators. Your sole purpose is to transform vague user requests into hyper-detailed, technical, and highly descriptive image prompts.

You MUST follow these strict rules:
1. Prompts MUST be at least 100 words long.
2. You MUST specify exact camera details (e.g., lens type, focal length, aperture, shot angle).
3. You MUST describe lighting meticulously (e.g., direction, source, color temperature, shadows).
4. You MUST include color palette, texture details, and composition rules.
5. You MUST describe the mood and atmosphere vividly.

Example of a BAD prompt: "A cinematic moody workshop with dark lighting and warm amber highlights"

Example of a GOOD prompt: "Ultra-wide 16mm lens photograph of a craftsman's workshop shot from hip height. Warm amber tungsten under-cabinet LED strips cast pools of golden light across a weathered maple workbench. Background: pegboard wall with organized Makita teal and Milwaukee red power tools creating color contrast. Wood plank ceiling with visible grain texture. Diamond-plate steel cabinet faces reflect ambient light. A red fire extinguisher provides a color accent in the mid-ground. Shallow depth of field, f/2.8, cinematic color grading with lifted blacks and orange-teal split toning. Atmosphere: sawdust particles visible in light beams. Mood: productive solitude, quiet confidence."

Transform the user's request into a GOOD prompt following these rules.`;
```

## Problem 3: Task Queue Says "Proceeding" But Doesn't Execute

You sometimes respond conversationally with action words without actually calling the required tools.

**FIX:** Add a post-response validator in `bot.js`.

### Step 1: Add Validator in `bot.js`
Locate the message handler function in `bot.js`, right after the OpenRouter API response is parsed and before the message is sent to the user. Insert the following code:

```javascript
// Insert this after parsing OpenRouter response (let's assume 'responseMessage' is the LLM's message object)
const actionWords = ["I'll", "Let me", "proceeding", "immediately", "right away", "working on it"];
const responseText = responseMessage.content || "";
const hasToolCalls = responseMessage.tool_calls && responseMessage.tool_calls.length > 0;

const containsActionWord = actionWords.some(word => responseText.toLowerCase().includes(word.toLowerCase()));

if (containsActionWord && !hasToolCalls) {
    // Force a second LLM call
    messages.push(responseMessage); // Add the problematic response to history
    messages.push({
        role: "user",
        content: "You said you would do something but didn't call any tools. Call the appropriate tool NOW."
    });
    
    // Re-call the LLM API here (pseudo-code, adapt to your actual API call method)
    // const newResponse = await callOpenRouterAPI(messages, tools);
    // responseMessage = newResponse;
}
```

## Problem 4: Self-Patch Breaks Files

The `self_patch` tool previously overwrote entire files, breaking syntax.

**FIX:** Update the `self_patch` tool to enforce strict safety protocols including targeted replacements and syntax checking.

### Step 1: Update `/root/solomon-bot/plugins/self-patch.js`
Replace the contents of the file with this safe version:

```javascript
const fs = require('fs');
const { execSync } = require('child_process');

module.exports = {
  name: 'self_patch',
  description: 'Safely patches source code files using targeted find/replace with syntax validation.',
  parameters: {
    type: 'object',
    properties: {
      filepath: { type: 'string', description: 'Absolute path to the file to patch.' },
      find: { type: 'string', description: 'Exact string to find in the file.' },
      replace: { type: 'string', description: 'String to replace the found text with.' }
    },
    required: ['filepath', 'find', 'replace']
  },
  execute: async (args) => {
    const { filepath, find, replace } = args;
    
    if (!fs.existsSync(filepath)) {
      return { success: false, error: `File not found: ${filepath}` };
    }

    const originalContent = fs.readFileSync(filepath, 'utf8');
    
    if (!originalContent.includes(find)) {
      return { success: false, error: 'Find string not found in file. Use read_source_file to check exact contents.' };
    }

    const newContent = originalContent.replace(find, replace);
    
    // Write the patch
    fs.writeFileSync(filepath, newContent, 'utf8');

    // Syntax validation
    try {
      if (filepath.endsWith('.js')) {
        execSync(`node -c ${filepath}`);
      } else if (filepath.endsWith('.py')) {
        execSync(`python3 -c "import ast; ast.parse(open('${filepath}').read())"`);
      }
      return { success: true, message: `Successfully patched ${filepath} and passed syntax check.` };
    } catch (error) {
      // Revert on failure
      fs.writeFileSync(filepath, originalContent, 'utf8');
      return { success: false, error: `Syntax check failed. Reverted changes. Error: ${error.message}` };
    }
  }
};
```

## Problem 5: Spam Messages (Multiple Images Per Request)

You were sending one image per reference photo instead of bundling them.

**FIX:** Add a rule to your system prompt regarding multiple reference photos.

### Step 1: Update System Prompt/Memory
Add the following exact rule to your core system instructions (usually in `bot.js` or wherever the main system prompt is defined):

```text
When generating images with multiple reference photos, use ALL photos in a SINGLE generate_image call with all paths in the reference_images array. Never loop through photos individually. Only generate ONE image per user request unless explicitly asked for multiple.
```

## Problem 6: Wrong Aspect Ratios

You generate 1024x1024 images for everything.

**FIX:** Update `generate_image` parameter validation to auto-detect sizes based on context.

### Step 1: Update `generate_image` Tool
In your image generation plugin, add this logic before making the API call:

```javascript
// Add this helper function to your image generation tool
function determineSize(prompt) {
  const p = prompt.toLowerCase();
  if (p.includes('wallpaper')) return '1536x1024';
  if (p.includes('thumbnail') || p.includes('youtube')) return '1280x720';
  if (p.includes('story') || p.includes('reel') || p.includes('tiktok')) return '1080x1920';
  if (p.includes('banner')) return '1500x500';
  if (p.includes('marketing') || p.includes('og image')) return '1200x630';
  return '1080x1080'; // Default square for Instagram/general
}

// In the execute function of your generate_image tool:
// args.size = determineSize(args.prompt);
```
Ensure your system prompt also includes these size rules so the LLM is aware of the supported dimensions.

---

## How To Apply This Manual (Execution Checklist)

Solomon, you MUST follow this numbered step-by-step execution checklist:

1. Read this entire document first before making any changes.
2. For each problem section, use `read_source_file` to read the relevant file.
3. Use `self_patch` with TARGETED find/replace changes (not full file overwrite).
4. After each patch, run the appropriate syntax check (`node -c` for .js, python3 ast check for .py).
5. If syntax check fails, revert immediately and try again with corrected code.
6. Commit each successful patch with a descriptive message like "fix: [problem description]".
7. After ALL patches are applied successfully, restart via: `pm2 restart 1`
8. Test each fix with a sample task:
   - **Research:** "Research what Manus AI can do" (should use Playwright, not CrewAI)
   - **Image:** "Generate a YouTube thumbnail for a woodworking video" (should be 1280x720 with detailed prompt)
   - **Task queue:** "Create a content calendar for next week" (should queue_task immediately)
   - **Self-patch:** "Add a console.log to your startup" (should not break any files)
9. Report all test results to Jed via Telegram.
