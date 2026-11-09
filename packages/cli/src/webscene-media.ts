// Video and sound inside a web scene. A scene names its media with <video> and <audio> elements;
// the export reads them with the ffmpeg the CLI already carries. A video is extracted to pictures
// at the scene's frame rate before the capture and served to the page, which shows the picture of
// the time asked (controller.video in the runtime); the sound is added to the film as ordinary
// audio layers, so the mixer treats it like any other sound. No ffprobe is needed: ffmpeg's own
// description of a file says what it holds.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { isAssetFile } from '@tramme/project';
import { FFMPEG } from './media.ts';

export interface SceneMedia {
  /** the order among the scene's <video> and <audio> elements */
  index: number;
  tag: 'video' | 'audio';
  /** the project path of the file */
  path: string;
  /** when it begins in the scene (data-start, s) */
  start: number;
  muted: boolean;
}

const TAG = /<(video|audio)\b[^>]*>/gi;
const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
};

/** the media of a scene page: local files of the scene folder or of assets/, in page order */
export function scanSceneMedia(html: string, folder: string): SceneMedia[] {
  const out: SceneMedia[] = [];
  let index = -1;
  for (const m of html.matchAll(TAG)) {
    index++;
    const src = attr(m[0], 'src');
    if (!src || /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) continue;
    let decoded: string;
    try { decoded = decodeURIComponent(src.split(/[?#]/)[0]); } catch { continue; }
    const parts = decoded.startsWith('/') ? decoded.slice(1).split('/') : `${folder}/${decoded}`.split('/');
    const resolved: string[] = [];
    for (const part of parts) { if (part === '' || part === '.') continue; if (part === '..') resolved.pop(); else resolved.push(part); }
    const file = resolved.join('/');
    if (!file.startsWith(`${folder}/`) && !isAssetFile(file)) continue;
    const start = Number(attr(m[0], 'data-start') ?? 0);
    out.push({ index, tag: m[1].toLowerCase() as 'video' | 'audio', path: file, start: Number.isFinite(start) && start >= 0 ? start : 0, muted: /\smuted(\s|=|>|\/)/i.test(m[0]) });
  }
  return out;
}

/** each <video> of the page marked with where its extracted pictures are served from */
export function annotateVideos(html: string, extracted: { index: number; count: number; fps: number }[]): string {
  let index = -1;
  return html.replace(TAG, (tag, name: string) => {
    index++;
    const done = extracted.find((e) => e.index === index);
    return done && name.toLowerCase() === 'video' ? tag.replace(/^<video/i, `<video data-frames="/__media/${index}/" data-fps="${done.fps}" data-frame-count="${done.count}"`) : tag;
  });
}

const run = (args: string[]): Promise<{ code: number; stderr: string }> => new Promise((resolve, reject) => {
  const child = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { if (stderr.length < 64 * 1024) stderr += chunk; });
  child.once('error', reject);
  child.once('close', (code) => resolve({ code: code ?? 1, stderr }));
});

export interface MediaInfo { video: boolean; audio: boolean; duration: number }

/** what a file holds, read from ffmpeg's own description of it */
export async function probeMedia(file: string): Promise<MediaInfo> {
  const { stderr } = await run(['-hide_banner', '-i', file]);
  const time = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  return {
    video: /Stream #[^\n]*Video:/.test(stderr),
    audio: /Stream #[^\n]*Audio:/.test(stderr),
    duration: time ? Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]) : 0,
  };
}

/** a video as numbered pictures (000000.jpg ...) at `fps`; the number of pictures */
export async function extractFrames(file: string, fps: number, out: string): Promise<number> {
  fs.mkdirSync(out, { recursive: true });
  const { code, stderr } = await run(['-v', 'error', '-y', '-i', file, '-an', '-vf', `fps=${fps}`, '-q:v', '2', '-start_number', '0', path.join(out, '%06d.jpg')]);
  if (code !== 0) throw new Error(`ffmpeg could not read ${path.basename(file)}: ${stderr.trim().split('\n').pop() ?? ''}`);
  return fs.readdirSync(out).filter((name) => /^\d{6}\.jpg$/.test(name)).length;
}
