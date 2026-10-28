// The chapters of a film: the markers of kind `chapter`, as a list of times
// for a video site, and as the metadata ffmpeg writes into a file.

import type { Marker } from './types.ts';

export interface Chapter { t: number; title: string }

/** the chapters of a composition's markers inside [from, to), by time, their times counted from `from`, named by the marker's label or its id */
export function chaptersOf(markers: Marker[] | undefined, from = 0, to = Infinity): Chapter[] {
  return (markers ?? [])
    .filter((m) => m.kind === 'chapter' && m.t >= from && m.t < to)
    .sort((a, b) => a.t - b.t)
    .map((m) => ({ t: +(m.t - from).toFixed(6), title: m.label || m.id }));
}

/** the chapters as lines of time and title, the way a video site reads them (m:ss, h:mm:ss from an hour) */
export function chapterList(chapters: Chapter[]): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  const at = (t: number) => {
    const s = Math.floor(t), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? `${h}:${p2(m)}:${p2(s % 60)}` : `${m}:${p2(s % 60)}`;
  };
  return chapters.map((c) => `${at(c.t)} ${c.title}`).join('\n');
}

/** ffmpeg's metadata file with these chapters: each ends where the next begins, the last at `seconds` */
export function ffmetadata(chapters: Chapter[], seconds: number): string {
  const safe = (s: string) => s.replace(/[=;#\\\n]/g, (c) => (c === '\n' ? '\\\n' : `\\${c}`));
  const ms = (t: number) => Math.round(t * 1000);
  return `;FFMETADATA1\n${chapters.map((c, i) => `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${ms(c.t)}\nEND=${ms(chapters[i + 1]?.t ?? seconds)}\ntitle=${safe(c.title)}\n`).join('')}`;
}
