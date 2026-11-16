// Export for Premiere Pro: a composition as an editor's timeline, in the Final
// Cut 7 XML (xmeml) that Premiere opens as a sequence. The footage keeps its
// cuts (its file, where it starts in it, how long it plays); what is drawn
// under it and over it comes as one picture with alpha per scene (ProRes 4444,
// rendered by the command line); the sounds keep their files, their offsets
// and their levels, the voices, music and effects each on their own tracks;
// the captions come as subtitles (SRT). After Effects imports the same clips.
// This module is pure: it says what goes where; packages/cli renders and copies.

import { audioClips, captionGroups, isTranscript, staticValue, type Composition, type Layer, type TrammeDoc } from '@tramme/core';

/** a clip on the timeline: its file (an absolute path), where it starts in the sequence, where it starts in its file, how long it plays (s) */
export interface TimelineClip {
  name: string;
  file: string;
  at: number;
  offset: number;
  duration: number;
  /** a sound's level (dB); none: as recorded */
  gainDb?: number;
  /** a file of pictures with sound: its picture is on a video track, its sound on an audio one */
  kind: 'video' | 'audio';
}

export interface Timeline {
  name: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  /** the video tracks, bottom to top */
  video: TimelineClip[][];
  /** the audio tracks, first to last */
  audio: TimelineClip[][];
}

const isFootage = (l: Layer, doc: TrammeDoc) => {
  const asset = staticValue(l.props?.video);
  return l.type === 'video' && l.visible !== false && typeof asset === 'string' && doc.assets[asset]?.type === 'video';
};

/**
 * The root layers of a composition split by the footage: the videos of the
 * shoot (kept as they are, editable), what is drawn under the first of them
 * and what is drawn over it. A layer drawn between two videos goes over them.
 */
export function footageSplit(doc: TrammeDoc, compId: string): { footage: string[]; below: string[]; above: string[] } {
  const comp = doc.compositions[compId];
  const order = comp.order.filter((id) => comp.layers[id]);
  const footage = order.filter((id) => isFootage(comp.layers[id], doc));
  const first = footage.length ? order.indexOf(footage[0]) : order.length;
  const drawn = (id: string) => !footage.includes(id) && comp.layers[id].type !== 'audio';
  return { footage, below: order.slice(0, first).filter(drawn), above: order.slice(first).filter(drawn) };
}

/** the footage as clips: each video layer's file, from where it starts in it, for as long as the layer runs */
export function footageClips(doc: TrammeDoc, compId: string, fileOf: (asset: string) => string): { clips: TimelineClip[]; warnings: string[] } {
  const comp = doc.compositions[compId], warnings: string[] = [];
  const clips = footageSplit(doc, compId).footage.map((id): TimelineClip => {
    const l = comp.layers[id], asset = String(staticValue(l.props?.video));
    const at = Math.max(0, l.in ?? 0), end = Math.min(l.out ?? comp.duration, comp.duration);
    const rate = Number(staticValue(l.props?.rate) ?? 1);
    if (rate !== 1 || staticValue(l.props?.loop) === true) warnings.push(`"${l.name ?? id}": its speed or loop is not carried to the timeline (the clip plays at normal speed)`);
    return { name: l.name ?? id, file: fileOf(asset), at, offset: Math.max(0, Number(staticValue(l.props?.start) ?? 0)), duration: Math.max(0, end - at), kind: 'video' };
  }).filter((c) => c.duration > 0);
  return { clips, warnings };
}

/** the track a sound goes on: the voices first, then the music, then the rest */
const SOUND_TRACK: Record<string, number> = { voice: 0, music: 1 };

/** the sounds of the composition as clips on three audio tracks (voices, music, effects), with their offsets and levels */
export function soundClips(doc: TrammeDoc, compId: string, fileOf: (asset: string) => string): { tracks: TimelineClip[][]; warnings: string[] } {
  const tracks: TimelineClip[][] = [[], [], []], warnings: string[] = [];
  for (const c of audioClips(doc, compId)) {
    if (c.envelope || c.rate !== 1 || c.voice !== 'none') warnings.push(`the sound of "${c.layerId}": its moving level, speed or voice effect is not carried (its level at the start is)`);
    tracks[SOUND_TRACK[c.role] ?? 2].push({ name: doc.compositions[compId].layers[c.layerId]?.name ?? c.layerId, file: fileOf(c.asset), at: c.at, offset: c.offset, duration: c.duration, gainDb: c.gainDb, kind: 'audio' });
  }
  return { tracks: tracks.filter((t) => t.length), warnings };
}

/** a subtitle: from, to (s) and its words */
export interface Cue { from: number; to: number; text: string }

/** the captions of the composition as subtitles: each caption layer's groups of words, in the film's time, within the layer */
export function captionCues(doc: TrammeDoc, compId: string, readJson: (asset: string) => unknown): Cue[] {
  const comp: Composition = doc.compositions[compId], cues: Cue[] = [];
  for (const id of comp.order) {
    const l = comp.layers[id];
    if (!l || l.type !== 'captions' || l.visible === false) continue;
    const asset = staticValue(l.props?.transcript);
    const t = typeof asset === 'string' ? readJson(asset) : null;
    if (!isTranscript(t)) continue;
    const at = l.in ?? 0, end = Math.min(l.out ?? comp.duration, comp.duration);
    // the transcript's time at the layer's in point: its own start, or the start of the layer it follows
    const follow = staticValue(l.props?.follow), followed = typeof follow === 'string' ? comp.layers[follow] : undefined;
    const origin = followed ? Number(staticValue(followed.props?.start) ?? 0) - (followed.in ?? 0) : Number(staticValue(l.props?.start) ?? 0) - at;
    const groups = captionGroups(t.words, { maxWords: Number(staticValue(l.props?.maxWords) ?? 4), maxChars: Number(staticValue(l.props?.maxChars) ?? 28) });
    for (const g of groups) {
      const from = Math.max(at, g.s - origin), to = Math.min(end, g.e - origin);
      if (to > from) cues.push({ from, to, text: g.words.map((w) => w.w).join(' ') });
    }
  }
  return cues.sort((a, b) => a.from - b.from);
}

const srtTime = (s: number) => {
  const ms = Math.round(s * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};

/** subtitles as an SRT file */
export const toSrt = (cues: Cue[]): string => cues.map((c, i) => `${i + 1}\n${srtTime(c.from)} --> ${srtTime(c.to)}\n${c.text}\n`).join('\n');

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** a file's address as Premiere reads it: file://localhost/ and the path with forward slashes, each part escaped */
export const pathUrl = (file: string) => {
  const p = file.replace(/\\/g, '/');
  return `file://localhost${p.startsWith('/') ? '' : '/'}${p.split('/').map((x, i) => (i === 0 && /^[A-Za-z]:$/.test(x) ? x : encodeURIComponent(x))).join('/')}`;
};

/**
 * The timeline as Final Cut 7 XML (xmeml 4), which Premiere Pro opens with
 * File > Import as a sequence: one track per list, each clip on its file, the
 * sounds' levels as Audio Levels. Times are frames at the sequence's rate.
 */
export function toXmeml(tl: Timeline): string {
  const timebase = Math.round(tl.fps), ntsc = Math.abs(tl.fps - timebase) > 0.001 ? 'TRUE' : 'FALSE';
  const rate = `<rate><timebase>${timebase}</timebase><ntsc>${ntsc}</ntsc></rate>`;
  const f = (s: number) => Math.round(s * tl.fps);
  // each file once: its id, and how long the timeline uses of it (its duration as far as the XML knows)
  const files = new Map<string, { id: string; frames: number; video: boolean; audio: boolean }>();
  for (const c of [...tl.video.flat(), ...tl.audio.flat()]) {
    const had = files.get(c.file) ?? { id: `file-${files.size + 1}`, frames: 0, video: false, audio: false };
    had.frames = Math.max(had.frames, f(c.offset + c.duration));
    had[c.kind] = true;
    files.set(c.file, had);
  }
  const written = new Set<string>();
  let n = 0;
  const file = (path: string) => {
    const x = files.get(path)!;
    if (written.has(path)) return `<file id="${x.id}"/>`;
    written.add(path);
    const name = path.split(/[\\/]/).pop()!;
    const media = `${x.video ? `<video><samplecharacteristics>${rate}<width>${tl.width}</width><height>${tl.height}</height></samplecharacteristics></video>` : ''}${x.audio ? '<audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics><channelcount>2</channelcount></audio>' : ''}`;
    return `<file id="${x.id}"><name>${esc(name)}</name><pathurl>${esc(pathUrl(path))}</pathurl>${rate}<duration>${x.frames}</duration><media>${media}</media></file>`;
  };
  const clip = (c: TimelineClip, audio: boolean) => {
    const start = f(c.at), end = start + Math.max(1, f(c.duration)), inn = f(c.offset);
    const level = audio && c.gainDb !== undefined && c.gainDb !== 0
      ? `<filter><effect><name>Audio Levels</name><effectid>audiolevels</effectid><effectcategory>audiolevels</effectcategory><effecttype>audiolevels</effecttype><mediatype>audio</mediatype><parameter><parameterid>level</parameterid><name>Level</name><valuemin>0</valuemin><valuemax>3.98109</valuemax><value>${Math.min(3.98109, 10 ** (c.gainDb / 20)).toFixed(5)}</value></parameter></effect></filter>`
      : '';
    return `<clipitem id="clipitem-${++n}"><name>${esc(c.name)}</name><enabled>TRUE</enabled><duration>${files.get(c.file)!.frames}</duration>${rate}<start>${start}</start><end>${end}</end><in>${inn}</in><out>${inn + (end - start)}</out>${file(c.file)}${audio ? '<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>' : ''}${level}</clipitem>`;
  };
  const track = (list: TimelineClip[], audio: boolean) => `<track>${[...list].sort((a, b) => a.at - b.at).map((c) => clip(c, audio)).join('')}</track>`;
  const format = `<format><samplecharacteristics>${rate}<width>${tl.width}</width><height>${tl.height}</height><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></format>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
<sequence id="sequence-1"><name>${esc(tl.name)}</name><duration>${f(tl.duration)}</duration>${rate}<timecode>${rate}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>
<media>
<video>${format}${tl.video.map((t) => track(t, false)).join('')}</video>
<audio><format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></format>${tl.audio.map((t) => track(t, true)).join('')}</audio>
</media>
</sequence>
</xmeml>
`;
}
