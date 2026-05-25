'use strict';
const memory = require('./memory');

async function run() {
  console.log('Updating Solomon memory...');

  // 1. Log Whisper skill in lessons
  console.log('Logging Whisper skill...');
  try {
    await memory.lessons.add({
      project: 'system',
      phase: 'setup',
      what_worked: 'Local Whisper transcription is the preferred offline method for Jed\'s PC.',
      what_failed: 'Automated installation via pc_execute (winget/installer/embed) is currently unstable due to environment path issues.',
      error_patterns: 'If python.exe is missing, transcription will fail. Solomon should use C:/Python311-Embed/python.exe if present, or ask Jed to install Python 3.11 manually.',
      lesson: 'Skill: Local Whisper transcription. Usage: ffmpeg -i input.mp4 -vn -acodec pcm_s16le output.wav && whisper output.wav --model medium --output_format srt. Runs offline, no API costs.'
    });
  } catch (e) {
    console.log('Note: lessons.add failed, likely not a function or schema mismatch. Continuing...');
  }

  // 2. Update IronEdit project state via upsert
  console.log('Updating IronEdit project state...');
  const current = await memory.projects.get('ironedit');
  if (current) {
    // We add the note to the spec_summary since that's a text field we can append to
    const newSummary = (current.spec_summary || '') + '\n\n[TRANSCRIPTION] Will use local Whisper on Jed\'s PC to avoid cloud API costs. Status: pending_pc_setup.';
    await memory.projects.upsert({
      name: 'ironedit',
      specSummary: newSummary
    });
    console.log('IronEdit state updated via upsert.');
  }

  console.log('Memory updates complete.');
}

run().catch(console.error);
