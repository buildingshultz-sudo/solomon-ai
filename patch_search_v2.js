/**
 * Patch script v2: Replaces webSearch in bot.js with Perplexity Sonar (via OpenRouter) as primary backend
 * with DuckDuckGo JSON API as fallback.
 * 
 * Perplexity Sonar is a live-web-search model that returns real URLs and snippets.
 * Cost: ~$0.005 per search query (very cheap).
 * 
 * Run on VPS: node /root/solomon-bot/patch_search_v2.js
 */
const fs = require('fs');
const path = require('path');

const BOT_FILE = path.join(__dirname, 'bot.js');
let code = fs.readFileSync(BOT_FILE, 'utf8');

// The new search implementation
const newSearchBlock = `
// ═══════════════════════════════════════════════════════════════════════════════
// WEB SEARCH v2 — Perplexity Sonar (live web) + DuckDuckGo JSON fallback
// ═══════════════════════════════════════════════════════════════════════════════

async function webSearch(query, maxResults = 5) {
  // Primary: Perplexity Sonar via OpenRouter (live web search with real URLs)
  const sonarResults = await _searchPerplexitySonar(query, maxResults);
  if (sonarResults.length > 0) {
    return { success: true, results: sonarResults, query, source: 'perplexity_sonar' };
  }
  
  // Fallback: DuckDuckGo JSON API (limited but always available)
  const ddgResults = await _searchDuckDuckGoJSON(query, maxResults);
  if (ddgResults.length > 0) {
    return { success: true, results: ddgResults, query, source: 'duckduckgo_json' };
  }
  
  console.log('[SEARCH] All backends returned 0 results for:', query);
  return { success: false, results: [], query, error: 'All search backends returned 0 results' };
}

async function _searchPerplexitySonar(query, maxResults = 5) {
  try {
    const res = await fetch(config.OPENROUTER_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(25000),
      headers: {
        'Authorization': \`Bearer \${config.OPENROUTER_API_KEY}\`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://solomon-bot.local',
        'X-Title': 'Sol Search'
      },
      body: JSON.stringify({
        model: 'perplexity/sonar',
        messages: [{
          role: 'user',
          content: \`Search the web for: \${query}\\n\\nReturn EXACTLY this JSON format (no other text, no markdown):\\n{"results": [{"title": "...", "url": "https://...", "snippet": "..."}]}\\n\\nReturn up to \${maxResults} results. Each must have a real URL from the web. Snippets should be 1-2 sentences summarizing the page content.\`
        }],
        max_tokens: 1000,
        temperature: 0.1
      })
    });
    
    if (!res.ok) {
      console.log('[SEARCH] Perplexity Sonar HTTP error:', res.status);
      return [];
    }
    
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) return [];
    
    // Parse JSON from response (handle markdown code fences)
    let cleanContent = content.trim();
    if (cleanContent.startsWith('\`\`\`')) {
      cleanContent = cleanContent.replace(/^\`\`\`(?:json)?\\n?/, '').replace(/\\n?\`\`\`$/, '');
    }
    
    const jsonMatch = cleanContent.match(/\\{[\\s\\S]*\\}/);
    if (!jsonMatch) {
      console.log('[SEARCH] Sonar response not JSON-parseable');
      // Try to extract results from natural language response
      return _extractResultsFromText(content, maxResults);
    }
    
    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.results && Array.isArray(parsed.results)) {
      return parsed.results
        .filter(r => r.title && r.url && r.url.startsWith('http'))
        .slice(0, maxResults)
        .map(r => ({
          title: r.title,
          url: r.url,
          snippet: r.snippet || ''
        }));
    }
    
    return [];
  } catch (e) {
    console.log('[SEARCH] Perplexity Sonar error:', e.message);
    return [];
  }
}

function _extractResultsFromText(text, maxResults = 5) {
  // Fallback: extract URLs and surrounding text from a natural language response
  const results = [];
  const urlRegex = /\\b(https?:\\/\\/[^\\s<>\"'\\)\\]]+)/g;
  let match;
  while ((match = urlRegex.exec(text)) !== null && results.length < maxResults) {
    const url = match[1].replace(/[.,;:!?]+$/, ''); // trim trailing punctuation
    // Get surrounding text as title/snippet
    const start = Math.max(0, match.index - 100);
    const end = Math.min(text.length, match.index + match[0].length + 100);
    const context = text.slice(start, end);
    // Try to find a title-like text before the URL
    const titleMatch = context.match(/\\*\\*([^*]+)\\*\\*/);
    const title = titleMatch ? titleMatch[1] : url.split('/').slice(2, 4).join('/');
    results.push({ title, url, snippet: context.replace(/\\*\\*/g, '').replace(url, '').trim().slice(0, 150) });
  }
  return results;
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
    
    if (data.AbstractText && data.AbstractURL) {
      results.push({ title: data.Heading || query, url: data.AbstractURL, snippet: data.AbstractText.slice(0, 200) });
    }
    
    if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
      for (const topic of data.RelatedTopics.slice(0, maxResults - results.length)) {
        if (topic.FirstURL && topic.Text) {
          results.push({ title: topic.Text.split(' - ')[0] || topic.Text.slice(0, 60), url: topic.FirstURL, snippet: topic.Text.slice(0, 200) });
        }
        if (topic.Topics && Array.isArray(topic.Topics)) {
          for (const sub of topic.Topics.slice(0, 2)) {
            if (sub.FirstURL && sub.Text && results.length < maxResults) {
              results.push({ title: sub.Text.split(' - ')[0], url: sub.FirstURL, snippet: sub.Text.slice(0, 200) });
            }
          }
        }
      }
    }
    
    if (data.Results && Array.isArray(data.Results)) {
      for (const r of data.Results.slice(0, maxResults - results.length)) {
        if (r.FirstURL && r.Text) {
          results.push({ title: r.Text.slice(0, 80), url: r.FirstURL, snippet: r.Text });
        }
      }
    }
    
    return results.slice(0, maxResults);
  } catch (e) {
    console.log('[SEARCH] DuckDuckGo JSON error:', e.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// END WEB SEARCH v2
// ═══════════════════════════════════════════════════════════════════════════════
`;

// ─── APPLY PATCH ─────────────────────────────────────────────────────────────

// Strategy: Find and replace both webSearch functions

// 1. Replace the SIMPLE webSearch at line ~265 (returns a string)
const simpleSearchMarker = 'async function webSearch(query) {';
const simpleSearchEnd = '// ─── IMAGE VISION';
const simpleIdx = code.indexOf(simpleSearchMarker);
const simpleEndIdx = code.indexOf(simpleSearchEnd, simpleIdx);

if (simpleIdx === -1) {
  console.error('ERROR: Cannot find simple webSearch function');
  process.exit(1);
}

// Replace simple webSearch with a wrapper that calls the structured version
const simpleReplacement = `async function webSearch(query) {
  // Simple search wrapper for inline use (returns formatted string for chat context)
  try {
    const result = await _webSearchStructured(query, 8);
    if (result.success && result.results.length > 0) {
      return result.results.map(r => \`• \${r.title}\\n  \${r.snippet}\\n  \${r.url}\`).join('\\n\\n');
    }
    return 'No results found. Try rephrasing.';
  } catch (e) { logError('search', e); return 'Search unavailable.'; }
}
`;

code = code.slice(0, simpleIdx) + simpleReplacement + code.slice(simpleEndIdx);

// 2. Now find and replace the STRUCTURED webSearch (the one with maxResults param)
// After our edit, we need to re-find it
const structuredMarker = 'async function webSearch(query, maxResults = 5) {';
const structuredIdx = code.indexOf(structuredMarker);

if (structuredIdx === -1) {
  console.error('ERROR: Cannot find structured webSearch function');
  process.exit(1);
}

// Find the end of the structured function block (next major section)
const structuredEndMarker = '// ─── DAVINCI RESOLVE CONTROL';
const structuredEndIdx = code.indexOf(structuredEndMarker, structuredIdx);

if (structuredEndIdx === -1) {
  console.error('ERROR: Cannot find end of structured webSearch');
  process.exit(1);
}

// Replace with our new implementation
// The structured version becomes _webSearchStructured (internal name)
// and webSearch(query, maxResults) calls it
const structuredReplacement = `async function webSearch(query, maxResults = 5) {
  return await _webSearchStructured(query, maxResults);
}

async function _webSearchStructured(query, maxResults = 5) {
  // Primary: Perplexity Sonar via OpenRouter (live web search with real URLs)
  const sonarResults = await _searchPerplexitySonar(query, maxResults);
  if (sonarResults.length > 0) {
    return { success: true, results: sonarResults, query, source: 'perplexity_sonar' };
  }
  
  // Fallback: DuckDuckGo JSON API (limited but always available)
  const ddgResults = await _searchDuckDuckGoJSON(query, maxResults);
  if (ddgResults.length > 0) {
    return { success: true, results: ddgResults, query, source: 'duckduckgo_json' };
  }
  
  console.log('[SEARCH] All backends returned 0 results for:', query);
  return { success: false, results: [], query, error: 'All search backends returned 0 results' };
}

async function _searchPerplexitySonar(query, maxResults = 5) {
  try {
    const res = await fetch(config.OPENROUTER_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(25000),
      headers: {
        'Authorization': \`Bearer \${config.OPENROUTER_API_KEY}\`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://solomon-bot.local',
        'X-Title': 'Sol Search'
      },
      body: JSON.stringify({
        model: 'perplexity/sonar',
        messages: [{
          role: 'user',
          content: \`Search the web for: \${query}\\n\\nReturn EXACTLY this JSON format (no other text, no markdown):\\n{"results": [{"title": "...", "url": "https://...", "snippet": "..."}]}\\n\\nReturn up to \${maxResults} results. Each must have a real URL from the web. Snippets should be 1-2 sentences summarizing the page content.\`
        }],
        max_tokens: 1000,
        temperature: 0.1
      })
    });
    
    if (!res.ok) {
      console.log('[SEARCH] Perplexity Sonar HTTP error:', res.status);
      return [];
    }
    
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) return [];
    
    // Parse JSON from response (handle markdown code fences)
    let cleanContent = content.trim();
    if (cleanContent.startsWith('\`\`\`')) {
      cleanContent = cleanContent.replace(/^\`\`\`(?:json)?\\n?/, '').replace(/\\n?\`\`\`$/, '');
    }
    
    const jsonMatch = cleanContent.match(/\\{[\\s\\S]*\\}/);
    if (!jsonMatch) {
      console.log('[SEARCH] Sonar response not JSON-parseable, extracting from text');
      return _extractResultsFromText(content, maxResults);
    }
    
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.results && Array.isArray(parsed.results)) {
        return parsed.results
          .filter(r => r.title && r.url && r.url.startsWith('http'))
          .slice(0, maxResults)
          .map(r => ({
            title: r.title,
            url: r.url,
            snippet: r.snippet || ''
          }));
      }
    } catch (parseErr) {
      console.log('[SEARCH] JSON parse failed:', parseErr.message);
      return _extractResultsFromText(content, maxResults);
    }
    
    return [];
  } catch (e) {
    console.log('[SEARCH] Perplexity Sonar error:', e.message);
    return [];
  }
}

function _extractResultsFromText(text, maxResults = 5) {
  const results = [];
  const urlRegex = /\\b(https?:\\/\\/[^\\s<>"'\\)\\]]+)/g;
  let match;
  while ((match = urlRegex.exec(text)) !== null && results.length < maxResults) {
    const url = match[1].replace(/[.,;:!?]+$/, '');
    const start = Math.max(0, match.index - 100);
    const end = Math.min(text.length, match.index + match[0].length + 100);
    const context = text.slice(start, end);
    const titleMatch = context.match(/\\*\\*([^*]+)\\*\\*/);
    const title = titleMatch ? titleMatch[1] : url.split('/').slice(2, 4).join('/');
    results.push({ title, url, snippet: context.replace(/\\*\\*/g, '').replace(url, '').trim().slice(0, 150) });
  }
  return results;
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
    if (data.AbstractText && data.AbstractURL) {
      results.push({ title: data.Heading || query, url: data.AbstractURL, snippet: data.AbstractText.slice(0, 200) });
    }
    if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
      for (const topic of data.RelatedTopics.slice(0, maxResults - results.length)) {
        if (topic.FirstURL && topic.Text) {
          results.push({ title: topic.Text.split(' - ')[0] || topic.Text.slice(0, 60), url: topic.FirstURL, snippet: topic.Text.slice(0, 200) });
        }
        if (topic.Topics && Array.isArray(topic.Topics)) {
          for (const sub of topic.Topics.slice(0, 2)) {
            if (sub.FirstURL && sub.Text && results.length < maxResults) {
              results.push({ title: sub.Text.split(' - ')[0], url: sub.FirstURL, snippet: sub.Text.slice(0, 200) });
            }
          }
        }
      }
    }
    return results.slice(0, maxResults);
  } catch (e) {
    console.log('[SEARCH] DuckDuckGo JSON error:', e.message);
    return [];
  }
}

`;

code = code.slice(0, structuredIdx) + structuredReplacement + code.slice(structuredEndIdx);

// Write the patched file
fs.writeFileSync(BOT_FILE, code, 'utf8');
console.log(`✅ bot.js patched with Perplexity Sonar search (${code.length} chars)`);
console.log('Search backends:');
console.log('  1. Perplexity Sonar (via OpenRouter) — live web search, real URLs');
console.log('  2. DuckDuckGo JSON API — fallback for when Sonar is unavailable');
console.log('');
console.log('Cost: ~$0.005 per search query via OpenRouter');
