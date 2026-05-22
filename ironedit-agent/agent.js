#!/usr/bin/env node
/**
 * IronEdit Server-Side FFmpeg Rendering Agent
 *
 * Connects to the IronEdit API via WebSocket as a registered agent,
 * receives job commands, and executes them using FFmpeg on the server.
 *
 * Supported job types:
 *   - execute_render   → FFmpeg render from EDL
 *   - analyze_clip     → ffprobe scene/silence analysis
 *   - generate_proxies → FFmpeg proxy generation
 *   - auto_edit        → AI EDL plan + FFmpeg render
 *   - transcribe       → Whisper transcription via OpenAI
 *
 * Usage: node agent.js
 */

import WebSocket from "ws";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import https from "node:https";
import http from "node:http";

const execFileAsync = promisify(execFile);

// ── Configuration ─────────────────────────────────────────────────────────────
const API_WS   = process.env.IRONEDIT_WS_URL  || "ws://localhost:8080/agent";
const API_KEY  = process.env.IRONEDIT_AGENT_KEY || "dev-agent-key-please-rotate";
const WORK_DIR = process.env.IRONEDIT_WORK_DIR  || "/root/ironedit-renders";
const FFMPEG   = process.env.FFMPEG_BIN         || "ffmpeg";
const FFPROBE  = process.env.FFPROBE_BIN        || "ffprobe";
const AGENT_VERSION = "ironedit-ffmpeg-agent/1.0";
const PLATFORM      = "linux-server";

// Reconnect settings
const RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT_DELAY = 60000;

let ws = null;
let reconnectDelay = RECONNECT_DELAY_MS;
let shuttingDown = false;

// ── Logging ───────────────────────────────────────────────────────────────────
function log(level, msg, extra = {}) {
  const entry = { time: new Date().toISOString(), level, msg, ...extra };
  console.log(JSON.stringify(entry));
}

// ── Ensure work directory exists ──────────────────────────────────────────────
await fs.mkdir(WORK_DIR, { recursive: true });
log("info", "agent starting", { ws_url: API_WS, work_dir: WORK_DIR, ffmpeg: FFMPEG });

// ── WebSocket connection ──────────────────────────────────────────────────────
function connect() {
  if (shuttingDown) return;

  log("info", "connecting to API", { url: API_WS });

  ws = new WebSocket(API_WS, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });

  ws.on("open", () => {
    reconnectDelay = RECONNECT_DELAY_MS;
    log("info", "connected to IronEdit API");

    // Send agent_hello
    send({
      type: "agent_hello",
      api_key: API_KEY,
      agent_version: AGENT_VERSION,
      platform: PLATFORM,
    });
  });

  ws.on("message", (data) => {
    let cmd;
    try {
      cmd = JSON.parse(data.toString());
    } catch (e) {
      log("warn", "malformed JSON from server", { err: e.message });
      return;
    }
    handleCommand(cmd).catch((err) => {
      log("error", "unhandled error in handleCommand", { err: err.message, stack: err.stack });
    });
  });

  ws.on("close", (code, reason) => {
    log("info", "disconnected from API", { code, reason: reason.toString() });
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    log("warn", "websocket error", { err: err.message });
  });
}

function scheduleReconnect() {
  if (shuttingDown) return;
  log("info", "reconnecting", { delay_ms: reconnectDelay });
  setTimeout(() => connect(), reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// ── Command dispatcher ────────────────────────────────────────────────────────
async function handleCommand(cmd) {
  switch (cmd.type) {
    case "hello":
      log("info", "server hello received", { agent_version: cmd.agent_version });
      return;

    case "ping":
      send({ type: "pong" });
      return;

    case "execute_render":
      await handleExecuteRender(cmd);
      return;

    case "analyze_clip":
      await handleAnalyzeClip(cmd);
      return;

    case "generate_proxies":
      await handleGenerateProxies(cmd);
      return;

    case "auto_edit":
      await handleAutoEdit(cmd);
      return;

    case "transcribe":
      await handleTranscribe(cmd);
      return;

    case "cancel_job":
      log("info", "cancel_job received (no-op for server agent)", { job_id: cmd.job_id });
      return;

    default:
      log("warn", "unknown command type", { type: cmd.type });
  }
}

// ── execute_render: FFmpeg EDL renderer ───────────────────────────────────────
async function handleExecuteRender(cmd) {
  const { job_id, edl } = cmd;
  log("info", "execute_render started", { job_id });

  try {
    send({ type: "job_progress", job_id, progress: 0.05, message: "building FFmpeg command" });

    const outputPath = resolveOutputPath(edl.output, job_id);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const ffArgs = buildFFmpegArgs(edl, outputPath);
    log("info", "running FFmpeg", { job_id, args: ffArgs.join(" ") });

    send({ type: "job_progress", job_id, progress: 0.1, message: "FFmpeg rendering..." });

    await runFFmpeg(ffArgs, (progress) => {
      send({ type: "job_progress", job_id, progress: 0.1 + progress * 0.85, message: `rendering ${Math.round(progress * 100)}%` });
    });

    // Apply audio normalization if requested (two-pass loudnorm)
    let finalPath = outputPath;
    if (edl.audio_normalize?.target_lufs) {
      send({ type: "job_progress", job_id, progress: 0.95, message: "normalizing audio..." });
      finalPath = await applyLoudnorm(outputPath, edl.audio_normalize.target_lufs, job_id);
    }

    const stat = await fs.stat(finalPath);
    log("info", "execute_render complete", { job_id, output: finalPath, size_bytes: stat.size });
    send({ type: "job_complete", job_id, artifact: finalPath });

  } catch (err) {
    log("error", "execute_render failed", { job_id, err: err.message });
    send({ type: "job_error", job_id, error: err.message });
  }
}

/**
 * Build FFmpeg filter_complex + concat command from an EDL.
 * Handles: multi-clip concat, scale, color eq (brightness/contrast/saturation/gamma),
 * audio gain, crossfade, subtitle burn-in.
 */
function buildFFmpegArgs(edl, outputPath) {
  // Default to 1280x720 to avoid OOM on 2GB VPS; user can override via EDL
  const { cuts, width = 1280, height = 720, fps = 30, burn_subtitles } = edl;

  const inputs = [];
  const filterParts = [];
  const videoStreams = [];
  const audioStreams = [];

  // Deduplicate input files (FFmpeg needs one -i per unique source)
  const sourceIndex = new Map();
  for (const cut of cuts) {
    if (!sourceIndex.has(cut.source)) {
      sourceIndex.set(cut.source, sourceIndex.size);
      inputs.push("-i", cut.source);
    }
  }

  // Build per-cut trim + scale + eq filters
  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i];
    const si = sourceIndex.get(cut.source);
    const inPt = cut.in_seconds.toFixed(6);
    const outPt = cut.out_seconds.toFixed(6);
    const dur = (cut.out_seconds - cut.in_seconds).toFixed(6);

    // Video: trim → scale → eq → setpts
    let vf = `[${si}:v]trim=start=${inPt}:end=${outPt},setpts=PTS-STARTPTS`;
    const scaleStr = cut.scale || `${width}:${height}`;
    vf += `,scale=${scaleStr}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
    vf += `,fps=${fps}`;

    if (cut.eq) {
      const { brightness = 0, contrast = 1, saturation = 1, gamma = 1 } = cut.eq;
      // FFmpeg eq filter: contrast, brightness, saturation, gamma
      vf += `,eq=contrast=${contrast}:brightness=${brightness}:saturation=${saturation}:gamma=${gamma}`;
    }

    vf += `[v${i}]`;
    filterParts.push(vf);

    // Audio: trim → volume → asetpts
    let af = `[${si}:a]atrim=start=${inPt}:end=${outPt},asetpts=PTS-STARTPTS`;
    if (cut.audio_gain_db) {
      af += `,volume=${cut.audio_gain_db}dB`;
    }
    af += `[a${i}]`;
    filterParts.push(af);

    videoStreams.push(`[v${i}]`);
    audioStreams.push(`[a${i}]`);
  }

  // Concat all segments
  // FFmpeg concat filter requires interleaved v/a pairs: [v0][a0][v1][a1]...
  const n = cuts.length;
  const interleavedStreams = [];
  for (let i = 0; i < n; i++) {
    interleavedStreams.push(`[v${i}]`, `[a${i}]`);
  }
  const concatFilter = `${interleavedStreams.join("")}concat=n=${n}:v=1:a=1[vout][aout]`;
  filterParts.push(concatFilter);

  let finalVideo = "[vout]";
  let finalAudio = "[aout]";

  // Subtitle burn-in
  if (burn_subtitles) {
    filterParts.push(`[vout]subtitles='${burn_subtitles.replace(/'/g, "\\'")}':force_style='FontSize=24,PrimaryColour=&HFFFFFF'[vfinal]`);
    finalVideo = "[vfinal]";
  }

  const args = [
    "-y",
    ...inputs,
    "-filter_complex", filterParts.join(";"),
    "-map", finalVideo,
    "-map", finalAudio,
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "26",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    outputPath,
  ];

  return args;
}

async function runFFmpeg(args, progressCb) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args, { stdio: ["ignore", "pipe", "pipe"] });
    let duration = null;
    let stderr = "";

    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;

      // Parse duration from FFmpeg output
      if (!duration) {
        const m = text.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
        if (m) {
          duration = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
        }
      }

      // Parse progress
      if (duration && progressCb) {
        const tm = text.match(/time=(\d+):(\d+):(\d+\.\d+)/);
        if (tm) {
          const elapsed = parseInt(tm[1]) * 3600 + parseInt(tm[2]) * 60 + parseFloat(tm[3]);
          progressCb(Math.min(elapsed / duration, 0.99));
        }
      }
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        // Extract last meaningful error line
        const errLines = stderr.split("\n").filter(l => l.trim()).slice(-10).join("\n");
        reject(new Error(`FFmpeg exited with code ${code}: ${errLines}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn FFmpeg: ${err.message}`));
    });
  });
}

async function applyLoudnorm(inputPath, targetLufs, jobId) {
  const ext = path.extname(inputPath);
  const base = inputPath.slice(0, -ext.length);
  const normalized = `${base}_norm${ext}`;

  // Pass 1: measure
  log("info", "loudnorm pass 1", { job_id: jobId });
  const { stderr: pass1Stderr } = await execFileAsync(FFMPEG, [
    "-y", "-i", inputPath,
    "-af", `loudnorm=I=${targetLufs}:TP=-1.5:LRA=11:print_format=json`,
    "-f", "null", "/dev/null",
  ]).catch(e => ({ stderr: e.stderr || "" }));

  // Extract loudnorm stats from pass 1
  const jsonMatch = pass1Stderr.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
  let pass2Filter = `loudnorm=I=${targetLufs}:TP=-1.5:LRA=11`;
  if (jsonMatch) {
    try {
      const stats = JSON.parse(jsonMatch[0]);
      pass2Filter = `loudnorm=I=${targetLufs}:TP=-1.5:LRA=11:measured_I=${stats.input_i}:measured_TP=${stats.input_tp}:measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}:offset=${stats.target_offset}:linear=true`;
    } catch (e) {
      log("warn", "could not parse loudnorm stats, using single-pass", { job_id: jobId });
    }
  }

  // Pass 2: apply
  log("info", "loudnorm pass 2", { job_id: jobId });
  await runFFmpeg([
    "-y", "-i", inputPath,
    "-af", pass2Filter,
    "-c:v", "copy",
    "-c:a", "aac", "-b:a", "128k",
    normalized,
  ], null);

  // Replace original with normalized
  await fs.unlink(inputPath);
  await fs.rename(normalized, inputPath);
  return inputPath;
}

// ── analyze_clip: ffprobe scene + silence detection ───────────────────────────
async function handleAnalyzeClip(cmd) {
  const { job_id, clip_path, scene_threshold = 0.3, silence_db = -40 } = cmd;
  log("info", "analyze_clip started", { job_id, clip_path });

  try {
    send({ type: "job_progress", job_id, progress: 0.1, message: "probing clip..." });

    // Get duration and basic info
    const { stdout: probeOut } = await execFileAsync(FFPROBE, [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      clip_path,
    ]);
    const probe = JSON.parse(probeOut);
    const videoStream = probe.streams.find(s => s.codec_type === "video");
    const duration = parseFloat(probe.format.duration || "0");

    send({ type: "job_progress", job_id, progress: 0.3, message: "detecting scenes..." });

    // Scene detection
    const { stderr: sceneOut } = await execFileAsync(FFMPEG, [
      "-i", clip_path,
      "-vf", `select='gt(scene,${scene_threshold})',showinfo`,
      "-f", "null", "/dev/null",
    ]).catch(e => ({ stderr: e.stderr || "" }));

    const sceneTimes = [];
    for (const line of sceneOut.split("\n")) {
      const m = line.match(/pts_time:([\d.]+)/);
      if (m) sceneTimes.push(parseFloat(m[1]));
    }

    send({ type: "job_progress", job_id, progress: 0.6, message: "detecting silences..." });

    // Silence detection
    const { stderr: silenceOut } = await execFileAsync(FFMPEG, [
      "-i", clip_path,
      "-af", `silencedetect=n=${silence_db}dB:d=0.5`,
      "-f", "null", "/dev/null",
    ]).catch(e => ({ stderr: e.stderr || "" }));

    const silences = [];
    let silenceStart = null;
    for (const line of silenceOut.split("\n")) {
      const startM = line.match(/silence_start:\s*([\d.]+)/);
      const endM = line.match(/silence_end:\s*([\d.]+)/);
      if (startM) silenceStart = parseFloat(startM[1]);
      if (endM && silenceStart !== null) {
        silences.push({ start: silenceStart, end: parseFloat(endM[1]) });
        silenceStart = null;
      }
    }

    send({ type: "job_progress", job_id, progress: 0.85, message: "measuring loudness..." });

    // Loudness measurement
    const { stderr: loudnessOut } = await execFileAsync(FFMPEG, [
      "-i", clip_path,
      "-af", "loudnorm=I=-23:TP=-1.5:LRA=11:print_format=json",
      "-f", "null", "/dev/null",
    ]).catch(e => ({ stderr: e.stderr || "" }));

    let loudness = null;
    const loudnessMatch = loudnessOut.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
    if (loudnessMatch) {
      try {
        const stats = JSON.parse(loudnessMatch[0]);
        loudness = {
          integrated_lufs: parseFloat(stats.input_i),
          loudness_range: parseFloat(stats.input_lra),
          true_peak_dbtp: parseFloat(stats.input_tp),
        };
      } catch (e) { /* ignore */ }
    }

    const report = {
      source: clip_path,
      duration,
      width: videoStream?.width,
      height: videoStream?.height,
      fps: videoStream ? eval(videoStream.r_frame_rate) : null,
      codec: videoStream?.codec_name,
      scene_times: sceneTimes,
      silences,
      loudness,
    };

    log("info", "analyze_clip complete", { job_id, scenes: sceneTimes.length, silences: silences.length });
    send({
      type: "analysis_report",
      job_id,
      json: JSON.stringify(report),
    });

  } catch (err) {
    log("error", "analyze_clip failed", { job_id, err: err.message });
    send({ type: "job_error", job_id, error: err.message });
  }
}

// ── generate_proxies: create low-res proxy files ──────────────────────────────
async function handleGenerateProxies(cmd) {
  const { job_id, source_dir, force = false } = cmd;
  log("info", "generate_proxies started", { job_id, source_dir });

  try {
    send({ type: "job_progress", job_id, progress: 0.05, message: "scanning source directory..." });

    // Find video files
    let files;
    try {
      const entries = await fs.readdir(source_dir, { withFileTypes: true });
      files = entries
        .filter(e => e.isFile() && /\.(mp4|mov|avi|mkv|mxf|r3d|braw|m4v|webm)$/i.test(e.name))
        .map(e => path.join(source_dir, e.name));
    } catch (err) {
      throw new Error(`Cannot read source_dir '${source_dir}': ${err.message}`);
    }

    if (files.length === 0) {
      send({ type: "job_complete", job_id, artifact: JSON.stringify({ proxies: [], message: "no video files found" }) });
      return;
    }

    const proxyDir = path.join(source_dir, "proxies");
    await fs.mkdir(proxyDir, { recursive: true });

    const proxies = [];
    for (let i = 0; i < files.length; i++) {
      const src = files[i];
      const proxyName = path.basename(src, path.extname(src)) + "_proxy.mp4";
      const proxyPath = path.join(proxyDir, proxyName);

      const progress = 0.1 + (i / files.length) * 0.85;
      send({ type: "job_progress", job_id, progress, message: `creating proxy ${i + 1}/${files.length}: ${path.basename(src)}` });

      // Skip if proxy already exists and not forced
      try {
        await fs.access(proxyPath);
        if (!force) {
          proxies.push({ source: src, proxy: proxyPath, skipped: true });
          continue;
        }
      } catch { /* doesn't exist, create it */ }

      await runFFmpeg([
        "-y", "-i", src,
        "-vf", "scale=960:540:force_original_aspect_ratio=decrease",
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30",
        "-c:a", "aac", "-b:a", "96k",
        proxyPath,
      ], null);

      proxies.push({ source: src, proxy: proxyPath });
    }

    log("info", "generate_proxies complete", { job_id, count: proxies.length });
    send({ type: "job_complete", job_id, artifact: JSON.stringify({ proxies }) });

  } catch (err) {
    log("error", "generate_proxies failed", { job_id, err: err.message });
    send({ type: "job_error", job_id, error: err.message });
  }
}

// ── auto_edit: plan EDL via API then render ───────────────────────────────────
async function handleAutoEdit(cmd) {
  const { job_id, clip_paths, broll_paths = [], config: cfg } = cmd;
  log("info", "auto_edit started", { job_id, clips: clip_paths.length });

  try {
    send({ type: "job_progress", job_id, progress: 0.05, message: "analyzing clips..." });

    // Analyze each clip to get scene times and silences
    const clipDescriptors = [];
    for (let i = 0; i < clip_paths.length; i++) {
      const clipPath = clip_paths[i];
      const progress = 0.05 + (i / clip_paths.length) * 0.3;
      send({ type: "job_progress", job_id, progress, message: `analyzing clip ${i + 1}/${clip_paths.length}` });

      try {
        const desc = await analyzeClipForEDL(clipPath);
        clipDescriptors.push(desc);
      } catch (err) {
        log("warn", "clip analysis failed, using defaults", { clip: clipPath, err: err.message });
        clipDescriptors.push({ source: clipPath, duration_seconds: 10 });
      }
    }

    send({ type: "job_progress", job_id, progress: 0.4, message: "synthesizing EDL with AI..." });

    // Call the analyze endpoint on the API to get an AI-generated EDL
    const analyzePayload = {
      brief: cfg.output ? `Auto-edit: ${path.basename(cfg.output)}` : "Auto-edit compilation",
      output_path: cfg.output,
      width: cfg.width || 1920,
      height: cfg.height || 1080,
      fps: cfg.fps || 30,
      clips: clipDescriptors,
      style: "high_retention",
      target_runtime_seconds: cfg.target_runtime || 60,
      audio_normalize_lufs: cfg.target_lufs || -14,
      max_segment_seconds: cfg.max_segment || 6,
    };

    const edl = await callAnalyzeAPI(analyzePayload);

    // Emit the planned EDL so the server can store it
    send({
      type: "auto_edit_planned",
      job_id,
      edl_json: JSON.stringify(edl),
    });

    send({ type: "job_progress", job_id, progress: 0.5, message: "rendering with FFmpeg..." });

    // Now render it
    const outputPath = resolveOutputPath(cfg.output, job_id);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const ffArgs = buildFFmpegArgs(edl, outputPath);
    await runFFmpeg(ffArgs, (p) => {
      send({ type: "job_progress", job_id, progress: 0.5 + p * 0.45, message: `rendering ${Math.round(p * 100)}%` });
    });

    if (edl.audio_normalize?.target_lufs) {
      send({ type: "job_progress", job_id, progress: 0.96, message: "normalizing audio..." });
      await applyLoudnorm(outputPath, edl.audio_normalize.target_lufs, job_id);
    }

    log("info", "auto_edit complete", { job_id, output: outputPath });
    send({ type: "job_complete", job_id, artifact: outputPath });

  } catch (err) {
    log("error", "auto_edit failed", { job_id, err: err.message });
    send({ type: "job_error", job_id, error: err.message });
  }
}

async function analyzeClipForEDL(clipPath) {
  const { stdout: probeOut } = await execFileAsync(FFPROBE, [
    "-v", "quiet", "-print_format", "json",
    "-show_format", "-show_streams", clipPath,
  ]);
  const probe = JSON.parse(probeOut);
  const duration = parseFloat(probe.format.duration || "0");

  const { stderr: sceneOut } = await execFileAsync(FFMPEG, [
    "-i", clipPath,
    "-vf", "select='gt(scene,0.3)',showinfo",
    "-f", "null", "/dev/null",
  ]).catch(e => ({ stderr: e.stderr || "" }));

  const sceneTimes = [];
  for (const line of sceneOut.split("\n")) {
    const m = line.match(/pts_time:([\d.]+)/);
    if (m) sceneTimes.push(parseFloat(m[1]));
  }

  const { stderr: silenceOut } = await execFileAsync(FFMPEG, [
    "-i", clipPath,
    "-af", "silencedetect=n=-40dB:d=0.5",
    "-f", "null", "/dev/null",
  ]).catch(e => ({ stderr: e.stderr || "" }));

  const silences = [];
  let silenceStart = null;
  for (const line of silenceOut.split("\n")) {
    const startM = line.match(/silence_start:\s*([\d.]+)/);
    const endM = line.match(/silence_end:\s*([\d.]+)/);
    if (startM) silenceStart = parseFloat(startM[1]);
    if (endM && silenceStart !== null) {
      silences.push({ start: silenceStart, end: parseFloat(endM[1]) });
      silenceStart = null;
    }
  }

  return {
    source: clipPath,
    duration_seconds: duration,
    scene_times: sceneTimes,
    silences,
  };
}

function callAnalyzeAPI(payload) {
  return new Promise((resolve, reject) => {
    const apiBase = process.env.IRONEDIT_API_URL || "http://localhost:8080";
    const controlKey = process.env.IRONEDIT_CONTROL_KEY || "dev-control-key-please-rotate";
    const body = JSON.stringify(payload);
    const url = new URL(`${apiBase}/api/jobs`);
    const isHttps = url.protocol === "https:";
    const lib = isHttps ? https : http;

    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "Authorization": `Bearer ${controlKey}`,
        "X-Job-Kind": "analyze",
      },
    }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.job?.edl) {
            resolve(parsed.job.edl);
          } else {
            reject(new Error(`API analyze returned no EDL: ${data}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse API response: ${e.message}`));
        }
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── transcribe: Whisper via OpenAI API ───────────────────────────────────────
async function handleTranscribe(cmd) {
  const { job_id, clip_path, out_srt, model = "whisper-1" } = cmd;
  log("info", "transcribe started", { job_id, clip_path });

  try {
    send({ type: "job_progress", job_id, progress: 0.1, message: "extracting audio..." });

    // Extract audio as WAV for Whisper
    const audioPath = path.join(WORK_DIR, `${job_id}_audio.wav`);
    await runFFmpeg([
      "-y", "-i", clip_path,
      "-vn", "-ar", "16000", "-ac", "1",
      "-c:a", "pcm_s16le",
      audioPath,
    ], null);

    send({ type: "job_progress", job_id, progress: 0.4, message: "transcribing with Whisper..." });

    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      throw new Error("OPENAI_API_KEY not set — cannot transcribe");
    }

    // Call OpenAI Whisper API
    const audioData = await fs.readFile(audioPath);
    const srtContent = await callWhisperAPI(audioData, model, openaiKey);

    await fs.mkdir(path.dirname(out_srt), { recursive: true });
    await fs.writeFile(out_srt, srtContent, "utf8");

    // Cleanup temp audio
    await fs.unlink(audioPath).catch(() => {});

    log("info", "transcribe complete", { job_id, out_srt });
    send({ type: "job_complete", job_id, artifact: out_srt });

  } catch (err) {
    log("error", "transcribe failed", { job_id, err: err.message });
    send({ type: "job_error", job_id, error: err.message });
  }
}

async function callWhisperAPI(audioBuffer, model, apiKey) {
  // Use FormData-style multipart upload
  const boundary = `----FormBoundary${randomUUID().replace(/-/g, "")}`;
  const filename = "audio.wav";
  const mimeType = "audio/wav";

  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model}`,
    `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\nsrt`,
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
  ];

  const header = Buffer.from(parts.join("\r\n") + "\r\n");
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([header, audioBuffer, footer]);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.openai.com",
      path: "/v1/audio/transcriptions",
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": body.length,
      },
    }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        if (res.statusCode === 200) {
          resolve(data); // SRT format
        } else {
          reject(new Error(`Whisper API error ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function resolveOutputPath(edlOutput, jobId) {
  // If the EDL output path is a Windows path or doesn't exist on this server,
  // redirect to our work directory
  if (!edlOutput || edlOutput.match(/^[A-Za-z]:\\/)) {
    const ext = edlOutput ? path.extname(edlOutput) || ".mp4" : ".mp4";
    const basename = edlOutput ? path.basename(edlOutput) : `render_${jobId}${ext}`;
    return path.join(WORK_DIR, basename);
  }
  // Relative paths → work dir
  if (!path.isAbsolute(edlOutput)) {
    return path.join(WORK_DIR, edlOutput);
  }
  return edlOutput;
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
process.on("SIGINT", () => {
  log("info", "SIGINT received, shutting down");
  shuttingDown = true;
  if (ws) ws.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  log("info", "SIGTERM received, shutting down");
  shuttingDown = true;
  if (ws) ws.close();
  process.exit(0);
});

// ── Start ─────────────────────────────────────────────────────────────────────
connect();
