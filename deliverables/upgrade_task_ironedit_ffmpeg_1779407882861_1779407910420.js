Deliverable: `electron/main/ffmpeg.ts`
```ts
import { BrowserWindow, ipcMain } from 'electron';
import { access, constants, mkdir } from 'fs/promises';
import path from 'path';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { randomUUID } from 'crypto';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

type TranscodeRequest = {
  inputPath: string;
  outputFormat?: string;
  outputDir?: string;
  outputName?: string;
  startTime?: number;
  duration?: number;
  preset?: string;
  crf?: number;
  videoBitrate?: string;
  audioBitrate?: string;
  videoCodec?: string;
  audioCodec?: string;
  size?: string;
  expectedDuration?: number;
};

type ThumbnailRequest = {
  inputPath: string;
  outputDir?: string;
  outputName?: string;
  at?: number;
  width?: number;
  height?: number;
};

const ffmpegPath = ffmpegInstaller.path;
const progressRegex = /time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/;
const activeJobs = new Map<string, ChildProcessWithoutNullStreams>();

const fileReadable = async (filepath: string) => {
  await access(filepath, constants.R_OK);
};

const ensureDirectory = async (dir: string) => mkdir(dir, { recursive: true });

const timestampToSeconds = (match: RegExpMatchArray) => {
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  return hours * 3600 + minutes * 60 + seconds;
};

const spawnFFmpeg = (
  jobId: string,
  args: string[],
  target: BrowserWindow,
  expectedDuration?: number
) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    activeJobs.set(jobId, child);

    child.once('error', err => {
      activeJobs.delete(jobId);
      reject(err);
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      target.webContents.send('ffmpeg:log', { jobId, message: chunk });
      const matched = chunk.match(progressRegex);
      if (matched && expectedDuration) {
        const elapsed = timestampToSeconds(matched);
        const progress = Math.min(1, elapsed / expectedDuration);
        target.webContents.send('ffmpeg:progress', { jobId, progress });
      }
    });

    child.on('close', code => {
      activeJobs.delete(jobId);
      if (code === 0) {
        target.webContents.send('ffmpeg:log', { jobId, message: 'completed' });
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });
  });

const buildTranscodeArgs = (payload: TranscodeRequest, outputPath: string) => {
  const args = ['-y'];
  if (payload.startTime !== undefined) args.push('-ss', `${payload.startTime}`);
  args.push('-i', payload.inputPath);
  if (payload.duration !== undefined) args.push('-t', `${payload.duration}`);
  args.push('-c:v', payload.videoCodec ?? 'libx264');
  if (payload.preset) args.push('-preset', payload.preset);
  if (payload.crf !== undefined) args.push('-crf', `${payload.crf}`);
  if (payload.videoBitrate) args.push('-b:v', payload.videoBitrate);
  if (payload.size) args.push('-s', payload.size);
  args.push('-c:a', payload.audioCodec ?? 'aac');
  if (payload.audioBitrate) args.push('-b:a', payload.audioBitrate);
  args.push('-movflags', 'faststart', outputPath);
  return args;
};

const buildThumbnailArgs = (payload: ThumbnailRequest, outputPath: string) => {
  const vfSegments = [];
  if (payload.width || payload.height) {
    const width = payload.width ?? -1;
    const height = payload.height ?? -1;
    vfSegments.push(`scale=${width}:${height}`);
  }
  const vf = vfSegments.length ? ['-vf', vfSegments.join(',')] : [];
  const args = ['-y', '-ss', `${payload.at ?? 0}`, '-i', payload.inputPath, ...vf, '-vframes', '1', outputPath];
  return args;
};

export const registerFFmpegIntegration = () => {
  ipcMain.handle('ffmpeg:transcode', async (event, payload: TranscodeRequest) => {
    const target = BrowserWindow.fromWebContents(event.sender);
    if (!target) throw new Error('Renderer unavailable');
    if (!payload