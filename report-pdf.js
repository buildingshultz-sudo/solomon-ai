'use strict';
// report-pdf.js — Building Shultz brand PDF helper for Solomon's reports.
//
//   const { briefToPdf } = require('./report-pdf');
//   const filepath = await briefToPdf('Morning Scorecard - 2026-05-30', sections);
//   // sections = [
//   //   { type: 'text', heading: 'Summary', content: 'Some plain text...' },
//   //   { type: 'kv',   heading: 'Counts',  items: [{k:'Subs', v:'1,450'}, ...] },
//   //   { type: 'list', heading: 'Actions', items: ['First','Second'] },
//   //   { type: 'table',heading: 'Spend',   header: ['Item','$'], items: [['Anthropic','12.23'],['BFL','3.50']] }
//   // ]
//
// Brand: cream background, dark text, Building Shultz orange (#E25822) accent
// for the title bar, section headings, and the footer rule. Tagline in footer:
// "Be Inspired. Stay Humble. And Build."
//
// Output: by default /tmp/solomon-pdfs/<timestamp>-<slug>.pdf. Caller scp's or
// bot.sendDocument()'s it. PDFs are NOT git-tracked.

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const DEFAULT_OUT_DIR = '/tmp/solomon-pdfs';
const COLOR_BG     = '#FBF7F0';   // cream
const COLOR_INK    = '#1F1A17';   // near-black
const COLOR_MUTE   = '#6B6259';   // warm gray
const COLOR_ACCENT = '#E25822';   // Building Shultz orange
const COLOR_RULE   = '#D6CFC4';   // light tan rule
const TAGLINE      = 'Be Inspired. Stay Humble. And Build.';

function slugify(s) {
  return String(s || 'report').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'report';
}

function fileTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Render a structured brief to a PDF file.
 * @param {string} title
 * @param {Array<Object>} sections   See module header for shape.
 * @param {Object} [opts]
 * @param {string} [opts.outDir]     Default /tmp/solomon-pdfs.
 * @param {string} [opts.filename]   Override filename (still placed in outDir).
 * @param {string} [opts.subtitle]   Optional subtitle under the title bar.
 * @returns {Promise<string>} absolute file path of the written PDF.
 */
function briefToPdf(title, sections, opts = {}) {
  const outDir = opts.outDir || DEFAULT_OUT_DIR;
  ensureDir(outDir);
  const filename = opts.filename || `${fileTimestamp()}-${slugify(title)}.pdf`;
  const filepath = path.join(outDir, filename);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 56, bottom: 56, left: 56, right: 56 },
      info: { Title: title, Author: 'Solomon (Shultz Enterprises)' }
    });
    const stream = fs.createWriteStream(filepath);
    stream.on('finish', () => resolve(filepath));
    stream.on('error', reject);
    doc.pipe(stream);

    // ── PAGE BACKGROUND ──
    const paintBg = () => {
      doc.save();
      doc.rect(0, 0, doc.page.width, doc.page.height).fill(COLOR_BG);
      doc.restore();
    };
    paintBg();
    doc.on('pageAdded', paintBg);

    // ── TITLE BAR (orange band with white title) ──
    doc.save();
    doc.rect(0, 0, doc.page.width, 64).fill(COLOR_ACCENT);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(20);
    doc.text(title, 56, 22, { width: doc.page.width - 112, lineBreak: false, ellipsis: true });
    if (opts.subtitle) {
      doc.font('Helvetica').fontSize(10).fillColor('#FBF7F0');
      doc.text(opts.subtitle, 56, 46, { width: doc.page.width - 112, lineBreak: false });
    }
    doc.restore();

    // Reset for body
    doc.fillColor(COLOR_INK).font('Helvetica').fontSize(11);
    doc.x = 56;
    doc.y = 88;

    // ── SECTIONS ──
    for (const section of (sections || [])) {
      if (!section) continue;
      // Page-break protection: if less than 80pt remain, new page
      if (doc.y > doc.page.height - 120) doc.addPage();

      if (section.heading) {
        doc.moveDown(0.4);
        doc.font('Helvetica-Bold').fontSize(13).fillColor(COLOR_ACCENT);
        doc.text(section.heading, { width: doc.page.width - 112 });
        doc.moveTo(56, doc.y + 2).lineTo(doc.page.width - 56, doc.y + 2).strokeColor(COLOR_RULE).lineWidth(0.5).stroke();
        doc.moveDown(0.5);
        doc.fillColor(COLOR_INK).font('Helvetica').fontSize(11);
      }

      const type = section.type || 'text';
      try {
        if (type === 'text') {
          doc.text(String(section.content || ''), { width: doc.page.width - 112, align: 'left' });
        } else if (type === 'list') {
          for (const item of (section.items || [])) {
            doc.text(`• ${item}`, { width: doc.page.width - 112, indent: 6 });
          }
        } else if (type === 'kv') {
          const labelW = 140;
          for (const it of (section.items || [])) {
            const k = String(it.k || '');
            const v = String(it.v == null ? '' : it.v);
            const startY = doc.y;
            doc.font('Helvetica-Bold').fontSize(10).fillColor(COLOR_MUTE);
            doc.text(k, 56, startY, { width: labelW, lineBreak: false, ellipsis: true });
            doc.font('Helvetica').fontSize(11).fillColor(COLOR_INK);
            doc.text(v, 56 + labelW + 8, startY, { width: doc.page.width - 112 - labelW - 8 });
            // doc.y may have advanced by multi-line value; ensure baseline advance
            if (doc.y === startY) doc.moveDown(0.25);
          }
        } else if (type === 'table') {
          const cols = (section.header && section.header.length) || (section.items?.[0]?.length || 0);
          if (cols > 0) {
            const available = doc.page.width - 112;
            const colW = available / cols;
            if (section.header) {
              const yh = doc.y;
              doc.font('Helvetica-Bold').fontSize(10).fillColor(COLOR_MUTE);
              section.header.forEach((h, i) => {
                doc.text(String(h), 56 + i * colW, yh, { width: colW - 4, lineBreak: false, ellipsis: true });
              });
              doc.moveDown(0.4);
              doc.moveTo(56, doc.y).lineTo(doc.page.width - 56, doc.y).strokeColor(COLOR_RULE).lineWidth(0.5).stroke();
              doc.moveDown(0.3);
            }
            doc.font('Helvetica').fontSize(10).fillColor(COLOR_INK);
            for (const row of (section.items || [])) {
              if (doc.y > doc.page.height - 80) doc.addPage();
              const yr = doc.y;
              row.forEach((cell, i) => {
                doc.text(String(cell == null ? '' : cell), 56 + i * colW, yr, { width: colW - 4, lineBreak: false, ellipsis: true });
              });
              doc.moveDown(0.4);
            }
          }
        }
      } catch (e) {
        doc.font('Helvetica-Oblique').fontSize(9).fillColor('#A00');
        doc.text(`(section render error: ${e.message})`, { width: doc.page.width - 112 });
        doc.font('Helvetica').fontSize(11).fillColor(COLOR_INK);
      }
      doc.moveDown(0.6);
    }

    // ── FOOTER on every page ──
    const drawFooter = () => {
      const y = doc.page.height - 36;
      doc.save();
      doc.moveTo(56, y - 6).lineTo(doc.page.width - 56, y - 6).strokeColor(COLOR_ACCENT).lineWidth(0.6).stroke();
      doc.font('Helvetica').fontSize(8).fillColor(COLOR_MUTE);
      doc.text(TAGLINE, 56, y, { width: doc.page.width / 2 - 56, lineBreak: false });
      const right = `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
      doc.text(right, doc.page.width / 2, y, { width: doc.page.width / 2 - 56, align: 'right', lineBreak: false });
      doc.restore();
    };
    // Draw footer on all existing pages
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      drawFooter();
    }

    doc.end();
  });
}

module.exports = { briefToPdf, DEFAULT_OUT_DIR };
