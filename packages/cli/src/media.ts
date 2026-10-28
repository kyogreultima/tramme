// ffmpeg side: encoders for raw frames streamed from the render page, with
// the document's sound, already mixed by the page (the mixer of the editor).
//   mp4   H.264 High, BT.709, MP3 320 kb/s (frames in YUV 4:2:0)
//   mov   ProRes 4444 with alpha, PCM audio (frames in straight RGBA)
//   webm  VP9 with alpha, Opus audio
//   gif   two-pass palette, no audio
//   png   numbered PNG sequence with alpha, no audio

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { ffmetadata, type Chapter } from '@tramme/core';

export const FFMPEG = ffmpegPath as unknown as string;
export type VideoFormat = 'mp4' | 'mov' | 'webm' | 'gif' | 'png';
export const VIDEO_FORMATS: VideoFormat[] = ['mp4', 'mov', 'webm', 'gif', 'png'];

/** pixel layout the page must send for a format: at 10 bits, 16-bit RGBA read from the half-float frame */
export const frameKind = (f: VideoFormat, depth: 8 | 10 = 8): 'yuv' | 'rgba' | 'rgba64' => (depth === 10 ? 'rgba64' : f === 'mp4' ? 'yuv' : 'rgba');

/** the formats that take 10 bits: H.265 Main 10 (mp4), ProRes 4444 (mov), VP9 profile 2 (webm), 16-bit PNG */
export const DEEP_FORMATS: VideoFormat[] = ['mp4', 'mov', 'webm', 'png'];

const COLOR = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];

/** audio: the mixed sound of the rendered span, a WAV starting at its first frame */
export interface EncoderJob {
  format: VideoFormat; W: number; H: number; fps: number; frames: number; out: string; audio?: string; crf?: number;
  /** png: the number of the first image (a segment of a parallel export writes its own) */
  startNumber?: number;
  /** bits a channel: 10 writes H.265 Main 10, ProRes from 16-bit frames, VP9 profile 2, 16-bit PNG */
  depth?: 8 | 10;
}

/** the sound's codec in each container */
const AUDIO_CODEC: Partial<Record<VideoFormat, string[]>> = {
  // MP3 rather than AAC: VS Code's player cannot decode AAC
  mp4: ['-c:a', 'libmp3lame', '-b:a', '320k', '-ar', '48000'],
  mov: ['-c:a', 'pcm_s24le', '-ar', '48000'],
  webm: ['-c:a', 'libopus', '-b:a', '192k', '-ar', '48000'],
};

/** ffmpeg reading raw frames on stdin; out is the target file (a folder for png) */
export function encoder({ format, W, H, fps, frames, out, audio, crf = 16, startNumber = 0, depth = 8 }: EncoderJob) {
  if (depth === 10 && !DEEP_FORMATS.includes(format)) throw new Error(`${format} has no 10-bit form (${DEEP_FORMATS.join(', ')})`);
  const deep = depth === 10;
  fs.mkdirSync(format === 'png' ? out : path.dirname(out), { recursive: true });
  const dur = (frames / fps).toFixed(6);
  const pix = deep ? ['-pix_fmt', 'rgba64le'] : format === 'mp4' ? ['-pix_fmt', 'yuv420p', ...COLOR] : ['-pix_fmt', 'rgba'];
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', ...pix, '-s', `${W}x${H}`, '-r', String(fps), '-i', '-'];
  const withAudio = !!audio && (format === 'mp4' || format === 'mov' || format === 'webm');
  if (withAudio) args.push('-i', audio, '-map', '0:v', '-map', '1:a');
  else if (format !== 'gif') args.push('-map', '0:v');
  const toTv = ['-vf', 'scale=out_color_matrix=bt709:out_range=tv'];
  switch (format) {
    case 'mp4':
      // 10 bits: H.265 Main 10, tagged hvc1 (QuickTime, Safari)
      if (deep) { args.push(...toTv, '-c:v', 'libx265', '-preset', 'slow', '-crf', String(crf), '-profile:v', 'main10', '-pix_fmt', 'yuv420p10le', ...COLOR, '-tag:v', 'hvc1', '-x265-params', 'log-level=error', ...(withAudio ? AUDIO_CODEC.mp4! : []), '-t', dur, '-movflags', '+faststart', out); break; }
      args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-profile:v', 'high', '-pix_fmt', 'yuv420p', ...COLOR, '-g', String(fps * 2), '-bf', '2',
        ...(withAudio ? AUDIO_CODEC.mp4! : []), '-t', dur, '-movflags', '+faststart', out);
      break;
    case 'mov':
      args.push(...toTv, '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16', '-vendor', 'apl0', ...COLOR,
        ...(withAudio ? AUDIO_CODEC.mov! : []), '-t', dur, out);
      break;
    case 'webm':
      // 10 bits: VP9 profile 2, without its alpha (VP9 carries no 10-bit alpha)
      args.push(...toTv, '-c:v', 'libvpx-vp9', ...(deep ? ['-profile:v', '2', '-pix_fmt', 'yuv420p10le'] : ['-pix_fmt', 'yuva420p']), '-b:v', '0', '-crf', '22', '-deadline', 'good', '-cpu-used', '2', '-row-mt', '1', ...COLOR,
        ...(withAudio ? AUDIO_CODEC.webm! : []), '-t', dur, out);
      break;
    case 'gif':
      args.push('-filter_complex', '[0:v]split[a][b];[a]palettegen=reserve_transparent=1:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle', '-loop', '0', out);
      break;
    case 'png':
      args.push('-f', 'image2', '-start_number', String(startNumber), '-c:v', 'png', '-pix_fmt', deep ? 'rgba64be' : 'rgba', path.join(out, '%05d.png'));
      break;
  }
  const ff = spawn(FFMPEG, args, { stdio: ['pipe', 'inherit', 'inherit'] });
  ff.on('error', () => {});
  ff.stdin.on('error', (e) => console.error('ffmpeg stdin', e.message));
  const done = new Promise<void>((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg failed (code ' + c + ')')))));
  return {
    write: (buf: Buffer) => new Promise<void>((res) => { if (!ff.stdin.write(buf)) ff.stdin.once('drain', () => res()); else res(); }),
    end: async () => { ff.stdin.end(); await done; },
  };
}

/** a film's chapters written into its file, without encoding it again (mp4, mov and webm carry them); nothing to do without chapters or for other formats */
export async function addChapters(format: VideoFormat, file: string, chapters: Chapter[], seconds: number): Promise<void> {
  if (!chapters.length || !(format === 'mp4' || format === 'mov' || format === 'webm')) return;
  const meta = `${file}.chapters.txt`, tmp = `${file}.chapters.${format}`;
  fs.writeFileSync(meta, ffmetadata(chapters, seconds));
  try {
    await new Promise<void>((res, rej) => {
      const ff = spawn(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-i', file, '-i', meta, '-map', '0', '-map_metadata', '1', '-map_chapters', '1', '-c', 'copy', ...(format === 'mp4' ? ['-movflags', '+faststart'] : []), tmp], { stdio: ['ignore', 'inherit', 'inherit'] });
      ff.on('error', rej);
      ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg failed to write the chapters (code ${c})`))));
    });
    fs.renameSync(tmp, file);
  } finally { fs.rmSync(meta, { force: true }); fs.rmSync(tmp, { force: true }); }
}

/**
 * The segments of a parallel export joined into one file without encoding
 * them again (each segment starts on a keyframe of its own), the sound mixed
 * once over the whole film put beside them.
 */
export async function joinSegments(format: VideoFormat, segments: string[], out: string, seconds: number, audio?: string): Promise<void> {
  const list = `${out}.segments.txt`;
  fs.writeFileSync(list, segments.map((s) => `file '${path.resolve(s).replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list];
  const withAudio = !!audio && !!AUDIO_CODEC[format];
  if (withAudio) args.push('-i', audio!, '-map', '0:v', '-map', '1:a');
  else args.push('-map', '0:v');
  args.push('-c:v', 'copy', ...(withAudio ? AUDIO_CODEC[format]! : []), '-t', seconds.toFixed(6), ...(format === 'mp4' ? ['-movflags', '+faststart'] : []), out);
  try {
    await new Promise<void>((res, rej) => {
      const ff = spawn(FFMPEG, args, { stdio: ['ignore', 'inherit', 'inherit'] });
      ff.on('error', rej);
      ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg failed to join the segments (code ${c})`))));
    });
  } finally { fs.rmSync(list, { force: true }); }
}
