/**
 * Solomon Credential Learning Module
 * Extracts session data from PC Agent screenshots and browser state.
 */

const fs = require('fs');
const path = require('path');

async function learnFromPCState(taskId, result, deps) {
  const { addToKB } = deps.knowledgeBase;
  const { callLLM } = deps.core;

  if (!result.screenshot) return;

  console.log(`[CRED-LEARN] Analyzing state for task ${taskId}...`);

  // 1. Analyze screenshot for login state
  const analysis = await callLLM([
    { role: 'system', content: 'You are a visual analyst. Look at this screenshot of a browser and determine: 1. Is the user logged in? 2. What service is it? 3. Are there any visible account identifiers (email, username)?' },
    { role: 'user', content: [
      { type: 'text', text: 'Analyze this browser screenshot for login state.' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${result.screenshot}` } }
    ]}
  ], 'gpt-4o'); // Use vision model

  if (analysis.toLowerCase().includes('logged in')) {
    addToKB('authenticated_sessions', {
      service: analysis.match(/service:?\s*(\w+)/i)?.[1] || 'unknown',
      status: 'active',
      lastObserved: new Date().toISOString(),
      details: analysis
    });
    console.log(`[CRED-LEARN] Session detected and stored in KB.`);
  }

  // 2. Future: Queue cookie extraction command if logged in
  // (This would be a follow-up PC command to run a CDP script or document.cookie)
}

module.exports = { learnFromPCState };
