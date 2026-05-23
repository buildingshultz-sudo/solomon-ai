```javascript
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import OpenAI from 'openai'

const execFileAsync = promisify(execFile)

const {
  OPENAI_API_KEY,
  IRONEDIT_MODEL = 'gpt-4o',
  TEMP_DIR = '/tmp',
  TRANSCRIBE_MODEL = 'whisper-1',
} = process.env

if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY required')

const openai = new OpenAI({ apiKey: OPENAI_API_KEY })

async function transcribeAudio(filePath) {
  const stats = await fs.stat(filePath)
  if (stats.size > 25 * 1024 * 1024)
    throw new Error('Audio file exceeds 25MB limit for Whisper API')

  const file = await fs.readFile(filePath)
  const buffer = Buffer.from(file)

  const resp = await openai.audio.transcriptions.create({
    file: buffer,
    filename: path.basename(filePath),
    model: TRANSCRIBE_MODEL,
    response_format: 'text',
    language: 'en',
  })
  return resp
}

async function extractAudio(videoPath, outDir = TEMP_DIR) {
  const audioPath = path.join(
    outDir,
    `audio-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`
  )
  await execFileAsync('ffmpeg', [
    '-i',
    videoPath,
    '-vn',
    '-acodec',
    'libmp3lame',
    '-ar',
    '44100',
    '-ac',
    '1',
    '-b:a',
    '128k',
    '-y',
    audioPath,
  ])
  return audioPath
}

const systemPrompt = `
You are an expert video metadata generator for IronEdit. Given a full video transcript, generate the following JSON:

{
  "title": "<Concise, engaging title>",
  "description": "<3-5 sentence description, summarize content, avoid clickbait>",
  "tags": ["tag1", "tag2", ..., "tagN"]
}

- Title: 8-14 words, no emojis, no clickbait.
- Description: Factual, not promotional, no hashtags.
- Tags: 8-15 relevant, lowercase, no spaces, no hashtags, single words or short phrases.
`.trim()

async function generateMetadata(transcript) {
  const resp = await openai.chat.completions.create({
    model: IRONEDIT_MODEL,
    temperature: 0.4,
    max_tokens: 512,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Transcript:\n${transcript}`,
      },
    ],
    response_format: { type: 'json_object' },
  })

  let obj
  try {
    obj = JSON.parse(resp.choices[0].message.content)
  } catch {
    throw new Error('Failed to parse metadata JSON from OpenAI')
  }

  if (
    !obj ||
    typeof obj.title !== 'string' ||
    typeof obj.description !== 'string' ||
    !Array.isArray(obj.tags)
  )
    throw new Error('Incomplete metadata returned from OpenAI')

  obj.tags = obj.tags.map((t) => t.trim().toLowerCase()).filter(Boolean)

  return obj
}

export async function generateVideoMetadata(videoPath) {
  if (!videoPath || typeof videoPath !== 'string')
    throw new TypeError('videoPath must be a string')
  let audioPath
  try {
    audioPath = await extractAudio(videoPath)
    const transcript = await transcribeAudio(audioPath)
    if (!transcript || transcript.trim().length < 10)
      throw new Error('Transcript too short or empty')
    const metadata = await generateMetadata(transcript)
    return metadata
  } finally {
    if (audioPath)
      fs.unlink(audioPath).catch(() => {})
  }
}

// Example CLI usage
if (process.argv[1] === import.meta.url) {
  const [,, videoFile] = process.argv
  if (!videoFile) {
    process.stderr.write('Usage: node ai-metadata-engine.js <video-file>\n')
    process.exit(1)
  }
  generateVideoMetadata(videoFile)
    .then((meta) => {
      process.stdout.write(JSON.stringify(meta, null, 2) + '\n')
    })
    .catch((err) => {
      process.stderr.write('Error: ' + err.message + '\n')
      process.exit(2)
    })
}
```