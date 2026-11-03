// Decode the delivered file, not the document that was meant to produce it.
// Uses the bundled FFmpeg: no separate ffprobe or Python installation needed.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { FFMPEG } from './media.ts';

export interface MediaExpected { width?: number; height?: number; fps?: number; frames?: number; duration?: number }
export interface MediaActual { width: number; height: number; fps: number; frames: number; duration: number }
export interface MediaVerification { ok: boolean; file: string; expected: MediaExpected; actual: MediaActual | null; issues: string[] }

/** Exact dimensions/count, rational cadence and up to one frame of mux timing tolerance. */
export async function verifyMedia(file: string, expected: MediaExpected = {}, timeoutMs = 120_000): Promise<MediaVerification> {
  for (const [key, value] of Object.entries(expected)) {
    if (!Number.isFinite(value) || value <= 0 || (['width', 'height', 'frames'].includes(key) && !Number.isInteger(value))) throw new Error(`check-media: ${key} must be a positive ${['width', 'height', 'frames'].includes(key) ? 'integer' : 'number'}`);
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('check-media: timeout must be positive milliseconds');
  const result: MediaVerification = { ok: false, file: path.resolve(file), expected, actual: null, issues: [] };
  if (!['.mp4', '.mov', '.webm'].includes(path.extname(file).toLowerCase())) {
    result.issues.push('Unsupported format: check-media decodes MP4, MOV and WebM video. GIF and PNG sequences need their own timing checks.');
    return result;
  }
  let width = 0, height = 0, fps = 0, frames = 0, duration = 0, tail = '', carry = '', infoCarry = '';
  let firstTime = Infinity, lastTime = -Infinity, lastDuration = 0;
  const error = await new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (failure: string | null) => { if (!settled) { settled = true; clearTimeout(timer); resolve(failure); } };
    const ff = spawn(FFMPEG, [
      '-hide_banner', '-nostdin', '-nostats', '-xerror', '-err_detect', 'explode', '-i', result.file,
      '-map', '0:v:0', '-an', '-vf', 'showinfo=checksum=0', '-fps_mode', 'passthrough',
      '-progress', 'pipe:1', '-f', 'null', '-',
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { ff.kill(); finish(`Video verification timed out after ${timeoutMs} ms.`); }, timeoutMs);
    ff.on('error', (e) => finish(`Cannot run FFmpeg: ${e.message}`));
    ff.stdout.on('data', (chunk: Buffer) => {
      carry += chunk.toString();
      const lines = carry.split(/\r?\n/); carry = lines.pop() ?? '';
      for (const line of lines) {
        const [key, value] = line.split('=');
        if (key === 'frame') frames = Number(value);
        if (key === 'out_time_us') duration = Number(value) / 1e6;
      }
    });
    ff.stderr.on('data', (chunk: Buffer) => {
      tail = (tail + chunk.toString()).slice(-16384);
      infoCarry += chunk.toString();
      const lines = infoCarry.split(/\r?\n/); infoCarry = lines.pop() ?? '';
      for (const line of lines) {
        const size = /\bs:(\d+)x(\d+)\b/.exec(line);
        if (size) { width = Number(size[1]); height = Number(size[2]); }
        const rate = /config in time_base:.*?frame_rate:\s*(\d+)\/(\d+)/.exec(line);
        if (rate) fps = Number(rate[1]) / Number(rate[2]);
        const time = /\bpts_time:([\d.e+-]+)/.exec(line);
        if (time) {
          const pts = Number(time[1]); firstTime = Math.min(firstTime, pts);
          if (pts >= lastTime) {
            lastTime = pts;
            lastDuration = Number(/\bduration_time:([\d.e+-]+)/.exec(line)?.[1] ?? 0);
          }
        }
      }
    });
    ff.on('close', (code) => finish(code === 0 ? null : `FFmpeg could not decode the complete video (exit ${code}): ${tail.split(/\r?\n/).filter(Boolean).slice(-3).join(' ').slice(-800)}`));
  });
  if (error) { result.issues.push(error); return result; }
  // Progress reports the last frame's timestamp, not its trailing duration.
  if (Number.isFinite(firstTime) && Number.isFinite(lastTime) && fps > 0) duration = lastTime - firstTime + (lastDuration > 0 ? lastDuration : 1 / fps);
  if (![width, height, fps, frames, duration].every((n) => Number.isFinite(n) && n > 0)) {
    result.issues.push('FFmpeg did not return complete video measurements.');
    return result;
  }
  result.actual = { width, height, fps, frames, duration };
  for (const [key, wanted] of Object.entries(expected) as [keyof MediaActual, number][]) {
    const actual = result.actual[key];
    const tolerance = key === 'duration' ? 1 / (expected.fps ?? fps) + 0.001 : key === 'fps' ? 0.001 : 0;
    if (Math.abs(actual - wanted) > tolerance) result.issues.push(`${key}: expected ${wanted}, decoded ${actual}.`);
  }
  result.ok = result.issues.length === 0;
  return result;
}

export function mediaReport(result: MediaVerification): string {
  const a = result.actual;
  return `${result.ok ? 'PASS' : 'FAIL'} ${result.file}${a ? `: ${a.width}×${a.height}, ${a.fps} fps, ${a.frames} frames, ${a.duration.toFixed(3)} s` : ''}${result.issues.length ? `\n${result.issues.join('\n')}` : ''}`;
}
