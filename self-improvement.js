'use strict';
/**
 * Solomon Self-Improvement Loop
 * 
 * After every interaction, this module:
 * 1. Scores the response against known failure patterns
 * 2. Logs lessons to sol-knowledge.json
 * 3. Auto-patches config.js rules when a pattern repeats 2+ times
 */

const fs = require('fs');
const path = require('path');

const KB_PATH = path.join(__dirname, 'sol-knowledge.json');
const CONFIG_PATH = path.join(__dirname, 'config.js');
const LESSONS_PATH = path.join(__dirname, 'lessons-learned.json');

// ── Known failure patterns to detect ─────────────────────────────────────────
const FAILURE_PATTERNS = [
  {
    id: 'claimed_agent_offline_from_timeout',
    regex: /pc agent (isn.t|is not|isn.t) responding|agent (appears|seems|is) (offline|down|not responding)|not responding yet/i,
    lesson: 'Told Jed PC Agent is offline/not responding based on a single command timeout.',
    rule: 'NEVER claim PC Agent is offline from a timeout. Check heartbeat first. Say "that command was slow, retrying."',
    severity: 'high'
  },
  {
    id: 'image_error_leaked',
    regex: /could not analyze image|had trouble analyzing|unable to process (the )?image/i,
    lesson: 'Leaked an image analysis error message to Jed.',
    rule: 'Image analysis errors must NEVER reach Jed. Return "Got it" or ask what he needs.',
    severity: 'high'
  },
  {
    id: 'asked_for_known_info',
    regex: /which file|what file|which one|what path|can you clarify which/i,
    lesson: 'Asked Jed for information Sol already has in KB.',
    rule: 'NEVER ask Jed for information that is already in sol-knowledge.json. Check KB first.',
    severity: 'high'
  },
  {
    id: 'described_screenshot',
    regex: /this is a screenshot|this appears to be a|not a thumbnail|this image shows|i can see a desktop/i,
    lesson: 'Described a screenshot instead of responding to its meaning.',
    rule: 'When Jed sends a photo, respond to what it MEANS, not what it IS.',
    severity: 'medium'
  },
  {
    id: 'error_message_to_user',
    regex: /could not analyze image|error processing|undefined is not|cannot read property|typeerror/i,
    lesson: 'Sent a raw error message to Jed instead of handling it gracefully.',
    rule: 'Never show internal errors to Jed. Handle silently and say "Got it" or ask what he needs.',
    severity: 'high'
  },
  {
    id: 'too_long_message',
    regex: /option [abc123]:|here are \d+ (options|ways|approaches)|alternatively|on the other hand.*however.*but also/i,
    lesson: 'Sent a long multi-option message instead of picking one and stating it directly.',
    rule: 'Pick the best option and state it. Never list multiple options. Max 3 sentences.',
    severity: 'medium'
  },
  {
    id: 'pasted_raw_command',
    regex: /```(bash|powershell|cmd|shell)[\s\S]{100,}```/i,
    lesson: 'Pasted a raw command block in a Telegram message instead of putting it in a file.',
    rule: 'Never paste raw commands in Telegram messages. Put them in a file attachment.',
    severity: 'medium'
  },
  {
    id: 'said_cant_locate',
    regex: /i can't locate|i cannot locate|unable to find|i don't have access to that file|i don't see that file/i,
    lesson: 'Said "can\'t locate" for a file Sol created himself.',
    rule: 'Never say you can\'t locate something you created. Check LESSONS_PATH and KB first.',
    severity: 'high'
  },
  {
    id: 'idle_waiting',
    regex: /waiting for pc agent|queue is empty.*nothing|nothing to do|standing by/i,
    lesson: 'Told Jed the queue was empty and waited instead of starting work.',
    rule: 'When queue is empty, proactively suggest or start tasks. Never just say "waiting".',
    severity: 'medium'
  }
];

// ── Load/save lessons ─────────────────────────────────────────────────────────
function loadLessons() {
  try {
    return JSON.parse(fs.readFileSync(LESSONS_PATH, 'utf8'));
  } catch {
    return { lessons: [], patternCounts: {}, lastAnalyzed: null };
  }
}

function saveLessons(data) {
  fs.writeFileSync(LESSONS_PATH, JSON.stringify(data, null, 2));
}

// ── Analyze a response for failures ──────────────────────────────────────────
function analyzeResponse(userMessage, botResponse) {
  const failures = [];
  for (const pattern of FAILURE_PATTERNS) {
    if (pattern.regex.test(botResponse)) {
      failures.push({
        patternId: pattern.id,
        lesson: pattern.lesson,
        rule: pattern.rule,
        severity: pattern.severity,
        snippet: botResponse.match(pattern.regex)?.[0]?.slice(0, 80) || ''
      });
    }
  }
  return failures;
}

// ── Auto-patch config.js when a pattern repeats ───────────────────────────────
function autoPatchRule(patternId, rule) {
  try {
    let content = fs.readFileSync(CONFIG_PATH, 'utf8');
    const marker = `[AUTO-PATCH:${patternId}]`;
    if (content.includes(marker)) {
      console.log(`[SELF-IMPROVE] Rule already patched for: ${patternId}`);
      return false;
    }
    const patchLine = `\n// ${marker} Auto-patched ${new Date().toISOString()}\n// RULE: ${rule}\n`;
    // Insert into the TOP-PRIORITY RULES section
    const anchor = '### RULE 5: IMAGE ANALYSIS';
    if (content.includes(anchor)) {
      content = content.replace(anchor, patchLine + anchor);
    } else {
      // Append before module.exports
      content = content.replace('module.exports', patchLine + 'module.exports');
    }
    fs.writeFileSync(CONFIG_PATH, content);
    console.log(`[SELF-IMPROVE] Auto-patched rule for: ${patternId}`);
    return true;
  } catch (e) {
    console.error('[SELF-IMPROVE] Patch failed:', e.message);
    return false;
  }
}

// ── Update KB with lesson ─────────────────────────────────────────────────────
function recordLessonInKB(failure, count) {
  try {
    const kb = JSON.parse(fs.readFileSync(KB_PATH, 'utf8'));
    if (!kb.self_improvement_log) kb.self_improvement_log = [];
    kb.self_improvement_log.push({
      timestamp: new Date().toISOString(),
      patternId: failure.patternId,
      lesson: failure.lesson,
      occurrenceCount: count,
      autoPatched: count >= 2
    });
    // Keep only last 50 entries
    if (kb.self_improvement_log.length > 50) {
      kb.self_improvement_log = kb.self_improvement_log.slice(-50);
    }
    fs.writeFileSync(KB_PATH, JSON.stringify(kb, null, 2));
  } catch (e) {
    console.error('[SELF-IMPROVE] KB update failed:', e.message);
  }
}

// ── Main: run after every interaction ────────────────────────────────────────
async function runSelfImprovementLoop(userMessage, botResponse, callLLM) {
  try {
    const lessons = loadLessons();
    lessons.lastAnalyzed = new Date().toISOString();

    // 1. Pattern-based analysis (fast, no LLM needed)
    const failures = analyzeResponse(userMessage, botResponse);

    for (const failure of failures) {
      // Increment count
      lessons.patternCounts[failure.patternId] = (lessons.patternCounts[failure.patternId] || 0) + 1;
      const count = lessons.patternCounts[failure.patternId];

      // Log the lesson
      lessons.lessons.push({
        timestamp: new Date().toISOString(),
        userMessage: userMessage.slice(0, 100),
        failure: failure.lesson,
        severity: failure.severity,
        count
      });

      console.log(`[SELF-IMPROVE] Pattern detected: ${failure.patternId} (count: ${count})`);

      // Record in KB
      recordLessonInKB(failure, count);

      // Auto-patch if repeated 2+ times
      if (count >= 2) {
        const patched = autoPatchRule(failure.patternId, failure.rule);
        if (patched) {
          console.log(`[SELF-IMPROVE] Auto-patched rule after ${count} occurrences: ${failure.patternId}`);
        }
      }
    }

    // 2. LLM-based meta-analysis (async, runs every 10 interactions)
    const totalInteractions = lessons.lessons.length;
    if (callLLM && totalInteractions > 0 && totalInteractions % 10 === 0) {
      const recentFailures = lessons.lessons.slice(-10);
      if (recentFailures.length > 0) {
        const prompt = `You are Sol's self-improvement system. Here are the last 10 failure patterns detected in Sol's responses:

${recentFailures.map(f => `- ${f.failure} (severity: ${f.severity})`).join('\n')}

Write ONE new behavior rule (max 2 sentences) that would prevent the most common failure. Be specific and actionable. Format: "RULE: [rule text]"`;

        try {
          const newRule = await callLLM([
            { role: 'system', content: 'You are a behavior rule generator for an AI assistant. Be concise and specific.' },
            { role: 'user', content: prompt }
          ], 'gpt-4.1-mini', 0.3);

          if (newRule && newRule.includes('RULE:')) {
            const ruleText = newRule.match(/RULE:\s*(.+)/)?.[1]?.trim();
            if (ruleText) {
              const kb = JSON.parse(fs.readFileSync(KB_PATH, 'utf8'));
              if (!kb.llm_generated_rules) kb.llm_generated_rules = [];
              kb.llm_generated_rules.push({
                timestamp: new Date().toISOString(),
                rule: ruleText,
                basedOn: recentFailures.map(f => f.failure)
              });
              fs.writeFileSync(KB_PATH, JSON.stringify(kb, null, 2));
              console.log(`[SELF-IMPROVE] LLM generated new rule: ${ruleText.slice(0, 80)}`);
            }
          }
        } catch (e) {
          console.error('[SELF-IMPROVE] LLM analysis failed:', e.message);
        }
      }
    }

    // Keep lessons list to last 200
    if (lessons.lessons.length > 200) {
      lessons.lessons = lessons.lessons.slice(-200);
    }

    saveLessons(lessons);
  } catch (e) {
    console.error('[SELF-IMPROVE] Loop error:', e.message);
  }
}

// ── Get improvement summary for /status command ───────────────────────────────
function getImprovementSummary() {
  try {
    const lessons = loadLessons();
    const counts = lessons.patternCounts || {};
    const topIssues = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, count]) => `${id}: ${count}x`);
    return {
      totalLessons: lessons.lessons.length,
      topIssues,
      lastAnalyzed: lessons.lastAnalyzed,
      autoPatches: Object.values(counts).filter(c => c >= 2).length
    };
  } catch {
    return { totalLessons: 0, topIssues: [], lastAnalyzed: null, autoPatches: 0 };
  }
}

module.exports = { runSelfImprovementLoop, getImprovementSummary, analyzeResponse };
