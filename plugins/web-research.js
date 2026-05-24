const { chromium } = require('playwright');
async function executeWebResearch(urlsOrQueries) {
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
let results = [];
for (const target of urlsOrQueries) {
try {
// Basic heuristic: if it looks like a URL, navigate; else treat as
search query (e.g., via DuckDuckGo)
let url = target;
if (!target.startsWith('http')) {
url = `https://html.duckduckgo.com/html/?
q=${encodeURIComponent(target)}`;
}
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000
});
// Extract main text content (simplified for this example)
const textContent = await page.evaluate(() => {
// Remove script and style elements
document.querySelectorAll('script, style').forEach(el =>
el.remove());
return document.body.innerText.replace(/\n\s*\n/g, '\n').trim();
});
results.push({ target, content: textContent.substring(0, 5000) }); //
Limit to 5000 chars per page
} catch (error) {
results.push({ target, error: error.message });
}
}
await browser.close();
return results;
}
module.exports = {
name: 'web_research',
description: 'Visits URLs or performs searches to extract real-time web
content using Playwright headless browser.',
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