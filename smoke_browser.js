'use strict';
// smoke_browser.js — Smoke test for browse_url tool
// Run on VPS: node smoke_browser.js

const { executeTool } = require('./tools');

async function main() {
  console.log('🧪 Smoke test: browse_url → https://example.com');
  try {
    const result = await executeTool('browse_url', {
      url: 'https://example.com',
      action: 'get_text'
    });
    if (result.ok && result.text && result.text.includes('Example Domain')) {
      console.log('✅ browse_url get_text: PASS');
      console.log('   First 200 chars:', result.text.slice(0, 200).replace(/\n/g, ' '));
    } else if (result.ok) {
      console.log('⚠️  browse_url returned ok but text unexpected:', result.text?.slice(0, 100));
    } else {
      console.log('❌ browse_url FAILED:', result.error);
    }
  } catch (e) {
    console.log('❌ browse_url threw:', e.message);
  }

  console.log('\n🧪 Smoke test: browse_url → screenshot of example.com');
  try {
    const result = await executeTool('browse_url', {
      url: 'https://example.com',
      action: 'screenshot'
    });
    if (result.ok && result.path) {
      const fs = require('fs');
      const size = fs.statSync(result.path).size;
      console.log(`✅ browse_url screenshot: PASS (saved to ${result.path}, ${size} bytes)`);
    } else {
      console.log('❌ browse_url screenshot FAILED:', result.error);
    }
  } catch (e) {
    console.log('❌ browse_url screenshot threw:', e.message);
  }

  console.log('\n🧪 Smoke test: browser_interact → click on example.com');
  try {
    const result = await executeTool('browser_interact', {
      url: 'https://example.com',
      steps: [
        { action: 'get_text', selector: 'h1' },
        { action: 'screenshot' }
      ]
    });
    if (result.ok) {
      const h1Step = result.results.find(r => r.action === 'get_text');
      console.log(`✅ browser_interact: PASS (h1 text: "${h1Step?.text?.trim()}")`);
    } else {
      console.log('❌ browser_interact FAILED:', result.error);
    }
  } catch (e) {
    console.log('❌ browser_interact threw:', e.message);
  }

  console.log('\nSmoke tests complete.');
  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
