'use strict';

const fs = require('fs');
const path = require('path');

const STORE_FILE = path.join(__dirname, 'vector-memory-store.json');
let chromaClient = null;
let collection = null;
let useChroma = false;

// Initialize vector memory — tries ChromaDB, falls back to JSON
async function initVectorMemory() {
  try {
    const { ChromaClient } = require('chromadb');
    chromaClient = new ChromaClient();
    collection = await chromaClient.getOrCreateCollection({ name: 'solomon_memory' });
    useChroma = true;
    console.log('[VECTOR] ChromaDB initialized');
    return { backend: 'chromadb' };
  } catch (err) {
    console.log('[VECTOR] ChromaDB unavailable, using JSON fallback:', err.message);
    useChroma = false;
    if (!fs.existsSync(STORE_FILE)) {
      fs.writeFileSync(STORE_FILE, JSON.stringify({ entries: [] }, null, 2));
    }
    return { backend: 'json' };
  }
}

// Add a memory entry
async function addMemory(text, metadata) {
  const id = 'mem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

  if (useChroma && collection) {
    await collection.add({
      ids: [id],
      documents: [text],
      metadatas: [metadata || {}]
    });
    return { id, backend: 'chromadb' };
  }

  // JSON fallback
  const store = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  store.entries.push({
    id,
    text,
    metadata: metadata || {},
    createdAt: new Date().toISOString()
  });
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
  return { id, backend: 'json' };
}

// Search memories by semantic similarity (ChromaDB) or keyword (JSON fallback)
async function searchMemory(query, nResults) {
  const limit = nResults || 5;

  if (useChroma && collection) {
    const results = await collection.query({
      queryTexts: [query],
      nResults: limit
    });
    return {
      backend: 'chromadb',
      results: (results.documents[0] || []).map((doc, i) => ({
        text: doc,
        metadata: results.metadatas[0][i] || {},
        id: results.ids[0][i] || null
      }))
    };
  }

  // JSON fallback — simple keyword matching
  const store = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/);

  const scored = store.entries.map(entry => {
    const textLower = entry.text.toLowerCase();
    let score = 0;
    for (const word of queryWords) {
      if (textLower.includes(word)) score++;
    }
    return { ...entry, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const topResults = scored.slice(0, limit).filter(r => r.score > 0);

  return {
    backend: 'json',
    results: topResults.map(r => ({
      text: r.text,
      metadata: r.metadata,
      id: r.id,
      score: r.score
    }))
  };
}

// Get all stored memories
async function getAllMemories() {
  if (useChroma && collection) {
    const all = await collection.get();
    return {
      backend: 'chromadb',
      count: all.ids.length,
      entries: (all.documents || []).map((doc, i) => ({
        id: all.ids[i],
        text: doc,
        metadata: all.metadatas[i] || {}
      }))
    };
  }

  const store = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  return {
    backend: 'json',
    count: store.entries.length,
    entries: store.entries
  };
}

module.exports = {
  initVectorMemory,
  addMemory,
  searchMemory,
  getAllMemories
};
