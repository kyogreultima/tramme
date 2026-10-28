// Publishing a film for where it is going: a preset names the size, the rate,
// the length at most, the format and the loudness a place wants; what stands
// between the film and the preset is listed, each with the change that fixes
// it. The file is the deliverable: nothing is posted from here.

import { pointer, type Composition, type Op } from '@tramme/core';
import { m } from './i18n/index.ts';

export interface PublishPreset {
  id: string;
  /** the name, a key of the catalog */
  label: string;
  width: number;
  /** none: the film's own proportions at this width */
  height?: number;
  fps: number;
  /** the longest film the place takes, s */
  maxSeconds?: number;
  format: 'mp4' | 'gif';
  /** the loudness to aim at (LUFS); none for a picture alone */
  loudness: number | null;
}

export const PUBLISH_PRESETS: PublishPreset[] = [
  { id: 'short', label: m('publish.short'), width: 1080, height: 1920, fps: 30, maxSeconds: 60, format: 'mp4', loudness: -14 },
  { id: 'square', label: m('publish.square'), width: 1080, height: 1080, fps: 30, maxSeconds: 60, format: 'mp4', loudness: -14 },
  { id: 'landscape', label: m('publish.landscape'), width: 1920, height: 1080, fps: 30, format: 'mp4', loudness: -14 },
  { id: 'master', label: m('publish.master'), width: 3840, height: 2160, fps: 30, format: 'mp4', loudness: -23 },
  { id: 'gif', label: m('publish.gif'), width: 640, fps: 15, maxSeconds: 15, format: 'gif', loudness: null },
];

export type PublishFix = 'trim' | 'size' | 'fps' | 'loudness' | 'vertical';

export interface PublishIssue {
  /** what is wrong: the length, the proportions, the size, the rate, the loudness */
  code: 'long' | 'aspect' | 'size' | 'fps' | 'loudness';
  /** the change that fixes it; `vertical` is the assistant's (a version recomposed for 9:16), the others are operations */
  fix?: PublishFix;
  params: Record<string, string | number | null>;
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
/** proportions the way they are said: 16:9, 9:16, 1:1, or 1.43:1 for the rest */
export function ratioLabel(w: number, h: number): string {
  const g = gcd(w, h), a = w / g, b = h / g;
  return a <= 32 && b <= 32 ? `${a}:${b}` : `${(w / h).toFixed(2)}:1`;
}

/** what stands between the film and the preset, in the order a person would fix it */
export function presetIssues(c: Composition, p: PublishPreset): PublishIssue[] {
  const out: PublishIssue[] = [];
  if (p.maxSeconds !== undefined && c.duration > p.maxSeconds + 1e-6) out.push({ code: 'long', fix: 'trim', params: { seconds: +c.duration.toFixed(2), max: p.maxSeconds } });
  const ratio = c.width / c.height, wanted = p.height ? p.width / p.height : ratio;
  if (Math.abs(ratio - wanted) / wanted > 0.02) {
    out.push({ code: 'aspect', fix: p.height! > p.width && c.width > c.height ? 'vertical' : 'size', params: { from: ratioLabel(c.width, c.height), to: ratioLabel(p.width, p.height!) } });
  } else if (c.width !== p.width) {
    out.push({ code: 'size', fix: 'size', params: { from: `${c.width}×${c.height}`, to: `${p.width}×${p.height ?? Math.round((p.width * c.height) / c.width)}` } });
  }
  if (c.fps !== p.fps) out.push({ code: 'fps', fix: 'fps', params: { from: c.fps, to: p.fps } });
  const aim = c.sound?.loudness === undefined || c.sound.loudness === null ? null : Number(c.sound.loudness);
  if (p.loudness !== null && aim !== p.loudness) out.push({ code: 'loudness', fix: 'loudness', params: { from: aim, to: p.loudness } });
  return out;
}

/** the operations of a fix (none for `vertical`, which is the assistant's) */
export function fixOps(c: Composition, compId: string, p: PublishPreset, fix: PublishFix): Op[] {
  const at = (key: string) => pointer('compositions', compId, key);
  switch (fix) {
    case 'trim': return p.maxSeconds === undefined ? [] : [{ op: 'replace', path: at('duration'), value: p.maxSeconds }];
    case 'size': {
      const h = p.height ?? Math.round((p.width * c.height) / c.width);
      return [{ op: 'replace', path: at('width'), value: p.width }, { op: 'replace', path: at('height'), value: h }];
    }
    case 'fps': return [{ op: 'replace', path: at('fps'), value: p.fps }];
    case 'loudness': return p.loudness === null ? [] : [{ op: 'add', path: at('sound'), value: { ...(c.sound ?? {}), loudness: p.loudness } }];
    default: return [];
  }
}
