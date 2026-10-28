// Editing a film made of clips on tracks, as pure functions of the document:
// each takes the document and an intent and returns the operations that carry
// it out. The timeline's gestures, the keyboard and the assistant's tools all
// call these, so a ripple is the same ripple wherever it comes from.

import { applyOps, pointer, type Op } from './ops.ts';
import { staticValue } from './props.ts';
import { carriedStart, round6, shiftLayerOps, shiftLayerValues, splitLayerOps, subtree, trimInOps } from './timing.ts';
import type { Composition, Layer, TrammeDoc } from './types.ts';

/** where a clip sits on its track: its id, its in point and its out point (the composition's end when it has none) */
export interface Footprint { id: string; in: number; out: number }

/** the clips of a track, by in point */
export function trackClips(c: Composition, trackId: string): Footprint[] {
  const out: Footprint[] = [];
  for (const [id, l] of Object.entries(c.layers)) if (l.track === trackId) out.push({ id, in: l.in ?? 0, out: l.out ?? c.duration });
  return out.sort((a, b) => a.in - b.in || a.id.localeCompare(b.id));
}

/**
 * The cuts of a track: two neighbouring clips that touch or overlap. Where a
 * transition makes them overlap, the cut is the centre of the overlap; a gap
 * between them is not a cut.
 */
export function cutsOf(c: Composition, trackId: string): { left: string; right: string; at: number }[] {
  const clips = trackClips(c, trackId), half = 0.5 / c.fps, out: { left: string; right: string; at: number }[] = [];
  for (let i = 1; i < clips.length; i++) {
    const a = clips[i - 1], b = clips[i];
    if (b.in <= a.out + half) out.push({ left: a.id, right: b.id, at: b.in < a.out ? (b.in + a.out) / 2 : b.in });
  }
  return out;
}

/** a layer sitting on a track that is switched off for `flag`: hidden (not drawn, not heard) or muted (not heard) */
export function trackOff(c: Composition, l: Layer, flag: 'hidden' | 'muted'): boolean {
  return !!l.track && !!c.tracks?.find((t) => t.id === l.track)?.[flag];
}

/** the clips that share a link with `id`, itself included (just itself when it is not linked) */
export function linkedIds(c: Composition, id: string): string[] {
  const link = c.layers[id]?.link;
  return link ? Object.keys(c.layers).filter((k) => c.layers[k].link === link) : [id];
}

/** a clip that cannot be edited: its track is locked, or so is the track of a clip linked to it */
export function isLocked(c: Composition, id: string): boolean {
  return linkedIds(c, id).some((k) => {
    const t = c.layers[k]?.track;
    return !!t && !!c.tracks?.find((x) => x.id === t)?.locked;
  });
}

/**
 * Removes layers (and their descendants) in one go: each list that held them
 * is written once, so indexes never go stale; clips that were clipped by them
 * lose the clip, and a transition coming from one of them is taken off the
 * clip that carried it.
 */
export function removeLayersOps(doc: TrammeDoc, compId: string, ids: Iterable<string>): Op[] {
  const c = doc.compositions[compId], gone = new Set<string>();
  for (const id of ids) if (c.layers[id]) for (const x of subtree(c, id)) gone.add(x);
  if (!gone.size) return [];
  const ops: Op[] = [];
  const lists: [string[], string[]][] = [[['order'], c.order]];
  for (const [id, l] of Object.entries(c.layers)) if (l.children && !gone.has(id)) lists.push([['layers', id, 'children'], l.children]);
  for (const [path, list] of lists) {
    if (list.some((x) => gone.has(x))) ops.push({ op: 'replace', path: pointer('compositions', compId, ...path), value: list.filter((x) => !gone.has(x)) });
  }
  for (const [id, l] of Object.entries(c.layers)) {
    if (gone.has(id)) continue;
    const lp = pointer('compositions', compId, 'layers', id);
    if (l.clip && gone.has(l.clip)) ops.push({ op: 'remove', path: `${lp}/clip` });
    const fx = l.effects ?? [];
    for (let i = fx.length - 1; i >= 0; i--) {
      const from = fx[i].type === 'fx.transition' ? staticValue(fx[i].props?.from) : undefined;
      if (typeof from === 'string' && gone.has(from)) ops.push({ op: 'remove', path: `${lp}/effects/${i}` });
    }
  }
  for (const id of gone) ops.push({ op: 'remove', path: pointer('compositions', compId, 'layers', id) });
  return ops;
}

/** a change of time cut to the ten-thousandth toward zero, the precision the trims write: the two edges of a cut then stay equal, and a clamp stays inside its limit */
const cutTo4 = (x: number) => Math.trunc(x * 1e4) / 1e4;

const trackLocked = (c: Composition, trackId: string) => !!c.tracks?.find((t) => t.id === trackId)?.locked;

/** the operations moving each of these clips by its own shift, or none when one of them cannot move (locked) */
function shiftAll(doc: TrammeDoc, compId: string, shifts: Map<string, number>): Op[] | null {
  const c = doc.compositions[compId], ops: Op[] = [];
  for (const [id, dt] of shifts) {
    if (isLocked(c, id)) return null;
    ops.push(...shiftLayerOps(doc, compId, id, dt));
  }
  return ops;
}

/**
 * Clips removed and the track closed behind them: on each track that held a
 * removed clip, what follows moves left by the span removed (less the part a
 * transition had already overlapped; a gap that followed stays). A clip
 * removed with the clips linked to it. Nothing happens when any of them, or
 * any clip that would move, is locked.
 */
export function rippleDeleteOps(doc: TrammeDoc, compId: string, ids: string[]): Op[] {
  const c = doc.compositions[compId], half = 0.5 / c.fps;
  const gone = new Set(ids.filter((id) => c.layers[id]).flatMap((id) => linkedIds(c, id)));
  if (!gone.size || [...gone].some((id) => isLocked(c, id))) return [];
  const byTrack = new Map<string, [number, number][]>();
  for (const id of gone) {
    const l = c.layers[id];
    if (l.track) byTrack.set(l.track, [...(byTrack.get(l.track) ?? []), [l.in ?? 0, l.out ?? c.duration]]);
  }
  const shifts = new Map<string, number>();
  for (const [track, spans] of byTrack) {
    const merged: [number, number][] = [];
    for (const [a, b] of spans.sort((x, y) => x[0] - y[0])) {
      const last = merged[merged.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], b); else merged.push([a, b]);
    }
    const kept = trackClips(c, track).filter((f) => !gone.has(f.id));
    for (const [s, e] of merged) {
      const next = kept.find((k) => k.in >= s - half);
      if (!next) continue;
      const d = round6(next.in >= e ? e - s : next.in - s);
      if (d <= 0) continue;
      for (const k of kept) if (k.in >= next.in - 1e-9) shifts.set(k.id, (shifts.get(k.id) ?? 0) - d);
    }
  }
  const moved = shiftAll(doc, compId, shifts);
  return moved ? [...removeLayersOps(doc, compId, gone), ...moved] : [];
}

/** the gap of a track around `at` closed: the clips after it move left by its length. Nothing where `at` is not in a gap, or when the track is locked */
export function closeGapOps(doc: TrammeDoc, compId: string, trackId: string, at: number): Op[] {
  const c = doc.compositions[compId], half = 0.5 / c.fps;
  if (trackLocked(c, trackId)) return [];
  const clips = trackClips(c, trackId);
  let prevOut = 0;
  for (let i = 0; i < clips.length; i++) {
    const gap = clips[i].in - prevOut;
    if (gap > half && at >= prevOut && at < clips[i].in) {
      const shifts = new Map(clips.slice(i).map((k) => [k.id, -round6(gap)] as [string, number]));
      return shiftAll(doc, compId, shifts) ?? [];
    }
    prevOut = Math.max(prevOut, clips[i].out);
  }
  return [];
}

/** steps run one after the other, each on the document the earlier ones left: the operations of all, in order */
function chain(doc: TrammeDoc, steps: ((d: TrammeDoc) => Op[])[]): Op[] {
  const all: Op[] = [];
  let d = doc;
  for (const step of steps) {
    const ops = step(d);
    if (!ops.length) continue;
    all.push(...ops);
    d = applyOps(d, ops).doc;
  }
  return all;
}

/**
 * The draw order of a sequence: the clips of the tracks in track order (a
 * higher track above a lower one, a later clip above an earlier one on its
 * track), the sounds under them, in the place the first clip held in the
 * stack; layers without a track keep their order and their side. Nothing
 * when the order is already right or the composition has no tracks.
 */
export function syncOrderOps(doc: TrammeDoc, compId: string): Op[] {
  const c = doc.compositions[compId];
  if (!c.tracks) return [];
  const index = (id: string) => c.tracks!.findIndex((t) => t.id === c.layers[id].track);
  const isClip = (id: string) => !!c.layers[id]?.track && index(id) >= 0;
  const clips = c.order.filter(isClip);
  if (!clips.length) return [];
  const audio = (id: string) => c.tracks![index(id)].kind === 'audio';
  const sorted = [...clips].sort((x, y) => Number(audio(y)) - Number(audio(x)) || index(x) - index(y) || (c.layers[x].in ?? 0) - (c.layers[y].in ?? 0) || x.localeCompare(y));
  const first = c.order.findIndex(isClip);
  const rest = c.order.filter((id) => !isClip(id));
  const before = c.order.slice(0, first).filter((id) => !isClip(id));
  const next = [...before, ...sorted, ...rest.slice(before.length)];
  return next.every((id, i) => id === c.order[i]) ? [] : [{ op: 'replace', path: pointer('compositions', compId, 'order'), value: next }];
}

/** the composition lengthened to the end of its last clip when that goes past its duration */
function fitDurationOps(doc: TrammeDoc, compId: string): Op[] {
  const c = doc.compositions[compId];
  const end = Math.max(0, ...c.order.map((id) => c.layers[id]?.out ?? 0));
  return end > c.duration + 1e-9 ? [{ op: 'replace', path: pointer('compositions', compId, 'duration'), value: +end.toFixed(4) }] : [];
}

/** the clip as it goes on the track: `layer` placed at `at`, as long as it is, its keyframes moved with it */
function placed(c: Composition, layer: Layer, trackId: string, at: number): { clip: Layer; len: number } {
  const len = round6((layer.out ?? c.duration) - (layer.in ?? 0));
  return { clip: { ...shiftLayerValues(layer, at - (layer.in ?? 0)), track: trackId, in: round6(at), out: round6(at + len) }, len };
}

const addClipOps = (compId: string, id: string, clip: Layer): Op[] => [
  { op: 'add', path: pointer('compositions', compId, 'layers', id), value: clip },
  { op: 'add', path: pointer('compositions', compId, 'order', '-'), value: id },
];

/**
 * A clip put on a track at `at`, pushing the rest aside: a clip it falls in
 * is cut in two there, and everything from `at` on the track moves later by
 * the new clip's length. Nothing when the track, or a clip that would move, is
 * locked.
 */
export function insertOps(doc: TrammeDoc, compId: string, id: string, layer: Layer, trackId: string, at: number): Op[] {
  const { clip, len } = placed(doc.compositions[compId], layer, trackId, at);
  if (!(len > 0)) return [];
  const room = makeRoomOps(doc, compId, trackId, at, len);
  if (!room) return [];
  return chain(doc, [() => room, () => addClipOps(compId, id, clip), (d) => syncOrderOps(d, compId), (d) => fitDurationOps(d, compId)]);
}

/** a gap of `len` opened on a track at `at`: a clip it falls in is cut there and everything from `at` moves later. Null when the track, or a clip that would move, is locked */
function makeRoomOps(doc: TrammeDoc, compId: string, trackId: string, at: number, len: number): Op[] | null {
  const c = doc.compositions[compId], half = 0.5 / c.fps, clips = trackClips(c, trackId);
  if (trackLocked(c, trackId) || clips.some((k) => k.out > at && isLocked(c, k.id))) return null;
  return chain(doc, [
    (d) => chain(d, clips.filter((k) => k.in < at - half && k.out > at + half).map((k) => (x: TrammeDoc) => splitLayerOps(x, compId, k.id, at)?.ops ?? [])),
    (d) => chain(d, trackClips(d.compositions[compId], trackId).filter((k) => k.in >= at - half).map((k) => (x: TrammeDoc) => shiftLayerOps(x, compId, k.id, len))),
  ]);
}

/**
 * A clip put on a track at `at`, over what is there: the clips it covers are
 * removed, one it covers in part is trimmed on that side (the head of a video
 * carries the start of its file), one that holds it is cut in three. Nothing
 * when the track, or a clip it touches, is locked.
 */
export function overwriteOps(doc: TrammeDoc, compId: string, id: string, layer: Layer, trackId: string, at: number): Op[] {
  const c = doc.compositions[compId], half = 0.5 / c.fps;
  const { clip, len } = placed(c, layer, trackId, at);
  const end = clip.out!;
  if (!(len > 0) || trackLocked(c, trackId)) return [];
  const touched = trackClips(c, trackId).filter((k) => k.in < end - half && k.out > at + half);
  if (touched.some((k) => isLocked(c, k.id))) return [];
  const covered = touched.filter((k) => k.in >= at - half && k.out <= end + half).map((k) => k.id);
  const steps: ((d: TrammeDoc) => Op[])[] = [(d) => removeLayersOps(d, compId, covered)];
  for (const k of touched) {
    if (covered.includes(k.id)) continue;
    if (k.in < at - half && k.out > end + half) {
      steps.push((d) => {
        const cut = splitLayerOps(d, compId, k.id, at);
        return cut ? [...cut.ops, ...trimInOps(applyOps(d, cut.ops).doc, compId, cut.id, end)] : [];
      });
    } else if (k.in < at - half) {
      steps.push(() => [{ op: 'add', path: pointer('compositions', compId, 'layers', k.id, 'out'), value: round6(at) }]);
    } else {
      steps.push((d) => trimInOps(d, compId, k.id, end));
    }
  }
  steps.push(() => addClipOps(compId, id, clip), (d) => syncOrderOps(d, compId), (d) => fitDurationOps(d, compId));
  return chain(doc, steps);
}

/** the rate a clip plays its file at, and where in its file it starts (null when that is not a plain number) */
function sourceOf(l: Layer): { rate: number; start: number | null; asset: string | null } {
  const rate = Number(staticValue(l.props?.rate));
  const raw = staticValue(l.props?.start);
  const asset = staticValue(l.props?.[l.type === 'audio' ? 'audio' : 'video']);
  return { rate: rate > 0 ? rate : 1, start: l.props?.start === undefined ? 0 : typeof raw === 'number' ? raw : null, asset: typeof asset === 'string' ? asset : null };
}

/** a clip's head and tail may only move as far as its file goes: [the most its in point can move earlier (≤ 0), the most its out point can move later] */
function handles(l: Layer, length: number, fileLength?: (asset: string) => number | undefined): [number, number] {
  if (l.type !== 'video' && l.type !== 'audio') return [-Infinity, Infinity];
  const { rate, start, asset } = sourceOf(l);
  if (start === null) return [-Infinity, Infinity];
  const total = asset ? fileLength?.(asset) : undefined;
  return [-start / rate, total === undefined ? Infinity : Math.max(0, (total - start) / rate - length)];
}

/**
 * An edge of a clip moved to `to`, the track following it. The out edge: what
 * follows moves by the change. The in edge: the clip stays where it starts, its
 * file carried (the head cut off or brought back, as far as the file goes) and
 * it gets shorter or longer, what follows moving by that. Clips linked to it
 * follow by the same amount. `fileLength` gives a file's length when known.
 */
export function rippleTrimOps(doc: TrammeDoc, compId: string, id: string, edge: 'in' | 'out', to: number, fileLength?: (asset: string) => number | undefined): Op[] {
  const c = doc.compositions[compId], l = c.layers[id], fr = 1 / c.fps;
  if (!l || !l.track || isLocked(c, id)) return [];
  const tin = l.in ?? 0, tout = l.out ?? c.duration, length = tout - tin;
  const [headMax, tailMax] = handles(l, length, fileLength);
  // the change of length wanted, limited by the file and by one frame left
  const grow = cutTo4(edge === 'out' ? Math.min(tailMax, Math.max(fr - length, to - tout)) : Math.min(-headMax, Math.max(fr - length, tin - to)));
  const dt = edge === 'out' ? grow : -grow;
  if (Math.abs(grow) < 1e-9) return [];
  const shifts = new Map<string, number>(), ops: Op[] = [];
  for (const m of linkedIds(c, id)) {
    const ml = c.layers[m];
    if (!ml.track || isLocked(c, m)) return [];
    const mp = pointer('compositions', compId, 'layers', m), mout = ml.out ?? c.duration;
    if (edge === 'out') ops.push({ op: 'add', path: `${mp}/out`, value: round6(mout + grow) });
    else {
      ops.push({ op: 'add', path: `${mp}/out`, value: round6(mout + grow) });
      const s = carriedStart(ml, dt);
      if (s !== null) ops.push({ op: 'add', path: `${mp}/props/start`, value: round6(s) });
    }
    const track = trackClips(c, ml.track), at = track.findIndex((k) => k.id === m);
    for (const k of track.slice(at + 1)) shifts.set(k.id, (shifts.get(k.id) ?? 0) + grow);
  }
  const moved = shiftAll(doc, compId, new Map([...shifts].filter(([k]) => !linkedIds(c, id).includes(k))));
  if (!moved) return [];
  return chain(doc, [() => [...ops, ...moved], (d) => fitDurationOps(d, compId)]);
}

/**
 * The cut between two neighbouring clips moved to `to`: the left clip ends
 * there and the right one starts there (its file carried), nothing else
 * moves. Limited by the files, and by one frame left on each side. Where a
 * transition overlaps them, their middle is the cut and both edges move
 * together.
 */
export function rollOps(doc: TrammeDoc, compId: string, left: string, right: string, to: number, fileLength?: (asset: string) => number | undefined): Op[] {
  const c = doc.compositions[compId], a = c.layers[left], b = c.layers[right], fr = 1 / c.fps;
  if (!a || !b || !a.track || a.track !== b.track || isLocked(c, left) || isLocked(c, right)) return [];
  const aout = a.out ?? c.duration, bin = b.in ?? 0, ain = a.in ?? 0, bout = b.out ?? c.duration;
  const cut = (bin + aout) / 2;
  const [, aTail] = handles(a, aout - ain, fileLength);
  const [bHead] = handles(b, bout - bin);
  const dt = cutTo4(Math.min(aTail, bout - fr - bin, Math.max(ain + fr - aout, bHead, to - cut)));
  if (Math.abs(dt) < 1e-9) return [];
  return [
    { op: 'add', path: pointer('compositions', compId, 'layers', left, 'out'), value: round6(aout + dt) },
    ...trimInOps(doc, compId, right, bin + dt),
  ];
}

/**
 * The window a clip shows in its file moved by `d` seconds of the timeline
 * (later in the file for a positive `d`), the clip staying where it is. The
 * clips linked to it slip with it. Limited by the start of the file and, when
 * its length is known, its end. Nothing for a clip with no file or whose start
 * is not a plain number.
 */
export function slipOps(doc: TrammeDoc, compId: string, id: string, d: number, fileLength?: (asset: string) => number | undefined): Op[] {
  const c = doc.compositions[compId], l = c.layers[id];
  if (!l || isLocked(c, id) || carriedStart(l, 1) === null) return [];
  const ops: Op[] = [];
  for (const m of linkedIds(c, id)) {
    const ml = c.layers[m], { rate, asset } = sourceOf(ml), total = asset ? fileLength?.(asset) : undefined;
    const to = carriedStart(ml, d);
    if (to === null) continue;
    const last = total === undefined ? Infinity : Math.max(0, total - ((ml.out ?? c.duration) - (ml.in ?? 0)) * rate);
    ops.push({ op: 'add', path: pointer('compositions', compId, 'layers', m, 'props', 'start'), value: round6(Math.min(to, last)) });
  }
  return ops;
}

/**
 * A clip moved by `d` between its neighbours, the track keeping its length:
 * the clip before it ends later (or earlier) by `d`, the one after starts
 * later (or earlier) by `d`, its file carried. Limited so each neighbour keeps
 * a frame. Nothing when the track, or a clip it touches, is locked.
 */
export function slideOps(doc: TrammeDoc, compId: string, id: string, d: number): Op[] {
  const c = doc.compositions[compId], l = c.layers[id], fr = 1 / c.fps;
  if (!l || !l.track) return [];
  const track = trackClips(c, l.track), at = track.findIndex((k) => k.id === id);
  const before = track[at - 1], after = track[at + 1];
  if ([id, before?.id, after?.id].some((x) => x && isLocked(c, x))) return [];
  let dt = d;
  if (before) dt = Math.max(dt, fr - (before.out - before.in));
  if (after) dt = Math.min(dt, after.out - after.in - fr);
  if (!before) dt = Math.max(dt, -(l.in ?? 0));
  dt = cutTo4(dt);
  if (Math.abs(dt) < 1e-9) return [];
  return [
    ...shiftLayerOps(doc, compId, id, dt),
    ...(before ? [{ op: 'add', path: pointer('compositions', compId, 'layers', before.id, 'out'), value: round6(before.out + dt) } as Op] : []),
    ...(after ? trimInOps(doc, compId, after.id, after.in + dt) : []),
  ];
}

/** a layer id not yet used in the composition, nor in `taken`: `stem`, `stem-2`, `stem-3`… */
function freshId(c: Composition, stem: string, taken: Set<string> = new Set()): string {
  let id = stem, n = 1;
  while (c.layers[id] || taken.has(id)) id = `${stem}-${++n}`;
  taken.add(id);
  return id;
}

/** a link id no clip uses yet: `k1`, `k2`… */
function freshLink(c: Composition): string {
  const used = new Set(Object.values(c.layers).map((l) => l.link));
  let n = 1;
  while (used.has(`k${n}`)) n++;
  return `k${n}`;
}

/** one link id for these clips and for every group they already belong to */
export function linkOps(doc: TrammeDoc, compId: string, ids: string[]): Op[] {
  const c = doc.compositions[compId], members = new Set(ids.filter((id) => c.layers[id]).flatMap((id) => linkedIds(c, id)));
  if (members.size < 2) return [];
  const link = freshLink(c);
  return [...members].map((id) => ({ op: 'add', path: pointer('compositions', compId, 'layers', id, 'link'), value: link }));
}

/** these clips taken out of their groups; a clip left alone in its group is freed too */
export function unlinkOps(doc: TrammeDoc, compId: string, ids: string[]): Op[] {
  const c = doc.compositions[compId], out = new Set(ids.filter((id) => c.layers[id]?.link));
  const free = new Set(out);
  for (const link of new Set([...out].map((id) => c.layers[id].link))) {
    const rest = Object.keys(c.layers).filter((k) => c.layers[k].link === link && !out.has(k));
    if (rest.length === 1) free.add(rest[0]);
  }
  return [...free].map((id) => ({ op: 'remove', path: pointer('compositions', compId, 'layers', id, 'link') }));
}

/** what makes a video layer's sound, which its audio layer takes over when the sound is detached */
const SOUND_KEYS = ['start', 'rate', 'loop', 'loopEnd', 'gain', 'fadeIn', 'fadeOut', 'lowCut', 'highCut', 'eqLow', 'eqMid', 'eqMidFreq', 'eqHigh', 'compress', 'reverb', 'voice', 'semitones', 'keepPitch', 'clean'];

/**
 * The sound of a video put on its own audio layer of `audioTrack` (same range,
 * same place in the file, same mix settings), linked to the video, which is
 * muted. Null for a layer that is not a video, one already muted, or when a
 * track involved is locked.
 */
export function detachAudioOps(doc: TrammeDoc, compId: string, id: string, audioTrack: string): { ops: Op[]; id: string } | null {
  const c = doc.compositions[compId], l = c.layers[id], asset = staticValue(l?.props?.video);
  if (!l || l.type !== 'video' || staticValue(l.props?.muted) === true || typeof asset !== 'string') return null;
  if (trackLocked(c, audioTrack) || isLocked(c, id)) return null;
  const props: Record<string, unknown> = { audio: asset };
  for (const k of SOUND_KEYS) if (l.props?.[k] !== undefined) props[k] = structuredClone(l.props[k]);
  const link = l.link ?? freshLink(c), nid = freshId(c, `${id}-sound`);
  const sound: Layer = { type: 'audio', ...(l.name ? { name: `${l.name} (sound)` } : {}), track: audioTrack, link, ...(l.in !== undefined ? { in: l.in } : {}), ...(l.out !== undefined ? { out: l.out } : {}), props: props as Layer['props'] };
  const lp = pointer('compositions', compId, 'layers', id);
  const ops = chain(doc, [
    () => [...addClipOps(compId, nid, sound), { op: 'add', path: `${lp}/props/muted`, value: true } as Op, ...(l.link ? [] : [{ op: 'add', path: `${lp}/link`, value: link } as Op])],
    (d) => syncOrderOps(d, compId),
  ]);
  return { ops, id: nid };
}

/**
 * Clips pasted on a track at `at`, keeping their distances from one another
 * and their keyframes: in `insert` mode room is made for all of them at once,
 * in `overwrite` mode they lie over what is there. Only clips (no groups). The
 * copies are not linked to anything.
 */
export function pasteOps(doc: TrammeDoc, compId: string, clips: Layer[], trackId: string, at: number, mode: 'insert' | 'overwrite'): Op[] {
  const c = doc.compositions[compId], leaves = clips.filter((l) => !l.children).map((l) => { const { link: _link, ...rest } = l; return rest as Layer; });
  if (!leaves.length) return [];
  const base = Math.min(...leaves.map((l) => l.in ?? 0)), total = Math.max(...leaves.map((l) => l.out ?? c.duration)) - base;
  const taken = new Set<string>(), ids = leaves.map(() => freshId(c, 'paste', taken));
  if (mode === 'overwrite') return chain(doc, leaves.map((l, i) => (d: TrammeDoc) => overwriteOps(d, compId, ids[i], l, trackId, at + (l.in ?? 0) - base)));
  const room = makeRoomOps(doc, compId, trackId, at, round6(total));
  if (!room) return [];
  return chain(doc, [
    () => room,
    ...leaves.map((l, i) => () => addClipOps(compId, ids[i], placed(c, l, trackId, at + (l.in ?? 0) - base).clip)),
    (d) => syncOrderOps(d, compId),
    (d) => fitDurationOps(d, compId),
  ]);
}

export type Attribute = 'transform' | 'effects' | 'masks' | 'blend' | 'speed';

/**
 * What a clip looks like, copied onto others: its transform, effects, masks,
 * blend mode, speed. Keyframes move to the target's own time; the range and the
 * file are left alone. An attribute the source does not have is taken off the
 * target. Locked clips are skipped.
 */
export function pasteAttributesOps(doc: TrammeDoc, compId: string, from: string, to: string[], only: Attribute[]): Op[] {
  const c = doc.compositions[compId], src = c.layers[from], ops: Op[] = [];
  if (!src) return ops;
  for (const id of to) {
    const target = c.layers[id];
    if (!target || id === from || isLocked(c, id)) continue;
    const moved = shiftLayerValues(src, (target.in ?? 0) - (src.in ?? 0)), lp = pointer('compositions', compId, 'layers', id);
    const set = (key: string, value: unknown, had: unknown) => {
      if (value !== undefined) ops.push({ op: 'add', path: `${lp}/${key}`, value });
      else if (had !== undefined) ops.push({ op: 'remove', path: `${lp}/${key}` });
    };
    for (const a of only) {
      if (a === 'transform') set('transform', moved.transform, target.transform);
      else if (a === 'effects') set('effects', moved.effects, target.effects);
      else if (a === 'masks') set('masks', moved.masks, target.masks);
      else if (a === 'blend') set('blend', moved.blend, target.blend);
      else {
        const key = src.type === 'comp' ? 'speed' : 'rate';
        if (moved.props?.[key] !== undefined && target.props) ops.push({ op: 'add', path: `${lp}/props/${key}`, value: moved.props[key] });
      }
    }
  }
  return ops;
}

/** how long a clip may overlap the one before it on its track: the length of its transition */
const allowedOverlap = (l: Layer): number => Number(staticValue((l.effects ?? []).find((e) => e.type === 'fx.transition')?.props?.duration)) || 0;

/**
 * A composition turned into a sequence: the pictures (video, image) laid on
 * video tracks, the sounds on audio tracks, every other layer left free, and
 * nothing moved in time or in the stack. A picture goes on the lowest track
 * that holds nothing it overlaps and sits above every picture it overlaps
 * that was under it, so the picture is drawn as before. Run again, it finds
 * nothing to do.
 */
export function toSequenceOps(doc: TrammeDoc, compId: string): Op[] {
  const c = doc.compositions[compId], half = 0.5 / c.fps;
  const tracks = structuredClone(c.tracks ?? []);
  const lane = (kind: 'video' | 'audio', n: number) => {
    const id = `${kind === 'video' ? 'V' : 'A'}${n}`;
    if (!tracks.some((t) => t.id === id)) tracks.push({ id, kind });
    return id;
  };
  const rangeOf = (l: Layer): [number, number] => [l.in ?? 0, l.out ?? c.duration];
  const clash = (a: Layer, b: Layer) => {
    const [ai, ao] = rangeOf(a), [bi, bo] = rangeOf(b), late = ai <= bi ? b : a;
    return Math.min(ao, bo) - Math.max(ai, bi) > allowedOverlap(late) + half;
  };
  const laneNumber = (l: Layer) => Number(String(l.track).slice(1)) || 1;
  const placedOn = new Map<string, { layer: Layer; n: number }[]>([['video', []], ['audio', []]]);
  for (const l of Object.values(c.layers)) {
    const t = tracks.find((x) => x.id === l.track);
    if (t) placedOn.get(t.kind)!.push({ layer: l, n: laneNumber(l) });
  }
  const ops: Op[] = [];
  for (const id of c.order) {
    const l = c.layers[id];
    if (!l || l.children || l.track || !['video', 'image', 'audio'].includes(l.type)) continue;
    const kind = l.type === 'audio' ? 'audio' : 'video', mine = placedOn.get(kind)!;
    const n = kind === 'video'
      ? 1 + Math.max(0, ...mine.filter((m) => clash(m.layer, l)).map((m) => m.n))
      : (() => { let k = 1; while (mine.some((m) => m.n === k && clash(m.layer, l))) k++; return k; })();
    mine.push({ layer: l, n });
    ops.push({ op: 'add', path: pointer('compositions', compId, 'layers', id, 'track'), value: lane(kind, n) });
  }
  if (!ops.length && c.kind === 'sequence') return [];
  const rank = (t: { kind: string; id: string }) => (t.kind === 'video' ? 0 : 1) * 1e6 + (Number(t.id.slice(1)) || 0);
  tracks.sort((a, b) => rank(a) - rank(b));
  if (!tracks.length) tracks.push({ id: 'V1', kind: 'video' }, { id: 'A1', kind: 'audio' });
  return [
    ...(c.kind === 'sequence' ? [] : [{ op: 'add', path: pointer('compositions', compId, 'kind'), value: 'sequence' } as Op]),
    ...(JSON.stringify(tracks) === JSON.stringify(c.tracks) ? [] : [{ op: 'add', path: pointer('compositions', compId, 'tracks'), value: tracks } as Op]),
    ...ops,
  ];
}
