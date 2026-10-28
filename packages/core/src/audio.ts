// The sounds of a composition, each where it plays: audio layers, and the
// sound of video layers not muted. A layer plays its file from `start`, from
// its in point to its out point: several layers of one file make the cuts of
// an edit. How each one sounds (gain and its curve, fades, speed, filters,
// reverb) is read here once; the preview, the exports and the command line
// mix the same clips with one mixer (@tramme/render, audio.ts).

import { propKind, sampleKeyframes, staticValue } from './props.ts';
import { integrate, mediaTime } from './track.ts';
import { trackOff } from './montage.ts';
import type { Composition, Keyframe, TrammeDoc } from './types.ts';

/** what a sound is in the mix: effects share the room, music and ambience are the bed, the voice leads */
export type SoundRole = 'effect' | 'music' | 'voice' | 'ambience';
export const SOUND_ROLES: SoundRole[] = ['effect', 'music', 'voice', 'ambience'];
/** what an effect underlines in the picture: a cut, a move at its fastest, a landing, an appearance */
export type SoundVisual = 'cut' | 'move' | 'land' | 'appear';
export const SOUND_VISUALS: SoundVisual[] = ['cut', 'move', 'land', 'appear'];

export interface AudioClip {
  layerId: string;
  role: SoundRole;
  /** a hero sound is one of the few moments the film is built around (a logo, a reveal); the others support */
  weight: 'hero' | 'support';
  /** what it underlines in the picture, when it says so */
  visual?: SoundVisual;
  /** asset id of the file */
  asset: string;
  /** composition time (s) where the clip starts */
  at: number;
  /** time in the file (s) played at `at` */
  offset: number;
  /** composition seconds played (the file goes by `duration × rate`) */
  duration: number;
  /** gain when it does not move (dB) */
  gainDb: number;
  /** gain over time when it is animated: [composition time, dB] from `at` to `at + duration` */
  envelope: [number, number][] | null;
  /** seconds of fade at each end */
  fadeIn: number;
  fadeOut: number;
  /** its share of a voice played with its cleaned copy (dB, already in gainDb and the envelope); none when it plays alone */
  share?: number;
  /** a transition's crossfade (composition times): in, the clip rises over the window; out, it falls and stays silent after */
  cross?: { in?: [number, number]; out?: [number, number] };
  /** an effect on the sound (none, pitch, robot, telephone, radio, megaphone, echo) and the semitones of the pitch voice */
  voice: string;
  semitones: number;
  /** the pitch kept against the speed (a pitch shift by its inverse) */
  keepPitch: boolean;
  /** playback speed, pitch with it: 1 as recorded (its value at `at` when it moves) */
  rate: number;
  /** the speed over time when it is animated (a speed curve): [composition time, speed] from the layer's in point to the clip's end, 0 and over (a sound does not play backwards) */
  rateCurve?: [number, number][] | null;
  /** looping: the section [loopStart, loopEnd] (file seconds) starts over while the clip runs */
  loopStart?: number;
  loopEnd?: number;
  /** filters (Hz): sound under lowCut and over highCut removed, 0 for none */
  lowCut: number;
  /** the low cut over time when it is animated (a build thinning the music out): [composition time, Hz] */
  lowCutCurve: [number, number][] | null;
  highCut: number;
  /** the equaliser, dB (0 as recorded): a shelf under 120 Hz, a bell around eqMidFreq, a shelf over 8 kHz */
  eqLow: number;
  eqMid: number;
  eqMidFreq: number;
  eqHigh: number;
  /** how hard the loud moments are brought down, 0 (as recorded) to 1 (tight) */
  compress: number;
  /** share of reverb, 0 (dry) to 1 */
  reverb: number;
}

/** what a sound's names say it is, when its layer does not say its role (a layer's length says nothing: an effect often runs to the end) */
const NAMED: [RegExp, SoundRole][] = [[/voice|narrat|speech|dialog|\bvo\b/i, 'voice'], [/ambien|room.?tone|atmos/i, 'ambience'], [/music|song|score|\bbed\b/i, 'music']];

/** samples a second of an animated gain: enough for fades and ducking, light for every mixer */
const ENVELOPE_RATE = 50;

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** the gain of a layer over [at, end]: null when it does not move */
function envelopeOf(prop: unknown, at: number, end: number, doc: TrammeDoc): [number, number][] | null {
  if (propKind(prop) !== 'keyframes') return null;
  const keys = (prop as { $k: Keyframe[] }).$k;
  if (!keys?.length) return null;
  // every key inside the clip, and samples in between for the eases
  const times = new Set<number>([at, end, ...keys.map((k) => k.t).filter((t) => t > at && t < end)]);
  for (let t = at; t < end; t += 1 / ENVELOPE_RATE) times.add(+t.toFixed(4));
  return [...times].sort((a, b) => a - b).map((t) => [t, num(sampleKeyframes('number', keys, t, doc.tokens ?? {}), 0)]);
}

export function audioClips(doc: TrammeDoc, compId: string): AudioClip[] {
  const comp = doc.compositions[compId];
  if (!comp) return [];
  const clips: AudioClip[] = [];
  const parent = new Map<string, string>();
  for (const [id, l] of Object.entries(comp.layers)) for (const k of l.children ?? []) parent.set(k, id);
  for (const [layerId, layer] of Object.entries(comp.layers)) {
    if (layer.visible === false || trackOff(comp, layer, 'hidden') || trackOff(comp, layer, 'muted') || (layer.type !== 'audio' && layer.type !== 'video')) continue;
    const props = layer.props ?? {};
    if (layer.type === 'video' && staticValue(props.muted) === true) continue;
    const asset = staticValue(layer.type === 'audio' ? props.audio : props.video);
    if (typeof asset !== 'string' || !doc.assets[asset]) continue;
    // it plays where its groups let it, as the timeline shows it; a hidden group silences it
    let at = layer.in ?? 0, end = Math.min(layer.out ?? comp.duration, comp.duration), hidden = false;
    for (let p = parent.get(layerId); p; p = parent.get(p)) {
      const g = comp.layers[p];
      hidden ||= g.visible === false;
      at = Math.max(at, g.in ?? 0); end = Math.min(end, g.out ?? comp.duration);
    }
    if (hidden || end <= at) continue;
    const rateCurve = envelopeOf(props.rate, layer.in ?? 0, end, doc)?.map(([t, v]) => [t, clamp(v, 0, 4)] as [number, number]) ?? null;
    const duration = end - at, rate = rateCurve ? curveAt(rateCurve, at) : clamp(num(staticValue(props.rate), 1), 0, 4);
    const envelope = envelopeOf(props.gain, at, end, doc), lowCutCurve = envelopeOf(props.lowCut, at, end, doc);
    const role = staticValue(props.role), visual = staticValue(props.visual);
    const start = Math.max(0, num(staticValue(props.start), 0));
    // looping: the section [start, loopEnd] wraps as long as the layer runs
    const loopEnd = num(staticValue(props.loopEnd), 0), loops = staticValue(props.loop) === true && loopEnd > start + 0.01;
    // where the clip starts in its file: the video node's clock, so picture and sound agree
    const offset = mediaTime({ start, rate, loop: loops, loopEnd, ...(rateCurve ? { rateElapsed: curveIntegral(rateCurve, layer.in ?? 0, at) } : {}) }, at, layer.in ?? 0);
    // a cleaned voice beside its source: both play in step, mixed by the layer's clean amount
    const cleanAmount = clamp(num(staticValue(props.clean), 0), 0, 1), cleaned = doc.assets[asset].clean;
    const withClean = cleanAmount > 0 && !!cleaned && doc.assets[cleaned]?.type === 'audio';
    const first = clips.length;
    clips.push({
      layerId, asset, at, duration,
      // unsaid: a video's sound is someone speaking; a sound is what its names say, an effect otherwise
      role: SOUND_ROLES.includes(role as SoundRole) ? role as SoundRole : layer.type === 'video' ? 'voice' : NAMED.find(([re]) => re.test(`${layerId} ${layer.name ?? ''} ${asset} ${doc.assets[asset].name ?? ''}`))?.[1] ?? 'effect',
      weight: staticValue(props.weight) === 'hero' ? 'hero' : 'support',
      ...(SOUND_VISUALS.includes(visual as SoundVisual) ? { visual: visual as SoundVisual } : {}),
      // a group starting after the layer skips the beginning of its file
      offset,
      ...(loops ? { loopStart: start, loopEnd } : {}),
      gainDb: envelope ? envelope[0][1] : num(staticValue(props.gain), 0),
      envelope,
      fadeIn: clamp(num(staticValue(props.fadeIn), 0), 0, duration),
      fadeOut: clamp(num(staticValue(props.fadeOut), 0), 0, duration),
      rate,
      ...(rateCurve ? { rateCurve } : {}),
      voice: typeof staticValue(props.voice) === 'string' ? String(staticValue(props.voice)) : 'none',
      semitones: clamp(num(staticValue(props.semitones), 0), -12, 12),
      keepPitch: staticValue(props.keepPitch) === true,
      lowCut: Math.max(0, lowCutCurve ? lowCutCurve[0][1] : num(staticValue(props.lowCut), 0)),
      lowCutCurve,
      highCut: Math.max(0, num(staticValue(props.highCut), 0)),
      eqLow: clamp(num(staticValue(props.eqLow), 0), -24, 12),
      eqMid: clamp(num(staticValue(props.eqMid), 0), -24, 12),
      eqMidFreq: clamp(num(staticValue(props.eqMidFreq), 1000), 200, 8000),
      eqHigh: clamp(num(staticValue(props.eqHigh), 0), -24, 12),
      compress: clamp(num(staticValue(props.compress), 0), 0, 1),
      reverb: clamp(num(staticValue(props.reverb), 0), 0, 1),
    });
    if (withClean) {
      // the voice is the sum of both: the original lowered, the cleaned one beside it (identical in their speech, so the voice keeps its level)
      const orig = clips[first], db = (k: number) => 20 * Math.log10(k);
      const shift = (c: AudioClip, k: number): AudioClip => ({ ...c, share: db(k), gainDb: c.gainDb + db(k), envelope: c.envelope?.map(([t, v]) => [t, v + db(k)] as [number, number]) ?? null });
      const clean = shift({ ...orig, asset: cleaned! }, cleanAmount);
      if (cleanAmount >= 1) clips[first] = clean;
      else { clips[first] = shift(orig, 1 - cleanAmount); clips.push(clean); }
    }
  }
  crossfades(comp, clips);
  return clips.sort((a, b) => a.at - b.at);
}

/**
 * The sounds of two shots joined by a transition cross with the picture, by
 * default: over the transition's window, the incoming clip rises and the
 * outgoing one falls (equal power), the outgoing silent after it.
 */
function crossfades(comp: Composition, clips: AudioClip[]) {
  // a layer may play two clips (its voice and the same cleaned): both cross
  const byLayer = new Map<string, AudioClip[]>();
  for (const c of clips) byLayer.set(c.layerId, [...(byLayer.get(c.layerId) ?? []), c]);
  for (const [id, layer] of Object.entries(comp.layers)) {
    for (const e of layer.effects ?? []) {
      if (e.type !== 'fx.transition' || e.enabled === false || staticValue(e.props?.sound) === false) continue;
      const from = staticValue(e.props?.from), duration = num(staticValue(e.props?.duration), 0.5);
      const start = layer.in ?? 0, window: [number, number] = [start, start + Math.max(0.01, duration)];
      for (const c of byLayer.get(id) ?? []) c.cross = { ...c.cross, in: window };
      for (const c of typeof from === 'string' ? byLayer.get(from) ?? [] : []) c.cross = { ...c.cross, out: window };
    }
  }
}

/** how a composition's sound is finished (its `sound` settings): the loudness of the master, null as mixed; the share of the room the effects have in common */
export interface SoundMix { loudness: number | null; room: number }
export const DEFAULT_LOUDNESS = -14;
export const DEFAULT_ROOM = 0.15;

export function soundMix(comp: Composition): SoundMix {
  const s = comp.sound;
  const loudness = s?.loudness === null ? null : num(staticValue(s?.loudness), DEFAULT_LOUDNESS);
  return { loudness: loudness === null ? null : clamp(loudness, -31, -6), room: clamp(num(staticValue(s?.room), DEFAULT_ROOM), 0, 1) };
}

/** a sampled curve's value at t, straight between its points, held past its ends */
export function curveAt(e: [number, number][], t: number): number {
  let i = 0;
  while (i < e.length - 2 && e[i + 1][0] <= t) i++;
  const [t0, v0] = e[i], [t1, v1] = e[Math.min(i + 1, e.length - 1)];
  return t <= t0 ? v0 : t >= t1 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
}

/** ∫ of a sampled curve (linear between its samples) from a to b: exact, the samples cut it */
export function curveIntegral(e: [number, number][], a: number, b: number): number {
  return integrate((t) => curveAt(e, t), a, b, e.map(([t]) => t));
}

/**
 * The file time a clip plays at composition time t (no loop wrap): its
 * offset, then the file at its speed, or at the integral of its speed curve.
 */
export function clipFileTime(c: AudioClip, t: number): number {
  return c.offset + (c.rateCurve ? curveIntegral(c.rateCurve, c.at, t) : (t - c.at) * c.rate);
}

/** the clip's gain (linear, 1 = as recorded) at composition time t: its curve or its level, times its fades */
export function gainAt(c: AudioClip, t: number): number {
  const dB = c.envelope ? curveAt(c.envelope, t) : c.gainDb;
  const end = c.at + c.duration;
  const fade = Math.min(1, c.fadeIn > 0 ? (t - c.at) / c.fadeIn : 1, c.fadeOut > 0 ? (end - t) / c.fadeOut : 1);
  return Math.pow(10, dB / 20) * Math.max(0, fade) * crossAt(c, t);
}

/** a crossfade's share of the clip at t: equal power, so the two clips keep the level between them */
function crossAt(c: AudioClip, t: number): number {
  const x = (w: [number, number]) => Math.min(1, Math.max(0, (t - w[0]) / (w[1] - w[0])));
  let k = 1;
  if (c.cross?.in) k *= Math.sin((Math.PI / 2) * x(c.cross.in));
  if (c.cross?.out) { const o = x(c.cross.out); k *= o >= 1 ? 0 : Math.cos((Math.PI / 2) * o); }
  return k;
}

/**
 * The pitch ratio a clip's voice stage applies at t: the semitones of the
 * pitch voice, and the inverse of its speed when it keeps its pitch; 1 when
 * it moves nothing (no worklet then).
 */
export function pitchRatio(c: AudioClip, t: number): number {
  let k = c.voice === 'pitch' ? Math.pow(2, c.semitones / 12) : 1;
  if (c.keepPitch) { const rate = c.rateCurve ? curveAt(c.rateCurve, t) : c.rate; if (rate > 0.05) k /= rate; }
  return Math.min(4, Math.max(0.25, k));
}

/** whether a clip needs the pitch worklet */
export const needsPitch = (c: AudioClip) => (c.voice === 'pitch' && c.semitones !== 0) || (c.keepPitch && (!!c.rateCurve || Math.abs(c.rate - 1) > 1e-6));

/** whether the clip's gain moves (a curve, fades, a crossfade): it is then sampled over time */
export const gainMoves = (c: AudioClip) => !!c.envelope || c.fadeIn > 0 || c.fadeOut > 0 || !!c.cross;

// ── what a sound is like ─────────────────────────────────────
export interface SoundFigures {
  /** seconds */
  duration: number;
  /** loudest sample, dBFS (0 = the top) */
  peakDb: number;
  /** average level over the sound, dBFS */
  rmsDb: number;
  /** loudest 400 ms, dBFS: how loud it sounds */
  loudDb: number;
  /** time of its loudest 10 ms: the moment it lands on (the hit, the pass of a whoosh, the top of a riser) */
  peakAt: number;
  /** where its sound starts and ends (40 dB under its loudest moment) */
  start: number;
  end: number;
}

const db = (x: number) => (x > 0 ? +(20 * Math.log10(x)).toFixed(1) : -120);

/** peak, levels, the moment it lands on, where it starts and ends: what the assistant reads of a sound it cannot hear */
export function soundFigures(channels: Float32Array[], sampleRate: number): SoundFigures {
  const n = channels[0]?.length ?? 0;
  const win = Math.max(1, Math.round(sampleRate / 100));
  const energy: number[] = [];
  let peak = 0, sum = 0;
  for (let i = 0; i < n; i += win) {
    let e = 0;
    const to = Math.min(n, i + win);
    for (let j = i; j < to; j++) {
      let s = 0;
      for (const c of channels) { const v = c[j]; s += v * v; const a = Math.abs(v); if (a > peak) peak = a; }
      e += s / channels.length;
    }
    sum += e;
    energy.push(e / (to - i));
  }
  const loudest = energy.reduce((best, e, i) => (e > energy[best] ? i : best), 0);
  const floor = (energy[loudest] ?? 0) * 1e-4;
  const first = energy.findIndex((e) => e > floor), last = energy.length - 1 - [...energy].reverse().findIndex((e) => e > floor);
  // 400 ms windows: 40 of 10 ms
  let loud = 0, run = 0;
  for (let i = 0; i < energy.length; i++) { run += energy[i]; if (i >= 40) run -= energy[i - 40]; loud = Math.max(loud, run / Math.min(40, i + 1)); }
  const sec = (i: number) => +(Math.min(n, i * win) / sampleRate).toFixed(3);
  return {
    duration: +(n / sampleRate).toFixed(3),
    peakDb: db(peak),
    rmsDb: db(Math.sqrt(sum / Math.max(1, n))),
    loudDb: db(Math.sqrt(loud)),
    // the middle of its loudest window (the last one may be shorter)
    peakAt: +((sec(loudest) + sec(loudest + 1)) / 2).toFixed(3),
    start: first < 0 ? 0 : sec(first),
    end: first < 0 ? 0 : sec(last + 1),
  };
}
