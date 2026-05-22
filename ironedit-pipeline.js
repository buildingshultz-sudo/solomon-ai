/**
 * IronEdit Production Pipeline
 * Drop-to-post video processing: silence removal, jump cuts, color grading,
 * audio normalization, thumbnail generation, and SEO package.
 * 
 * Executes via PC Agent (PowerShell + ffmpeg on Jed's PC).
 */

const path = require('path');

// ─── PIPELINE CONFIGURATION ──────────────────────────────────────────────────
const PIPELINE_CONFIG = {
  // Audio
  silenceThreshold: '-35dB',     // dB threshold for silence detection
  silenceMinDuration: 0.8,       // seconds — pauses longer than this get cut
  loudnessTarget: '-14',         // LUFS target for YouTube
  loudnessRange: '11',           // LRA
  truePeak: '-1.5',              // dBTP

  // Video
  colorPreset: 'building_shultz', // warm workshop look
  exportWidth: 1920,
  exportHeight: 1080,
  exportCodec: 'libx264',
  exportPreset: 'slow',
  exportCRF: '18',               // high quality
  exportAudioCodec: 'aac',
  exportAudioBitrate: '320k',
  exportPixFmt: 'yuv420p',

  // Thumbnail
  thumbnailWidth: 1280,
  thumbnailHeight: 720,

  // Paths
  outputSuffix: '_EDITED',
  thumbnailSuffix: '_THUMB',
};

// ─── COLOR GRADING PRESETS ───────────────────────────────────────────────────
const COLOR_PRESETS = {
  building_shultz: {
    // Warm workshop look: slightly warm shadows, boosted contrast, slight vignette
    filter: 'curves=r=0/0 0.25/0.22 0.5/0.5 0.75/0.78 1/1:g=0/0 0.25/0.24 0.5/0.5 0.75/0.76 1/1:b=0/0 0.25/0.20 0.5/0.48 0.75/0.73 1/0.95,eq=contrast=1.1:brightness=0.02:saturation=1.15',
    description: 'Warm workshop — amber shadows, boosted contrast, rich saturation'
  },
  cinematic: {
    filter: 'curves=r=0/0 0.25/0.20 0.5/0.48 0.75/0.78 1/1:b=0/0.02 0.25/0.22 0.5/0.47 0.75/0.70 1/0.90,eq=contrast=1.15:brightness=-0.01:saturation=0.9',
    description: 'Cinematic — teal shadows, warm highlights, desaturated'
  },
  clean: {
    filter: 'eq=contrast=1.05:brightness=0.01:saturation=1.05',
    description: 'Clean — minimal grading, slight contrast boost'
  }
};

// ─── PIPELINE STEPS ──────────────────────────────────────────────────────────

/**
 * Step 1: Detect silence segments in the video
 * Returns an array of {start, end} objects representing non-silent segments
 */
function buildSilenceDetectCommand(inputPath) {
  return `ffmpeg -i "${inputPath}" -af "silencedetect=noise=${PIPELINE_CONFIG.silenceThreshold}:d=${PIPELINE_CONFIG.silenceMinDuration}" -f null - 2>&1 | Select-String "silence_start|silence_end" | ForEach-Object { $_.Line }`;
}

/**
 * Parse silence detection output into keep-segments
 */
function parseSilenceOutput(output, videoDuration) {
  const lines = output.split('\n').filter(l => l.includes('silence_'));
  const silences = [];
  let currentStart = null;

  for (const line of lines) {
    const startMatch = line.match(/silence_start:\s*([\d.]+)/);
    const endMatch = line.match(/silence_end:\s*([\d.]+)/);
    
    if (startMatch) currentStart = parseFloat(startMatch[1]);
    if (endMatch && currentStart !== null) {
      silences.push({ start: currentStart, end: parseFloat(endMatch[1]) });
      currentStart = null;
    }
  }

  // If silence started but didn't end, it goes to the end
  if (currentStart !== null) {
    silences.push({ start: currentStart, end: videoDuration });
  }

  // Build keep-segments (inverse of silences)
  const segments = [];
  let lastEnd = 0;

  for (const silence of silences) {
    if (silence.start > lastEnd + 0.1) { // Keep segments > 0.1s
      segments.push({ start: lastEnd, end: silence.start });
    }
    lastEnd = silence.end;
  }

  // Add final segment
  if (lastEnd < videoDuration - 0.1) {
    segments.push({ start: lastEnd, end: videoDuration });
  }

  return segments;
}

/**
 * Step 2: Build the ffmpeg filter complex for jump cuts + color + audio
 * Uses segment concat approach for clean cuts
 */
function buildProcessingCommand(inputPath, outputPath, segments, colorPreset) {
  const preset = COLOR_PRESETS[colorPreset] || COLOR_PRESETS.building_shultz;
  
  if (segments.length === 0) {
    // No silence detected — just apply color + audio normalization
    return buildSimpleProcessCommand(inputPath, outputPath, preset);
  }

  // Build segment filter with concat
  // For many segments, use a trim-based approach
  const videoFilters = segments.map((seg, i) => 
    `[0:v]trim=start=${seg.start.toFixed(3)}:end=${seg.end.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`
  ).join('; ');

  const audioFilters = segments.map((seg, i) => 
    `[0:a]atrim=start=${seg.start.toFixed(3)}:end=${seg.end.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`
  ).join('; ');

  const concatInputs = segments.map((_, i) => `[v${i}][a${i}]`).join('');
  const concatFilter = `${concatInputs}concat=n=${segments.length}:v=1:a=1[outv][outa]`;

  // Apply color grading and audio normalization to concatenated output
  const colorFilter = `[outv]${preset.filter}[colorv]`;
  const audioNorm = `[outa]loudnorm=I=${PIPELINE_CONFIG.loudnessTarget}:LRA=${PIPELINE_CONFIG.loudnessRange}:TP=${PIPELINE_CONFIG.truePeak}[norma]`;

  const fullFilter = `${videoFilters}; ${audioFilters}; ${concatFilter}; ${colorFilter}; ${audioNorm}`;

  // If filter is too long for command line, use a filter script approach
  if (segments.length > 30) {
    // Too many segments — use a simpler 2-pass approach
    return buildTwoPassCommand(inputPath, outputPath, segments, preset);
  }

  return `ffmpeg -y -i "${inputPath}" -filter_complex "${fullFilter}" -map "[colorv]" -map "[norma]" -c:v ${PIPELINE_CONFIG.exportCodec} -preset ${PIPELINE_CONFIG.exportPreset} -crf ${PIPELINE_CONFIG.exportCRF} -c:a ${PIPELINE_CONFIG.exportAudioCodec} -b:a ${PIPELINE_CONFIG.exportAudioBitrate} -pix_fmt ${PIPELINE_CONFIG.exportPixFmt} -movflags +faststart "${outputPath}"`;
}

/**
 * Simple processing (no cuts needed)
 */
function buildSimpleProcessCommand(inputPath, outputPath, preset) {
  return `ffmpeg -y -i "${inputPath}" -vf "${preset.filter}" -af "loudnorm=I=${PIPELINE_CONFIG.loudnessTarget}:LRA=${PIPELINE_CONFIG.loudnessRange}:TP=${PIPELINE_CONFIG.truePeak}" -c:v ${PIPELINE_CONFIG.exportCodec} -preset ${PIPELINE_CONFIG.exportPreset} -crf ${PIPELINE_CONFIG.exportCRF} -c:a ${PIPELINE_CONFIG.exportAudioCodec} -b:a ${PIPELINE_CONFIG.exportAudioBitrate} -pix_fmt ${PIPELINE_CONFIG.exportPixFmt} -movflags +faststart "${outputPath}"`;
}

/**
 * Two-pass approach for videos with many segments (>30 cuts)
 * Pass 1: Create segment list file, use concat demuxer
 * Pass 2: Apply color + audio to concatenated result
 */
function buildTwoPassCommand(inputPath, outputPath, segments, preset) {
  const tempPath = outputPath.replace(/\.[^.]+$/, '_temp.mp4');
  const segListPath = outputPath.replace(/\.[^.]+$/, '_segments.txt');
  
  // Build segment list content for PowerShell to write
  const segContent = segments.map(s => 
    `file '${inputPath.replace(/'/g, "'\\''")}'\\ninpoint ${s.start.toFixed(3)}\\noutpoint ${s.end.toFixed(3)}`
  ).join('\\n');

  const writeSegList = `$segContent = "${segContent}"; $segContent | Out-File -FilePath "${segListPath}" -Encoding utf8`;
  const pass1 = `ffmpeg -y -f concat -safe 0 -i "${segListPath}" -c copy "${tempPath}"`;
  const pass2 = `ffmpeg -y -i "${tempPath}" -vf "${preset.filter}" -af "loudnorm=I=${PIPELINE_CONFIG.loudnessTarget}:LRA=${PIPELINE_CONFIG.loudnessRange}:TP=${PIPELINE_CONFIG.truePeak}" -c:v ${PIPELINE_CONFIG.exportCodec} -preset ${PIPELINE_CONFIG.exportPreset} -crf ${PIPELINE_CONFIG.exportCRF} -c:a ${PIPELINE_CONFIG.exportAudioCodec} -b:a ${PIPELINE_CONFIG.exportAudioBitrate} -pix_fmt ${PIPELINE_CONFIG.exportPixFmt} -movflags +faststart "${outputPath}"`;
  const cleanup = `Remove-Item "${tempPath}" -ErrorAction SilentlyContinue; Remove-Item "${segListPath}" -ErrorAction SilentlyContinue`;

  return `${writeSegList}; ${pass1}; ${pass2}; ${cleanup}`;
}

/**
 * Step 3: Extract best thumbnail frame
 * Uses scene detection to find high-contrast/interesting frames
 */
function buildThumbnailCommand(inputPath, outputDir, filename) {
  const thumbPath = path.join(outputDir, `${filename}${PIPELINE_CONFIG.thumbnailSuffix}.jpg`).replace(/\\/g, '\\\\');
  // Extract 10 candidate frames using scene detection, then pick the one with highest contrast
  const candidatesDir = path.join(outputDir, '_thumb_candidates').replace(/\\/g, '\\\\');
  
  return {
    // Step A: Extract scene-change frames
    extractFrames: `New-Item -ItemType Directory -Force -Path "${candidatesDir}" | Out-Null; ffmpeg -y -i "${inputPath}" -vf "select='gt(scene,0.3)',scale=${PIPELINE_CONFIG.thumbnailWidth}:${PIPELINE_CONFIG.thumbnailHeight}" -frames:v 10 -vsync vfr "${candidatesDir}\\frame_%03d.jpg" 2>&1 | Select-String "frame"`,
    // Step B: If no scene frames found, extract from key moments (10%, 25%, 50%)
    fallbackFrames: `ffmpeg -y -i "${inputPath}" -vf "select='eq(n,0)+eq(n,100)+eq(n,300)+eq(n,500)',scale=${PIPELINE_CONFIG.thumbnailWidth}:${PIPELINE_CONFIG.thumbnailHeight}" -frames:v 4 -vsync vfr "${candidatesDir}\\frame_%03d.jpg"`,
    // Step C: Pick the best frame (largest file = most detail/contrast)
    pickBest: `$best = Get-ChildItem "${candidatesDir}\\*.jpg" | Sort-Object Length -Descending | Select-Object -First 1; if($best) { Copy-Item $best.FullName "${thumbPath}"; Write-Output "Thumbnail: ${thumbPath}" } else { Write-Output "No frames extracted" }`,
    // Step D: Cleanup candidates
    cleanup: `Remove-Item -Recurse -Force "${candidatesDir}" -ErrorAction SilentlyContinue`,
    thumbPath: thumbPath
  };
}

/**
 * Step 4: Get video duration
 */
function buildDurationCommand(inputPath) {
  return `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`;
}

/**
 * Step 5: Get video info (resolution, codec, fps)
 */
function buildInfoCommand(inputPath) {
  return `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,codec_name -show_entries format=duration,size -of json "${inputPath}"`;
}

/**
 * Generate SEO package prompt for GPT-4o
 */
function buildSEOPrompt(videoContext, channelContext) {
  return `You are a YouTube SEO expert specializing in the maker/tradesman/DIY niche. Generate a complete SEO package for this video.

CHANNEL: Building Shultz (~1,450 subscribers)
NICHE: Woodworking, metalworking, DIY, AI integration for tradesmen
BRAND VOICE: Authentic, motivational, blue-collar, "Be Inspired, Stay Humble, and Build"
TARGET AUDIENCE: Tradesmen, makers, DIY enthusiasts, men 25-55 who want to build something meaningful

VIDEO CONTEXT: ${videoContext}

Generate:

1. **TITLES** (5 options, ranked by estimated CTR):
   - Use curiosity gaps, power words, and numbers where appropriate
   - Keep under 60 characters
   - Include primary keyword naturally
   - Format: [Title] | Estimated CTR: [low/medium/high]

2. **DESCRIPTION** (full YouTube description):
   - First 2 lines: compelling hook (shows in search results)
   - Paragraph 1: what the video covers
   - Paragraph 2: why it matters / who it's for
   - Timestamps section (placeholder: [ADD TIMESTAMPS])
   - Links section: Channel link, social links placeholders
   - Keywords naturally woven throughout
   - Call to action: subscribe, comment, share
   - End with: "Be Inspired, Stay Humble, and Build. 🔨"

3. **TAGS** (30+ tags):
   - Mix of broad (1-2 word) and long-tail (3-5 word)
   - Include: primary keyword, secondary keywords, channel name, niche terms
   - Format: comma-separated list

4. **CATEGORY**: Best YouTube category for this content

5. **THUMBNAIL TEXT**: 2-4 words that should appear on the thumbnail (bold, high contrast, readable at small size)

Be specific and actionable. No generic advice.`;
}

/**
 * Master pipeline orchestrator
 * Returns an array of steps to execute in sequence
 */
function buildPipeline(inputPath, options = {}) {
  const dir = path.dirname(inputPath);
  const ext = path.extname(inputPath);
  const basename = path.basename(inputPath, ext);
  const outputPath = path.join(dir, `${basename}${PIPELINE_CONFIG.outputSuffix}${ext}`).replace(/\\/g, '\\\\');
  const colorPreset = options.colorPreset || 'building_shultz';

  return {
    inputPath,
    outputPath,
    dir,
    basename,
    steps: [
      { name: 'get_info', description: 'Getting video info', command: buildInfoCommand(inputPath) },
      { name: 'get_duration', description: 'Getting video duration', command: buildDurationCommand(inputPath) },
      { name: 'detect_silence', description: 'Detecting silence/dead space', command: buildSilenceDetectCommand(inputPath) },
      // Steps 4-6 are dynamic — built after silence detection results
      { name: 'process_video', description: 'Processing video (cuts + color + audio)', command: null }, // filled dynamically
      { name: 'extract_thumbnail', description: 'Extracting best thumbnail frame', commands: buildThumbnailCommand(inputPath, dir, basename) },
      { name: 'generate_seo', description: 'Generating SEO package', command: null }, // done via LLM
      { name: 'verify_output', description: 'Verifying output file', command: `if(Test-Path "${outputPath}") { $f = Get-Item "${outputPath}"; Write-Output "OK: $($f.Length / 1MB) MB" } else { Write-Output "FAILED: Output not found" }` }
    ],
    config: PIPELINE_CONFIG,
    colorPreset,
    parseSilenceOutput,
    buildProcessingCommand: (segments) => buildProcessingCommand(inputPath, outputPath, segments, colorPreset),
    buildSEOPrompt
  };
}

module.exports = {
  buildPipeline,
  parseSilenceOutput,
  buildProcessingCommand,
  buildThumbnailCommand,
  buildSEOPrompt,
  PIPELINE_CONFIG,
  COLOR_PRESETS
};
