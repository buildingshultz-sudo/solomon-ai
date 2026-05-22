/**
 * patch_markdown_strip.js
 * Replaces the weak markdown stripping in worker.js with aggressive multi-line stripping.
 */
const fs = require('fs');
const path = require('path');

const WORKER_FILE = path.join(__dirname, 'worker.js');
let code = fs.readFileSync(WORKER_FILE, 'utf8');

const OLD_STRIP = `    // Strip any markdown code fences the LLM might have added despite instructions
    let cleanCode = generatedCode;
    if (cleanCode.startsWith('\`\`\`')) {
      cleanCode = cleanCode.replace(/^\`\`\`(?:javascript|js)?\\n?/, '').replace(/\\n?\`\`\`$/, '');
    }`;

const NEW_STRIP = `    // Aggressive markdown fence stripping — handles all LLM output quirks
    let cleanCode = generatedCode;
    // Remove leading/trailing whitespace
    cleanCode = cleanCode.trim();
    // Strip opening fence: \`\`\`javascript, \`\`\`js, \`\`\`node, \`\`\` or just \`\`\`
    cleanCode = cleanCode.replace(/^\`\`\`(?:javascript|js|node|typescript|ts)?\\s*\\n?/, '');
    // Strip closing fence at end
    cleanCode = cleanCode.replace(/\\n?\`\`\`\\s*$/, '');
    // Also strip any remaining \`\`\` lines that appear in the middle (some models add them)
    cleanCode = cleanCode.split('\\n').filter(line => !line.match(/^\`\`\`\\s*$/)).join('\\n');
    // Strip any leading "javascript\\n" or "js\\n" if the model output that after fence removal
    cleanCode = cleanCode.replace(/^(?:javascript|js|node)\\s*\\n/, '');
    // Final trim
    cleanCode = cleanCode.trim();`;

if (code.includes(OLD_STRIP)) {
  code = code.replace(OLD_STRIP, NEW_STRIP);
  fs.writeFileSync(WORKER_FILE, code, 'utf8');
  console.log('✅ Markdown stripping upgraded to aggressive multi-line version');
} else {
  console.log('ERROR: Could not find old stripping block');
  // Try partial match
  const partial = "// Strip any markdown code fences the LLM might have added despite instructions";
  const idx = code.indexOf(partial);
  if (idx >= 0) {
    // Find the end of the block (next advanceStep line)
    const endMarker = "    advanceStep(task.id, `Code generated";
    const endIdx = code.indexOf(endMarker, idx);
    if (endIdx > idx) {
      code = code.slice(0, idx) + NEW_STRIP + '\n' + code.slice(endIdx);
      fs.writeFileSync(WORKER_FILE, code, 'utf8');
      console.log('✅ Markdown stripping upgraded (partial match approach)');
    } else {
      console.log('ERROR: Could not find end marker');
      process.exit(1);
    }
  } else {
    console.log('ERROR: Could not find any stripping block');
    process.exit(1);
  }
}
