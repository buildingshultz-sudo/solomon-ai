/**
 * vidIQ Plugin — YouTube SEO Optimization
 */
let apiKey = '';

module.exports = {
  name: 'vidiq',
  version: '1.0.0',
  description: 'vidIQ YouTube SEO: keyword research, competition scores, tag suggestions',
  requiredKeys: ['VIDIQ_API_KEY'],
  commands: ['/seo', '/keywords'],
  tools: [
    {
      type: 'function', function: {
        name: 'vidiq_keyword_research',
        description: 'Research YouTube keywords with search volume and competition data',
        parameters: { type: 'object', properties: {
          keyword: { type: 'string', description: 'Keyword to research' }
        }, required: ['keyword'] }
      }
    },
    {
      type: 'function', function: {
        name: 'vidiq_tag_suggestions',
        description: 'Get tag suggestions for a YouTube video topic',
        parameters: { type: 'object', properties: {
          topic: { type: 'string', description: 'Video topic' }
        }, required: ['topic'] }
      }
    }
  ],

  init(deps) { apiKey = deps.config.VIDIQ_API_KEY; },

  async executeTool(toolName, args) {
    switch (toolName) {
      case 'vidiq_keyword_research': return await keywordResearch(args.keyword);
      case 'vidiq_tag_suggestions': return await tagSuggestions(args.topic);
      default: return { error: `Unknown tool: ${toolName}` };
    }
  }
};

async function keywordResearch(keyword) {
  try {
    const res = await fetch(`https://app.vidiq.com/api/keywords?q=${encodeURIComponent(keyword)}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) throw new Error(`vidIQ ${res.status}`);
    const data = await res.json();
    return { success: true, source: 'vidIQ API (REAL DATA)', keyword, data };
  } catch (e) { return { success: false, error: e.message }; }
}

async function tagSuggestions(topic) {
  try {
    const res = await fetch(`https://app.vidiq.com/api/tags?q=${encodeURIComponent(topic)}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) throw new Error(`vidIQ ${res.status}`);
    const data = await res.json();
    return { success: true, source: 'vidIQ API (REAL DATA)', topic, tags: data };
  } catch (e) { return { success: false, error: e.message }; }
}
