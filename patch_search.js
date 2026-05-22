/**
 * Patch script: Replaces both webSearch functions in bot.js with a robust multi-backend search
 * that uses DuckDuckGo JSON API, DuckDuckGo HTML scraping, and Brave Search as fallbacks.
 * 
 * Run on VPS: node /root/solomon-bot/patch_search.js
 */
const fs = require('fs');
const path = require('path');

const BOT_FILE = path.join(__dirname, 'bot.js');
let code = fs.readFileSync(BOT_FILE, 'utf8');

// The new robust webSearch function (replaces the one at line 1556)
const newWebSearch = `async function webSearch(query, maxResults = 5) {
  // Multi-backend search with automatic fallback
  // Priority: 1) DuckDuckGo HTML  2) Brave Search  3) DuckDuckGo JSON API
  
  const results = await _searchDuckDuckGoHTML(query, maxResults);
  if (results.length > 0) return { success: true, results, query, source: 'duckduckgo_html' };
  
  // Fallback: Brave Search (no API key needed for basic web search)
  const braveResults = await _searchBrave(query, maxResults);
  if (braveResults.length > 0) return { success: true, results: braveResults, query, source: 'brave' };
  
  // Final fallback: DuckDuckGo JSON (limited but stable)
  const ddgResults = await _searchDuckDuckGoJSON(query, maxResults);
  if (ddgResults.length > 0) return { success: true, results: ddgResults, query, source: 'duckduckgo_json' };
  
  console.log('[SEARCH] All backends returned 0 results for:', query);
  return { success: false, results: [], query, error: 'All search backends returned 0 results' };
}

async function _searchDuckDuckGoHTML(query, maxResults = 5) {
  try {
    const url = \`https://html.duckduckgo.com/html/?q=\${encodeURIComponent(query)}\`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    if (!res.ok) return [];
    const html = await res.text();
    
    const results = [];
    
    // Primary regex: matches the standard DuckDuckGo result structure
    const resultRegex = /<a rel="nofollow"[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\\/a>[\\s\\S]*?<a[^>]*class="result__snippet"[^>]*>([\\s\\S]*?)<\\/a>/g;
    let match;
    while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
      const href = match[1];
      const title = match[2].replace(/<[^>]+>/g, '').trim();
      const snippet = match[3].replace(/<[^>]+>/g, '').trim();
      let realUrl = href;
      if (href.includes('uddg=')) {
        try { realUrl = decodeURIComponent(href.split('uddg=')[1].split('&')[0]); } catch {}
      }
      if (title && realUrl) results.push({ title, url: realUrl, snippet });
    }
    
    // Fallback regex if primary didn't match (DuckDuckGo sometimes changes HTML)
    if (results.length === 0) {
      const altRegex = /<a[^>]*href="([^"]*uddg=[^"]+)"[^>]*>([^<]+)<\\/a>/g;
      const snippetBlocks = html.match(/<td[^>]*class="result-snippet"[^>]*>([^<]*)<\\/td>/g) || [];
      let altMatch;
      let idx = 0;
      while ((altMatch = altRegex.exec(html)) !== null && results.length < maxResults) {
        let realUrl = altMatch[1];
        if (realUrl.includes('uddg=')) {
          try { realUrl = decodeURIComponent(realUrl.split('uddg=')[1].split('&')[0]); } catch {}
        }
        const title = altMatch[2].trim();
        const snippet = snippetBlocks[idx] ? snippetBlocks[idx].replace(/<[^>]+>/g, '').trim() : '';
        if (title && realUrl && !realUrl.includes('duckduckgo.com')) {
          results.push({ title, url: realUrl, snippet });
        }
        idx++;
      }
    }
    
    return results;
  } catch (e) {
    console.log('[SEARCH] DuckDuckGo HTML failed:', e.message);
    return [];
  }
}

async function _searchBrave(query, maxResults = 5) {
  try {
    // Brave Search has a web endpoint that returns JSON-like structured data
    const url = \`https://search.brave.com/api/suggest?q=\${encodeURIComponent(query)}&rich=true\`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    });
    if (!res.ok) return [];
    const data = await res.json();
    
    // Brave suggest API returns rich results
    const results = [];
    if (data && Array.isArray(data)) {
      // The suggest API returns arrays of suggestions
      for (const item of data.slice(0, maxResults)) {
        if (typeof item === 'object' && item.url) {
          results.push({ title: item.title || item.q || query, url: item.url, snippet: item.desc || '' });
        }
      }
    }
    return results;
  } catch (e) {
    console.log('[SEARCH] Brave failed:', e.message);
    return [];
  }
}

async function _searchDuckDuckGoJSON(query, maxResults = 5) {
  try {
    const url = \`https://api.duckduckgo.com/?q=\${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1\`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SolBot/1.0)' }
    });
    if (!res.ok) return [];
    const data = await res.json();
    
    const results = [];
    
    // Abstract (Wikipedia-style summary)
    if (data.AbstractText && data.AbstractURL) {
      results.push({ title: data.Heading || query, url: data.AbstractURL, snippet: data.AbstractText.slice(0, 200) });
    }
    
    // Related topics
    if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
      for (const topic of data.RelatedTopics.slice(0, maxResults - results.length)) {
        if (topic.FirstURL && topic.Text) {
          results.push({ title: topic.Text.split(' - ')[0] || topic.Text.slice(0, 60), url: topic.FirstURL, snippet: topic.Text.slice(0, 200) });
        }
        // Handle nested topics (categories)
        if (topic.Topics && Array.isArray(topic.Topics)) {
          for (const sub of topic.Topics.slice(0, 2)) {
            if (sub.FirstURL && sub.Text) {
              results.push({ title: sub.Text.split(' - ')[0] || sub.Text.slice(0, 60), url: sub.FirstURL, snippet: sub.Text.slice(0, 200) });
            }
          }
        }
      }
    }
    
    // Results section
    if (data.Results && Array.isArray(data.Results)) {
      for (const r of data.Results.slice(0, maxResults - results.length)) {
        if (r.FirstURL && r.Text) {
          results.push({ title: r.Text.slice(0, 80), url: r.FirstURL, snippet: r.Text });
        }
      }
    }
    
    return results.slice(0, maxResults);
  } catch (e) {
    console.log('[SEARCH] DuckDuckGo JSON failed:', e.message);
    return [];
  }
}`;

// The simple webSearch replacement (for the one at line 265 that returns a string)
const newSimpleWebSearch = `async function webSearch(query) {
  // Simple search wrapper that returns a formatted string (for inline use)
  const result = await webSearchStructured(query, 8);
  if (result.success && result.results.length > 0) {
    return result.results.map(r => \`• \${r.title}\\n  \${r.snippet}\\n  \${r.url}\`).join('\\n\\n');
  }
  return 'No results found. Try rephrasing.';
}

async function webSearchStructured(query, maxResults = 5) {
  return await _webSearchMultiBackend(query, maxResults);
}`;

// Now do the replacement
// First, replace the FULL webSearch at line 1556 (the structured one used by worker)
// Find the function boundary
const structuredSearchStart = code.indexOf('async function webSearch(query, maxResults = 5) {');
if (structuredSearchStart === -1) {
  console.error('ERROR: Could not find structured webSearch function');
  process.exit(1);
}

// Find the end of this function (next function definition at same indent level)
const afterStructuredSearch = code.indexOf('\n// ─── DAVINCI RESOLVE CONTROL', structuredSearchStart);
if (afterStructuredSearch === -1) {
  console.error('ERROR: Could not find end marker for structured webSearch');
  process.exit(1);
}

// Replace the structured webSearch with the new multi-backend version
const beforeStructured = code.slice(0, structuredSearchStart);
const afterStructured = code.slice(afterStructuredSearch);

// Rename the new function to match what the worker expects
const renamedNewSearch = newWebSearch.replace(
  'async function webSearch(query, maxResults = 5) {',
  'async function _webSearchMultiBackend(query, maxResults = 5) {'
);

code = beforeStructured + `async function webSearch(query, maxResults = 5) {
  return await _webSearchMultiBackend(query, maxResults);
}

${renamedNewSearch}
` + afterStructured;

// Now replace the simple webSearch at line 265
const simpleSearchStart = code.indexOf('async function webSearch(query) {');
if (simpleSearchStart === -1) {
  console.log('WARNING: Simple webSearch already replaced or not found');
} else {
  // Find the end of this function
  const simpleSearchEnd = code.indexOf('\n// ─── IMAGE VISION', simpleSearchStart);
  if (simpleSearchEnd !== -1) {
    const beforeSimple = code.slice(0, simpleSearchStart);
    const afterSimple = code.slice(simpleSearchEnd);
    code = beforeSimple + `async function webSearch(query) {
  // Simple search wrapper for inline use (returns formatted string)
  try {
    const result = await _webSearchMultiBackend(query, 8);
    if (result.success && result.results.length > 0) {
      return result.results.map(r => \`• \${r.title}\\n  \${r.snippet}\\n  \${r.url}\`).join('\\n\\n');
    }
    return 'No results found. Try rephrasing.';
  } catch (e) { logError('search', e); return 'Search unavailable.'; }
}
` + afterSimple;
  }
}

// Write the patched file
fs.writeFileSync(BOT_FILE, code, 'utf8');
console.log(`✅ bot.js patched successfully (${code.length} chars)`);
console.log('Changes:');
console.log('  - Replaced simple webSearch (line ~265) with multi-backend wrapper');
console.log('  - Replaced structured webSearch (line ~1556) with multi-backend implementation');
console.log('  - Added _searchDuckDuckGoHTML, _searchBrave, _searchDuckDuckGoJSON backends');
console.log('  - Added _webSearchMultiBackend orchestrator with automatic fallback');
