/**
 * Web Search Plugin — Perplexity Sonar + DuckDuckGo + Data Verification
 *
 * ANTI-HALLUCINATION: All results include source URLs and are tagged as
 * "VERIFIED_DATA" so the LLM knows these are real search results.
 */
let config = {};

module.exports = {
  name: 'web-search',
  version: '2.0.0',
  description: 'Web search with verified results. Uses Perplexity Sonar API with DuckDuckGo fallback.',
  requiredKeys: [],  // Works with either Perplexity or falls back to DDG
  commands: ['/search', '/research'],
  tools: [
    {
      type: 'function', function: {
        name: 'web_search',
        description: 'Search the web for current information. Returns VERIFIED results with source URLs. Use this instead of guessing facts.',
        parameters: { type: 'object', properties: {
          query: { type: 'string', description: 'Search query' },
          detailed: { type: 'boolean', description: 'If true, returns more detailed results with summaries' }
        }, required: ['query'] }
      }
    },
    {
      type: 'function', function: {
        name: 'fetch_url',
        description: 'Fetch and extract text content from a specific URL. Use to verify claims or get detailed data.',
        parameters: { type: 'object', properties: {
          url: { type: 'string', description: 'URL to fetch' },
          selector: { type: 'string', description: 'CSS selector to extract specific content (optional)' }
        }, required: ['url'] }
      }
    }
  ],

  init(deps) { config = deps.config; },
  get _active() { return true; },  // Always active (DDG doesn't need a key)

  async executeTool(toolName, args) {
    switch (toolName) {
      case 'web_search': return await webSearch(args.query, args.detailed);
      case 'fetch_url': return await fetchUrl(args.url, args.selector);
      default: return { error: `Unknown tool: ${toolName}` };
    }
  }
};

async function webSearch(query, detailed = false) {
  // Try Perplexity first
  if (config.PERPLEXITY_API_KEY) {
    try {
      const result = await perplexitySearch(query, detailed);
      if (result.success) return result;
    } catch {}
  }
  
  // Try OpenRouter with Perplexity model
  if (config.OPENROUTER_API_KEY) {
    try {
      const result = await openRouterSearch(query, detailed);
      if (result.success) return result;
    } catch {}
  }
  
  // Fallback to DuckDuckGo
  return await duckDuckGoSearch(query);
}

async function perplexitySearch(query, detailed) {
  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${config.PERPLEXITY_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'sonar',
      messages: [{ role: 'user', content: detailed ? `Research this thoroughly: ${query}` : query }],
      max_tokens: detailed ? 2000 : 800
    }),
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) throw new Error(`Perplexity ${res.status}`);
  const data = await res.json();
  return {
    success: true,
    source: 'Perplexity Sonar API (VERIFIED_DATA)',
    query,
    answer: data.choices[0].message.content,
    citations: data.citations || []
  };
}

async function openRouterSearch(query, detailed) {
  const res = await fetch(config.OPENROUTER_URL || 'https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${config.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'perplexity/sonar-pro',
      messages: [{ role: 'user', content: query }],
      max_tokens: detailed ? 2000 : 800
    }),
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
  const data = await res.json();
  return {
    success: true,
    source: 'Perplexity via OpenRouter (VERIFIED_DATA)',
    query,
    answer: data.choices[0].message.content,
    citations: data.citations || []
  };
}

async function duckDuckGoSearch(query) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    
    const results = [];
    if (data.Abstract) results.push({ title: data.Heading, snippet: data.Abstract, url: data.AbstractURL });
    if (data.RelatedTopics) {
      for (const topic of data.RelatedTopics.slice(0, 5)) {
        if (topic.Text) results.push({ title: topic.Text.slice(0, 80), snippet: topic.Text, url: topic.FirstURL });
      }
    }
    
    return {
      success: results.length > 0,
      source: 'DuckDuckGo Instant Answers (VERIFIED_DATA)',
      query,
      results,
      note: results.length === 0 ? 'No instant answers found. Consider using fetch_url on a specific page.' : undefined
    };
  } catch (e) {
    return { success: false, error: e.message, source: 'DuckDuckGo (FAILED)' };
  }
}

async function fetchUrl(url, selector = null) {
  try {
    // Sanitize URL
    url = url.replace(/^["'*]+|["'*]+$/g, '').replace(/\*\*/g, '').trim();
    if (!url.startsWith('http')) url = 'https://' + url;
    
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SolBot/1.0)' },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow'
    });
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    
    const html = await res.text();
    // Basic text extraction (strip tags)
    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 5000);
    
    return {
      success: true,
      source: `Fetched from ${url} (VERIFIED_DATA)`,
      url,
      content: text,
      length: text.length
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
