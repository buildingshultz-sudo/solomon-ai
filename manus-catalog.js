#!/usr/bin/env node
'use strict';
// manus-catalog.js — one-shot script that enumerates /root/solomon-v4/manus-archive/,
// extracts a content preview from each file, batch-summarizes via Claude sonnet-4-6,
// and generates a Building-Shultz-branded PDF via the existing briefToPdf helper.
//
// Run from /root/solomon-v4 so requires resolve cleanly.
//   node manus-catalog.js

require('dotenv').config({ path: '/root/solomon-v4/.env' });
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const axios = require('axios');
const { briefToPdf } = require('./report-pdf');

const ROOT = '/root/solomon-v4/manus-archive';
const OUT_DIR = '/root/solomon-v4/reports';
const OUT_NAME = `manus-archive-catalog-${new Date().toISOString().slice(0, 10)}.pdf`;
const OUT_PATH = path.join(OUT_DIR, OUT_NAME);
const MODEL = process.env.CATALOG_MODEL || 'claude-sonnet-4-6';
const PREVIEW_CHARS_TEXT = 400;
const PREVIEW_CHARS_PDF = 1500;
const BATCH_SIZE = 5;
const BATCH_RETRIES = 1;
const BATCH_TIMEOUT_MS = 30000;
const PREVIEW_CHARS_TEXT_SMALL = 400;
const PREVIEW_CHARS_PDF_SMALL = 1500;
const BUDGET_CAP_USD = 2.0; // soft cap from spec
const NOW = new Date().toISOString();

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// ── ENUMERATE ─────────────────────────────────────────────────────────────
function enumerateFiles(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    let st;
    try { st = fs.statSync(full); } catch (_) { continue; }
    if (st.isFile()) {
      const ext = (path.extname(name).toLowerCase().slice(1) || 'unknown');
      out.push({ filename: name, path: full, ext, size: st.size, mtime: st.mtime.toISOString() });
    }
  }
  return out;
}

// ── EXTRACT PREVIEW ───────────────────────────────────────────────────────
function extractPreview(file) {
  try {
    if (file.ext === 'md' || file.ext === 'txt') {
      const t = fs.readFileSync(file.path, 'utf8');
      // Pull headings + first ~500 chars for context
      const headings = t.split('\n').filter(l => /^#{1,3}\s/.test(l)).slice(0, 8).join('\n');
      const head = t.slice(0, PREVIEW_CHARS_TEXT);
      return { ok: true, text: (headings ? `HEADINGS:\n${headings}\n\nFIRST CHARS:\n` : '') + head };
    }
    if (file.ext === 'pdf') {
      try {
        const t = execFileSync('pdftotext', ['-layout', '-l', '2', file.path, '-'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] });
        return { ok: true, text: (t || '').slice(0, PREVIEW_CHARS_PDF) };
      } catch (e) { return { ok: false, error: 'pdftotext failed: ' + e.message.slice(0, 80) }; }
    }
    if (file.ext === 'docx') {
      try {
        const t = execFileSync('pandoc', [file.path, '-t', 'plain'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] });
        return { ok: true, text: (t || '').slice(0, PREVIEW_CHARS_PDF) };
      } catch (e) { return { ok: false, error: 'pandoc failed: ' + e.message.slice(0, 80) }; }
    }
    if (file.ext === 'zip' || file.ext === 'json') {
      return { ok: false, error: '[no extraction] ' + file.ext };
    }
    return { ok: false, error: '[no extraction] unknown ext' };
  } catch (e) {
    return { ok: false, error: 'extract error: ' + e.message.slice(0, 80) };
  }
}

// ── BATCH SUMMARIZE ───────────────────────────────────────────────────────
let _spendUsd = 0;
const CLAUDE_INPUT_PER_M  = 3.00;   // sonnet 4.x current pricing
const CLAUDE_OUTPUT_PER_M = 15.00;
function trackCost(usage) {
  _spendUsd += (usage.input_tokens / 1_000_000) * CLAUDE_INPUT_PER_M
             + (usage.output_tokens / 1_000_000) * CLAUDE_OUTPUT_PER_M;
}

async function summarizeBatch(batch) {
  // batch is [{filename, ext, size, preview}], expect a JSON array back.
  const corpus = batch.map((f, i) => `### File ${i + 1} (${f.ext}, ${(f.size/1024).toFixed(1)} KB)\nFILENAME: ${f.filename}\nPREVIEW:\n${(f.preview || '(no preview)').slice(0, 3500)}\n---`).join('\n\n');
  const systemPrompt = `You are cataloging files from Jed Shultz's "manus" archive (a personal/business knowledge dump — strategy docs, curricula, business plans, brainstorms, etc.). For each file you'll be given a filename + a short preview. Output a JSON array of objects, one per file, in the SAME ORDER as the input. Each object:
{
  "filename": "<exact filename from input>",
  "description": "<one sentence, max 180 chars, what this file contains>",
  "category": "KEEP" | "SAFE TO DELETE",
  "reason": "<if SAFE TO DELETE, why (duplicate, empty, junk, test file, etc.); if KEEP, leave empty string>"
}
Default to KEEP when ambiguous. SAFE TO DELETE only for clear cases: obvious duplicates (look at filename + content), empty/near-empty files, test files, junk like "untitled.txt" with no content, throwaway debug logs. Output ONLY the JSON array, no preamble, no markdown fences.`;

  const resp = await axios.post('https://api.anthropic.com/v1/messages', {
    model: MODEL,
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: 'user', content: `Catalog ${batch.length} files:\n\n${corpus}` }]
  }, {
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    timeout: BATCH_TIMEOUT_MS
  });
  trackCost(resp.data.usage);
  const txt = (resp.data.content?.[0]?.text || '').trim();
  // Strip ```json fences if model added them
  const cleaned = txt.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
  const mArr = cleaned.match(/\[[\s\S]*\]/);
  if (!mArr) throw new Error('no JSON array in response: ' + txt.slice(0, 200));
  return JSON.parse(mArr[0]);
}

// ── MAIN ──────────────────────────────────────────────────────────────────
(async () => {
  console.log('[catalog] enumerating', ROOT);
  const files = enumerateFiles(ROOT).sort((a, b) => a.filename.localeCompare(b.filename));
  console.log(`[catalog] ${files.length} files`);

  // Extract previews
  console.log('[catalog] extracting previews...');
  let extractErrors = 0;
  for (const f of files) {
    const ex = extractPreview(f);
    f.preview = ex.text || '';
    f.extract_ok = ex.ok;
    f.extract_error = ex.error || null;
    if (!ex.ok) extractErrors++;
  }

  // Group into batches; mix types in each batch is fine
  console.log(`[catalog] summarizing in batches of ${BATCH_SIZE}...`);
  const catalog = [];
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    if (_spendUsd > BUDGET_CAP_USD) {
      console.warn(`[catalog] BUDGET CAP hit at $${_spendUsd.toFixed(3)} — remaining ${files.length - i} files get filename-only entries`);
      for (let j = i; j < files.length; j++) {
        catalog.push({ filename: files[j].filename, description: '(budget cap reached — filename-only)', category: 'KEEP', reason: '' });
      }
      break;
    }
    const batch = files.slice(i, i + BATCH_SIZE);
    const batchNo = Math.floor(i/BATCH_SIZE) + 1;
    const batchTotal = Math.ceil(files.length/BATCH_SIZE);
    process.stdout.write(`[catalog] batch ${batchNo}/${batchTotal} (${batch.length} files, spent $${_spendUsd.toFixed(3)})... `);
    let results = null;
    let lastErr = null;
    for (let attempt = 1; attempt <= BATCH_RETRIES + 1; attempt++) {
      try {
        results = await summarizeBatch(batch);
        break;
      } catch (e) {
        lastErr = e;
        process.stdout.write(`(attempt ${attempt} failed: ${e.message.slice(0,60)}) `);
        if (attempt <= BATCH_RETRIES) await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
    if (results) {
      const byName = {};
      for (const r of results) byName[r.filename] = r;
      for (const f of batch) {
        const r = byName[f.filename];
        catalog.push(r || { filename: f.filename, description: '(no summary returned)', category: 'KEEP', reason: '' });
      }
      console.log('ok');
    } else {
      console.error('FAIL after retries:', lastErr && lastErr.message);
      for (const f of batch) catalog.push({ filename: f.filename, description: '(batch failed after retries: ' + (lastErr && lastErr.message || 'unknown').slice(0, 80) + ')', category: 'KEEP', reason: '' });
    }
  }

  // Stitch metadata + summary together
  const byName = {};
  for (const f of files) byName[f.filename] = f;
  const enriched = catalog.map(c => {
    const f = byName[c.filename] || {};
    return {
      filename: c.filename,
      kb: f.size != null ? (f.size / 1024).toFixed(1) : '?',
      size_raw: f.size || 0,
      type: f.ext || 'unknown',
      description: (c.description || '').slice(0, 200),
      category: (c.category === 'SAFE TO DELETE') ? 'SAFE TO DELETE' : 'KEEP',
      reason: c.reason || '',
      extract_ok: f.extract_ok !== false,
      extract_error: f.extract_error || null
    };
  });

  // Stats
  const byType = {};
  for (const e of enriched) byType[e.type] = (byType[e.type] || 0) + 1;
  const totalKb = files.reduce((s, f) => s + f.size, 0) / 1024;
  const keepCount = enriched.filter(e => e.category === 'KEEP').length;
  const deleteCount = enriched.filter(e => e.category === 'SAFE TO DELETE').length;

  // Sort: KEEP first, then SAFE TO DELETE, alphabetical within each
  enriched.sort((a, b) => {
    if (a.category !== b.category) return a.category === 'KEEP' ? -1 : 1;
    return a.filename.localeCompare(b.filename);
  });

  // ── BUILD PDF SECTIONS ──
  const sections = [];

  // 1. Summary stats
  sections.push({
    type: 'list',
    heading: 'Summary',
    items: [
      `Total files: ${files.length}`,
      `Total size: ${totalKb.toFixed(1)} KB (${(totalKb/1024).toFixed(2)} MB)`,
      `KEEP: ${keepCount}    SAFE TO DELETE: ${deleteCount}`,
      `Extract errors: ${extractErrors}`,
      `Generated: ${NOW}`,
      `Catalog API spend: $${_spendUsd.toFixed(3)} (cap $${BUDGET_CAP_USD.toFixed(2)})`
    ]
  });
  sections.push({
    type: 'list',
    heading: 'Breakdown by type',
    items: Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}: ${n}`)
  });

  // 2. Full catalog table -- chunk into multiple sections to keep PDFKit responsive.
  const tableHeader = ['Filename', 'KB', 'Type', 'Category', 'Description'];
  const allRows = enriched.map(e => [
    e.filename.length > 60 ? e.filename.slice(0, 57) + '...' : e.filename,
    e.kb,
    e.type,
    e.category === 'SAFE TO DELETE' ? 'DEL' : 'KEEP',
    (e.description || '').slice(0, 90)
  ]);
  // Chunk per ~80 rows so the table renderer doesn't choke
  const CHUNK = 80;
  for (let i = 0; i < allRows.length; i += CHUNK) {
    sections.push({
      type: 'table',
      heading: i === 0 ? `Full catalog (${enriched.length} files)` : `Full catalog (continued ${i + 1}-${Math.min(i + CHUNK, allRows.length)})`,
      header: tableHeader,
      items: allRows.slice(i, i + CHUNK) // briefToPdf table renderer reads .items not .rows
    });
  }

  // 3. SAFE TO DELETE candidates
  const delRows = enriched.filter(e => e.category === 'SAFE TO DELETE').map(e => [
    e.filename.length > 60 ? e.filename.slice(0, 57) + '...' : e.filename,
    e.kb,
    e.type,
    (e.reason || '').slice(0, 100)
  ]);
  if (delRows.length) {
    sections.push({
      type: 'table',
      heading: `SAFE TO DELETE candidates (${delRows.length})`,
      header: ['Filename', 'KB', 'Type', 'Reason'],
      items: delRows // briefToPdf table renderer reads .items not .rows
    });
  } else {
    sections.push({ type: 'text', heading: 'SAFE TO DELETE candidates', text: 'None flagged. All files defaulted to KEEP (cataloger errs on the side of preservation when ambiguous).' });
  }

  // 4. Anomalies
  const anomalyLines = [];
  // Files >500 KB
  const bigFiles = enriched.filter(e => e.size_raw > 500 * 1024).sort((a, b) => b.size_raw - a.size_raw);
  if (bigFiles.length) {
    for (const f of bigFiles.slice(0, 15)) anomalyLines.push(`LARGE  ${f.kb} KB  ${f.filename}`);
  }
  // Extract errors
  const erroredFiles = enriched.filter(e => !e.extract_ok && e.extract_error);
  for (const f of erroredFiles.slice(0, 20)) anomalyLines.push(`EXTRACT-FAIL  ${f.filename}  (${(f.extract_error || '').slice(0, 80)})`);
  // Filename-pattern duplicate hints (base name shared, ext differs OR _v2/_copy/_final suffix)
  const stems = {};
  for (const e of enriched) {
    const stem = e.filename.replace(/\.[^.]+$/, '').replace(/(_v?\d+|_copy|_final|_backup|\(\d+\))$/i, '');
    if (!stems[stem]) stems[stem] = [];
    stems[stem].push(e.filename);
  }
  const dupStems = Object.entries(stems).filter(([, names]) => names.length > 1);
  for (const [stem, names] of dupStems.slice(0, 15)) anomalyLines.push(`DUP-HINT  ${stem}: ${names.join(', ').slice(0, 120)}`);
  if (!anomalyLines.length) anomalyLines.push('None');
  sections.push({ type: 'list', heading: 'Anomalies (large files / extract failures / possible duplicates)', items: anomalyLines });

  // ── EMIT PDF ──
  console.log('[catalog] rendering PDF...');
  const filepath = await briefToPdf('Manus Archive Catalog — 2026-06-02', sections, {
    outDir: OUT_DIR,
    filename: OUT_NAME,
    subtitle: `${files.length} files · ${(totalKb/1024).toFixed(2)} MB · ${keepCount} KEEP / ${deleteCount} SAFE TO DELETE`
  });

  console.log('[catalog] DONE');
  console.log(JSON.stringify({
    ok: true,
    pdf_path: filepath,
    files_total: files.length,
    size_kb: Math.round(totalKb),
    keep: keepCount,
    delete: deleteCount,
    extract_errors: extractErrors,
    spend_usd: Number(_spendUsd.toFixed(4))
  }, null, 2));
})().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
