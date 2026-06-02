'use strict';
// Standalone test for matchSkipTopic — verifies word-boundary correctness.
// Run: node test-campaign-skip.js  (no deps, no mocks needed)

function matchSkipTopic(haystack, topics) {
  if (!haystack || !Array.isArray(topics) || !topics.length) return null;
  const text = String(haystack);
  for (const raw of topics) {
    const topic = String(raw || '').trim();
    if (!topic) continue;
    const esc = topic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${esc}\\b`, 'i');
    if (re.test(text)) return topic;
  }
  return null;
}

const cases = [
  // [haystack, topics, expected_match, description]
  ['Day 12: drop the audiobook teaser today', ['audiobook'], 'audiobook', 'literal full token match'],
  ['Drop the AUDIOBOOK teaser', ['audiobook'], 'audiobook', 'case-insensitive'],
  ['New Audiobook!!!', ['audiobook'], 'audiobook', 'punctuation after token still matches via \\b'],
  ['Join the book club tonight', ['audiobook'], null, 'NOT match — "book" is a different token'],
  ['Talk about audio fidelity', ['audiobook'], null, 'NOT match — "audio" alone is not "audiobook"'],
  ['audio book launch', ['audiobook'], null, 'NOT match — space-separated, not the same token'],
  ['', ['audiobook'], null, 'empty haystack'],
  ['anything', [], null, 'empty topics list'],
  ['anything', null, null, 'null topics'],
  ['Promote the e-book + audiobook combo', ['audiobook'], 'audiobook', 'mixed content still finds the token'],
  ['Pre-order the audio-book today', ['audiobook'], null, 'hyphenated audio-book is a different token'],
  ['Topic mention: vinyl record', ['audiobook', 'vinyl'], 'vinyl', 'second topic in the list matches'],
  ['NEWBOOK release', ['book'], null, 'word-boundary stops partial match inside another word'],
];

let pass = 0, fail = 0;
for (const [haystack, topics, expected, desc] of cases) {
  const got = matchSkipTopic(haystack, topics);
  const ok = got === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${desc}`);
  if (!ok) {
    console.log(`      haystack: ${JSON.stringify(haystack)}`);
    console.log(`      topics:   ${JSON.stringify(topics)}`);
    console.log(`      expected: ${JSON.stringify(expected)}`);
    console.log(`      got:      ${JSON.stringify(got)}`);
  }
  ok ? pass++ : fail++;
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
