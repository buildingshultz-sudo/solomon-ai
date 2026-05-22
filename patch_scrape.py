#!/usr/bin/env python3
"""Add a 'scrape' task type handler to worker.js that uses browser-agent.js (Playwright)."""
import sys, subprocess

WORKER_PATH = '/root/solomon-bot/worker.js'

with open(WORKER_PATH, 'r') as f:
    worker = f.read()

# Check if scrape handler already exists
if "case 'scrape':" in worker:
    print('[SKIP] Scrape handler already exists in worker.js')
else:
    # Add 'scrape' case to the switch statement, right after the browser_action case
    old_switch = """        case 'browser_action':
          result = await executeBrowserTask(task);
          break;"""
    new_switch = """        case 'browser_action':
          result = await executeBrowserTask(task);
          break;
        case 'scrape':
          result = await executeScrapeTask(task);
          break;"""
    
    if old_switch in worker:
        worker = worker.replace(old_switch, new_switch)
        print('[OK] Added scrape case to switch statement')
    else:
        print('[FAIL] Could not find browser_action case in switch')
        sys.exit(1)

    # Add the executeScrapeTask function after executeBrowserTask
    scrape_fn = '''
  async function executeScrapeTask(task) {
    const url = task.url || task.description;
    const selector = task.selector || 'body';
    console.log(`[WORKER] Scraping: ${url} (selector: ${selector})`);
    
    try {
      const browserAgent = require('./browser-agent');
      const content = await browserAgent.navigateAndExtract(url, selector);
      if (!content || content.length < 50) {
        throw new Error('Scrape returned insufficient content');
      }
      
      // If the task has a synthesis prompt, use LLM to process the scraped data
      if (task.synthesize !== false) {
        const synthesis = await callLLM([
          { role: 'system', content: 'You are a data extraction specialist. Analyze the scraped content and extract the key information requested. Be structured and precise.' },
          { role: 'user', content: `Task: ${task.title}\\nDescription: ${task.description}\\n\\nScraped content from ${url}:\\n${content.slice(0, 6000)}` }
        ]);
        return `🔍 Scrape Results: ${task.title}\\nSource: ${url}\\n\\n${synthesis}`;
      }
      
      return `🔍 Scraped ${url}:\\n${content.slice(0, 3000)}`;
    } catch (e) {
      // Fallback: try using webSearch about the URL content
      console.log(`[WORKER] Playwright scrape failed (${e.message}), falling back to web search`);
      const searchResult = await webSearch(`site:${url} ${task.title}`, 5);
      if (searchResult && searchResult.results && searchResult.results.length > 0) {
        const summary = searchResult.results.map(r => `- ${r.title}: ${r.snippet}`).join('\\n');
        return `🔍 Web search fallback for ${url}:\\n${summary}`;
      }
      throw new Error(`Scrape failed: ${e.message}`);
    }
  }
'''
    
    # Insert after executeBrowserTask
    insert_after = "    return result.output;\n  }\n  async function executeFileTask"
    if insert_after in worker:
        worker = worker.replace(insert_after, "    return result.output;\n  }\n" + scrape_fn + "\n  async function executeFileTask")
        print('[OK] Added executeScrapeTask function')
    else:
        # Try alternate insertion point
        alt_insert = "  async function executeFileTask"
        if alt_insert in worker:
            worker = worker.replace(alt_insert, scrape_fn + "\n  async function executeFileTask")
            print('[OK] Added executeScrapeTask function (alternate position)')
        else:
            print('[FAIL] Could not find insertion point for executeScrapeTask')
            sys.exit(1)

with open(WORKER_PATH, 'w') as f:
    f.write(worker)
print('[OK] worker.js written')

# Validate
result = subprocess.run(['node', '--check', WORKER_PATH], capture_output=True, text=True)
if result.returncode == 0:
    print('[OK] worker.js syntax check passed')
else:
    print(f'[FAIL] Syntax error: {result.stderr}')
    sys.exit(1)

print('[DONE] Worker scrape handler added')
