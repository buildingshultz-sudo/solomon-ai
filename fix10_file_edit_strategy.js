const fs = require('fs');
const path = '/root/solomon-v4/bot.js';
let code = fs.readFileSync(path, 'utf8');

// Add FILE EDITING STRATEGY after the TOOL VERIFICATION LAW section
const anchor = '- The ONLY acceptable proof is a tool response showing {ok: true} or verified output.';
const addition = `

═══ FILE EDITING STRATEGY (MANDATORY) ══════════════════════════════════════════
- For EXISTING files: ALWAYS use file_edit (find/replace) for targeted changes.
  Do NOT rewrite entire files with file_write — it wastes tokens and may exceed output limits.
- For NEW files: Use file_write.
- For large changes to existing files: Break into multiple file_edit calls, each replacing one section.
- If file_edit returns {ok: false, replacements: 0}: your find text was wrong. Use file_read to check the exact current content, then retry with the correct find text.
- NEVER read the same file more than twice in one conversation turn. If you have already read it, use the content you have.
════════════════════════════════════════════════════════════════════════════════`;

if (code.includes(anchor)) {
  code = code.replace(anchor, anchor + addition);
  console.log('✅ Added FILE EDITING STRATEGY to system prompt');
} else {
  console.log('⚠️ Could not find anchor text');
}

fs.writeFileSync(path, code, 'utf8');
console.log('Done.');
