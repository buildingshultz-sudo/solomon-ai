/**
 * Solomon Persistent Knowledge Base
 * Structured memory that persists and grows across sessions.
 */
const fs = require('fs');
const path = require('path');

const KB_FILE = path.join(__dirname, 'sol-knowledge.json');

const DEFAULT_KB = {
  business_context: {
    company: 'Shultz Enterprises',
    owner: 'Jedidiah (Jed) Shultz',
    role: 'Journeyman pipefitter, YouTuber, entrepreneur',
    channel: 'Building Shultz',
    subscribers: '~1,450 (last known)',
    videos: '287+',
    motto: 'Be Inspired, Stay Humble, and Build',
    goal: 'Million-dollar company in 5 years using AI + YouTube as funnel',
    niche: 'Tradesmen/makers using AI — untapped market',
    family: 'Married with family, works full-time construction'
  },
  active_projects: [
    { name: 'Solomon Bot', status: 'active', description: 'Autonomous AI business partner', priority: 1 },
    { name: 'IronEdit', status: 'active', description: 'Electron video editor for tradesmen', priority: 2 },
    { name: 'YouTube Content', status: 'active', description: 'AI Journey series + regular uploads', priority: 2 },
    { name: 'KDP Books', status: 'active', description: 'Kindle Direct Publishing listings', priority: 4 },
    { name: 'Newsletter', status: 'planned', description: 'Email list for Building Shultz audience', priority: 3 }
  ],
  research_findings: [],
  decisions_made: [
    { date: '2024', decision: 'Use AI as business partner instead of hiring staff', reason: 'Cost-effective, scalable' },
    { date: '2024', decision: 'Switched IronEdit from Tauri/Rust to Electron', reason: 'Tauri kept failing, Electron worked' },
    { date: '2025-05', decision: 'Migrated Sol to dedicated VPS', reason: 'Reliability, no more Manus credit limits' }
  ],
  jed_preferences: {
    communication: 'Short, direct, no fluff. Casual tradesman tone.',
    content_style: 'Authentic, motivational, relatable to blue-collar workers',
    work_hours: 'Full-time construction during day, evenings/weekends for business',
    frustrations: ['Agents saying they cant do things', 'Long technical explanations', 'Having to repeat context', 'Losing progress when credits run out'],
    values: ['Family first', 'Hard work', 'Authenticity', 'Helping others', 'Building legacy']
  },
  lessons_learned: [
    { lesson: 'Never say you cant do something — find a way or try first', source: 'Jed feedback' },
    { lesson: 'Never hallucinate results — verify everything', source: 'vidIQ incident' },
    { lesson: 'Keep responses short — Jed doesnt want essays', source: 'Jed feedback' },
    { lesson: 'Do the work, dont describe plans', source: 'Jed feedback' },
    { lesson: 'OpenRouter TLS can fail — have fallback ready', source: 'outage incident' }
  ],
  content_ideas: [],
  next_moves: []
};

function loadKB() {
  try {
    if (fs.existsSync(KB_FILE)) return JSON.parse(fs.readFileSync(KB_FILE, 'utf8'));
  } catch {}
  return DEFAULT_KB;
}

function saveKB(kb) {
  fs.writeFileSync(KB_FILE, JSON.stringify(kb, null, 2));
}

function initKB() {
  if (!fs.existsSync(KB_FILE)) {
    saveKB(DEFAULT_KB);
  }
  return loadKB();
}

function addToKB(category, entry) {
  const kb = loadKB();
  if (!kb[category]) kb[category] = [];
  if (Array.isArray(kb[category])) {
    // Prevent duplicates by checking title/lesson/decision
    const key = entry.title || entry.lesson || entry.decision || entry.finding || JSON.stringify(entry);
    const exists = kb[category].some(e => 
      (e.title || e.lesson || e.decision || e.finding || JSON.stringify(e)) === key
    );
    if (!exists) {
      entry.addedAt = Date.now();
      kb[category].push(entry);
      // Keep arrays manageable
      if (kb[category].length > 50) kb[category] = kb[category].slice(-50);
    }
  } else if (typeof kb[category] === 'object') {
    Object.assign(kb[category], entry);
  }
  saveKB(kb);
  return kb;
}

function getKBContext() {
  const kb = loadKB();
  let context = '\n[WORKING MEMORY / KNOWLEDGE BASE]\n';
  context += `Business: ${kb.business_context.company} | ${kb.business_context.owner} | ${kb.business_context.channel} (~${kb.business_context.subscribers} subs)\n`;
  context += `Goal: ${kb.business_context.goal}\n`;
  context += `Active Projects: ${kb.active_projects.filter(p => p.status === 'active').map(p => p.name).join(', ')}\n`;
  if (kb.research_findings.length > 0) {
    context += `Recent Research: ${kb.research_findings.slice(-3).map(r => r.title || r.finding).join('; ')}\n`;
  }
  context += `Jed Preferences: ${kb.jed_preferences.communication}\n`;
  context += `Key Lessons: ${kb.lessons_learned.slice(-5).map(l => l.lesson).join(' | ')}\n`;
  if (kb.next_moves.length > 0) {
    context += `Next Moves: ${kb.next_moves.slice(0, 3).map(m => m.title || m).join(', ')}\n`;
  }
  return context;
}

function getFullKBReport() {
  const kb = loadKB();
  let report = '📚 *Sol Knowledge Base*\n\n';
  report += `*Business:* ${kb.business_context.company}\n`;
  report += `*Owner:* ${kb.business_context.owner}\n`;
  report += `*Channel:* ${kb.business_context.channel} (${kb.business_context.subscribers})\n`;
  report += `*Goal:* ${kb.business_context.goal}\n\n`;
  report += `*Active Projects:*\n`;
  kb.active_projects.filter(p => p.status === 'active').forEach(p => {
    report += `• ${p.name} — ${p.description}\n`;
  });
  report += `\n*Research Findings:* ${kb.research_findings.length} entries\n`;
  report += `*Decisions Made:* ${kb.decisions_made.length} entries\n`;
  report += `*Lessons Learned:* ${kb.lessons_learned.length} entries\n`;
  return report;
}

module.exports = { loadKB, saveKB, initKB, addToKB, getKBContext, getFullKBReport, DEFAULT_KB };
