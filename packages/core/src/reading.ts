// The reading of a reference: how a video the user gave is made, written once
// at authoring time (assets/references/<name>.reference.json) so the user's
// film can be made the same way around the user's own assets. It holds the
// making (scenes, timing on the music, slots where content sits, moves,
// transitions, pace, palette, type) and the words seen in it, only so the
// film can be checked never to show them. Pure functions: the editor reads
// the frames and asks the model, these shape, match and check.

import { z } from 'zod';

/** what sits in a slot of a scene */
export const SLOT_ROLES = ['logo', 'headline', 'text', 'screenshot', 'photo', 'video', 'product', 'person', 'figure', 'shape'] as const;
export type SlotRole = (typeof SLOT_ROLES)[number];
/** how a slot comes on screen */
export const ENTRANCES = ['none', 'fade', 'rise', 'fall', 'slide', 'scale', 'pop', 'mask', 'type-on', 'blur'] as const;
export type Entrance = (typeof ENTRANCES)[number];
/** how something moves once it is there, or how the camera moves */
export const MOVES = ['push-in', 'pull-out', 'pan', 'tilt', 'rise', 'fall', 'slide', 'scale', 'rotate', 'mask-reveal', 'type-on', 'parallax', 'hold'] as const;
export type MoveKind = (typeof MOVES)[number];
/** how a scene follows the one before */
export const TRANSITIONS = ['cut', 'fade', 'dissolve', 'wipe', 'push', 'zoom', 'mask', 'whip', 'match'] as const;
export type Transition = (typeof TRANSITIONS)[number];
/** how the text of a scene comes */
export const TEXT_RHYTHMS = ['none', 'held', 'line-by-line', 'word-by-word', 'letter-by-letter'] as const;
export type TextRhythm = (typeof TEXT_RHYTHMS)[number];

/** where a slot's content comes from in the user's film */
export type Fill = 'asset' | 'words' | 'build' | 'missing';

const unit = z.number().min(0).max(1);
const seconds = z.number().min(0).refine(Number.isFinite, 'finite number expected');
const hexColour = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'a colour is #RRGGBB');
const id = z.string().regex(/^[A-Za-z0-9_-]+$/, 'id: letters, digits, _ and - only');

export const SlotSchema = z.strictObject({
  id,
  role: z.enum(SLOT_ROLES),
  /** x, y, width, height in 0..1 of the frame */
  box: z.tuple([unit, unit, unit, unit]),
  enter: z.enum(ENTRANCES),
  /** when it enters, seconds from the scene's start */
  at: seconds,
  /** a text slot: how many words it holds */
  words: z.number().int().min(0).max(200).optional(),
  /** what the slot shows, in words, never the reference's own content ("a phone screen", "the brand's mark") */
  note: z.string().max(200).optional(),
  /** the user's asset proposed for it */
  asset: z.string().optional(),
  fill: z.enum(['asset', 'words', 'build', 'missing']).optional(),
});
export type Slot = z.infer<typeof SlotSchema>;

export const MoveSchema = z.strictObject({
  /** 'camera', or the id of a slot of the scene */
  subject: z.string().min(1),
  kind: z.enum(MOVES),
  start: seconds,
  end: seconds,
  direction: z.enum(['left', 'right', 'up', 'down', 'in', 'out']).optional(),
  /** px/s at the reference's width, read from its pixels */
  speed: z.number().min(0).optional(),
});
export type Move = z.infer<typeof MoveSchema>;

export const ReadingSceneSchema = z.strictObject({
  id,
  start: seconds,
  end: seconds,
  /** the place of its first frame on the reference's music: bar (from 0) and beat in the bar (from 0); absent when it does not fall on a beat */
  onBeat: z.strictObject({ bar: z.number().int().min(0), beat: z.number().int().min(0) }).optional(),
  /** the kind of picture, as the film plan names them */
  kind: z.string().min(1),
  /** what the scene does, in a sentence, in terms of the making (never the reference's subject) */
  what: z.string().min(1).max(400),
  /** the ground behind the slots: a colour, a gradient, footage */
  ground: z.string().max(200).optional(),
  slots: z.array(SlotSchema).max(16),
  moves: z.array(MoveSchema).max(16),
  /** how this scene comes after the one before (the first: how the film opens) */
  transition: z.enum(TRANSITIONS),
  text: z.enum(TEXT_RHYTHMS),
});
export type ReadingScene = z.infer<typeof ReadingSceneSchema>;

export const ReadingSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal('reference-reading'),
  /** the reference asset read */
  source: z.string().min(1),
  name: z.string(),
  from: z.enum(['video', 'lottie']),
  duration: seconds,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** the reference's music: tempo, its beats and the first beat of each bar (s) */
  tempo: z.number().positive().optional(),
  beats: z.array(seconds).optional(),
  bars: z.array(seconds).optional(),
  scenes: z.array(ReadingSceneSchema).min(1).max(64),
  /** colours read from the pixels, the most present first */
  palette: z.array(hexColour).max(8),
  /** the type, as words a typeface search reads ("condensed grotesque, heavy, capitals, tight") */
  type: z.strictObject({
    description: z.string().max(300), serif: z.boolean().optional(), weight: z.enum(['light', 'regular', 'medium', 'bold', 'heavy']).optional(), case: z.enum(['upper', 'lower', 'mixed']).optional(),
    /** the nearest typefaces the project can use, the closest first */
    nearest: z.array(z.string()).max(5).optional(),
  }),
  /** the words seen in the reference, kept only to check the film never shows them */
  texts: z.array(z.string().max(300)).max(200),
  /** the user accepted the reading (or accepts readings in advance) */
  accepted: z.boolean().optional(),
});
export type Reading = z.infer<typeof ReadingSchema>;

export const READINGS_DIR = 'assets/references';

/** a reading read from its file, or null when the file is not one */
export function parseReading(raw: string | null | undefined): Reading | null {
  try { const r = ReadingSchema.safeParse(JSON.parse(raw ?? 'null')); return r.success ? r.data : null; } catch { return null; }
}

/** what is wrong with a reading, one line each: its shape first, then the order of its times */
export function readingIssues(value: unknown): string[] {
  const r = ReadingSchema.safeParse(value);
  if (!r.success) return r.error.issues.slice(0, 12).map((i) => `${i.path.join('.') || 'reading'}: ${i.message}`);
  const out: string[] = [], { scenes, duration } = r.data;
  scenes.forEach((s, i) => {
    if (s.end <= s.start) out.push(`${s.id}: ends before it starts`);
    if (i && Math.abs(s.start - scenes[i - 1].end) > 0.05) out.push(`${s.id}: starts at ${s.start} s, the scene before ends at ${scenes[i - 1].end} s`);
    const len = s.end - s.start;
    for (const sl of s.slots) if (sl.at > len) out.push(`${s.id}, ${sl.id}: enters after the scene's end`);
    for (const m of s.moves) {
      if (m.end <= m.start || m.end > len + 0.05) out.push(`${s.id}: the ${m.kind} of ${m.subject} must run within the scene, start before end`);
      if (m.subject !== 'camera' && !s.slots.some((sl) => sl.id === m.subject)) out.push(`${s.id}: the ${m.kind} moves "${m.subject}", which is no slot of the scene`);
    }
  });
  if (Math.abs(scenes.at(-1)!.end - duration) > 0.1) out.push(`the last scene ends at ${scenes.at(-1)!.end} s, the reference lasts ${duration} s`);
  if (new Set(scenes.map((s) => s.id)).size !== scenes.length) out.push('two scenes share an id');
  return out;
}

// ── the music's grid ──────────────────────────────────────────

/** the beat nearest a time, when one is within `tolerance` s: its bar (from 0) and its beat in the bar (from 0) */
export function gridPlace(t: number, beats: number[], bars: number[], tolerance = 0.08): { bar: number; beat: number } | undefined {
  if (!beats.length) return undefined;
  let k = 0;
  for (let i = 1; i < beats.length; i++) if (Math.abs(beats[i] - t) < Math.abs(beats[k] - t)) k = i;
  if (Math.abs(beats[k] - t) > tolerance) return undefined;
  const at = beats[k];
  let bar = -1;
  for (let i = 0; i < bars.length; i++) if (bars[i] <= at + 1e-3) bar = i;
  if (bar < 0) return { bar: 0, beat: beats.filter((b) => b < at - 1e-3).length };
  return { bar, beat: beats.filter((b) => b >= bars[bar] - 1e-3 && b < at - 1e-3).length };
}

/** the time of a place on a music's grid; undefined when the music is shorter */
export function gridTime(place: { bar: number; beat: number }, beats: number[], bars: number[]): number | undefined {
  const start = bars[place.bar];
  if (start === undefined) return undefined;
  const from = beats.findIndex((b) => b >= start - 1e-3);
  return from < 0 ? undefined : beats[from + place.beat];
}

/** the scenes of a video from its cuts: their bounds and their place on the music when they fall on a beat */
export function scenesFromCuts(cuts: number[], duration: number, music?: { beats: number[]; bars: number[] }): Pick<ReadingScene, 'id' | 'start' | 'end' | 'onBeat'>[] {
  const bounds = [0, ...cuts.filter((c) => c > 0.05 && c < duration - 0.05).sort((a, b) => a - b), duration];
  return bounds.slice(1).map((end, i) => {
    const start = bounds[i], place = music && i > 0 ? gridPlace(start, music.beats, music.bars) : undefined;
    return { id: `s${i + 1}`, start: +start.toFixed(3), end: +end.toFixed(3), ...(place ? { onBeat: place } : {}) };
  });
}

/** the pace of a reading: cuts per second and the lengths of its shots */
export function paceOf(scenes: Pick<ReadingScene, 'start' | 'end'>[]): { cuts: number; perSecond: number; mean: number; shortest: number; longest: number } {
  const lens = scenes.map((s) => s.end - s.start), total = lens.reduce((a, b) => a + b, 0);
  const r = (x: number) => +x.toFixed(2);
  return { cuts: Math.max(0, scenes.length - 1), perSecond: r(total ? (scenes.length - 1) / total : 0), mean: r(total / Math.max(1, lens.length)), shortest: r(Math.min(...lens)), longest: r(Math.max(...lens)) };
}

/**
 * The scenes' bounds on another music: each cut that fell on a beat of the
 * reference falls at the same place of the bar in the user's music; the
 * others keep their length. Without the reference's music, its timing.
 */
export function retime(reading: Pick<Reading, 'scenes' | 'duration'>, music?: { beats: number[]; bars: number[] }): { id: string; start: number; end: number }[] {
  const out: { id: string; start: number; end: number }[] = [];
  reading.scenes.forEach((s, i) => {
    const prev = out[i - 1];
    const placed = prev && s.onBeat && music ? gridTime(s.onBeat, music.beats, music.bars) : undefined;
    // on the user's beat when it comes after the scene before has begun; else right after it, at its length
    const start = !prev ? 0 : placed !== undefined && placed > prev.start + 0.2 ? placed : prev.end;
    if (prev) prev.end = +start.toFixed(3);
    out.push({ id: s.id, start: +start.toFixed(3), end: +(start + (s.end - s.start)).toFixed(3) });
  });
  return out;
}

// ── the outline the user corrects ─────────────────────────────

/** the reading with a scene removed: the scenes after it come earlier by its length */
export function dropScene(r: Reading, id: string): Reading {
  const i = r.scenes.findIndex((s) => s.id === id);
  if (i < 0 || r.scenes.length < 2) return r;
  const cut = r.scenes[i].end - r.scenes[i].start, round = (x: number) => +x.toFixed(3);
  const scenes = r.scenes.filter((_, k) => k !== i).map((s, k) => (k >= i ? { ...s, start: round(s.start - cut), end: round(s.end - cut) } : s));
  return { ...r, scenes, duration: round(r.duration - cut) };
}

/** the reading with a scene and the next made one: its slots and moves timed from the first's start, the next's ids kept apart */
export function mergeScenes(r: Reading, id: string): Reading {
  const i = r.scenes.findIndex((s) => s.id === id), a = r.scenes[i], b = r.scenes[i + 1];
  if (!a || !b) return r;
  const shift = b.start - a.start, round = (x: number) => +x.toFixed(3);
  const ids = new Set(a.slots.map((s) => s.id)), rename = new Map(b.slots.map((s) => [s.id, ids.has(s.id) ? `${s.id}-${b.id}` : s.id]));
  const merged: ReadingScene = {
    ...a, end: b.end, what: `${a.what} Then ${b.what.charAt(0).toLowerCase()}${b.what.slice(1)}`.slice(0, 400),
    slots: [...a.slots, ...b.slots.map((s) => ({ ...s, id: rename.get(s.id)!, at: round(s.at + shift) }))].slice(0, 16),
    moves: [...a.moves, ...b.moves.map((m) => ({ ...m, subject: rename.get(m.subject) ?? m.subject, start: round(m.start + shift), end: round(m.end + shift) }))].slice(0, 16),
    text: a.text === 'none' ? b.text : a.text,
  };
  return { ...r, scenes: [...r.scenes.slice(0, i), merged, ...r.scenes.slice(i + 2)] };
}

// ── the user's assets in the slots ─────────────────────────────

export interface UserAsset { id: string; type: string; name?: string; tags?: string[]; width?: number; height?: number }

const NAMES: Partial<Record<SlotRole, RegExp>> = {
  logo: /logo|brand|mark|icon|emblem|wordmark/i,
  screenshot: /screen|capture|shot|ui\b|app|dashboard|interface|mockup|site|page/i,
  product: /product|pack|bottle|box|device|item/i,
  person: /portrait|person|team|face|founder|headshot|people|speaker/i,
  photo: /photo|picture|image|background|scene|place|landscape/i,
};

/** what an asset of the user looks like it is for, the strongest first */
function rolesOf(a: UserAsset): SlotRole[] {
  const words = `${a.name ?? a.id} ${(a.tags ?? []).join(' ')}`;
  if (a.type === 'video') return ['video', 'photo', 'person', 'product', 'screenshot'];
  if (a.type !== 'image') return [];
  const named = (Object.keys(NAMES) as SlotRole[]).filter((r) => NAMES[r]!.test(words));
  const wide = a.width && a.height ? a.width / a.height : 0;
  // a picture shaped like a screen, when its name says nothing
  const shaped: SlotRole[] = !named.length && wide && (Math.abs(wide - 16 / 9) < 0.12 || Math.abs(wide - 9 / 19.5) < 0.08 || Math.abs(wide - 16 / 10) < 0.08) ? ['screenshot'] : [];
  return [...new Set([...named, ...shaped, 'photo', 'product', 'person', 'screenshot'] as SlotRole[])];
}

const CONTENT: SlotRole[] = ['logo', 'screenshot', 'photo', 'video', 'product', 'person'];

/**
 * The user's assets proposed for the slots, by role: the logo in the logo's
 * slots (it may come back), a screenshot in a screen, a portrait for a
 * person; each other asset used once while unused ones remain. Text slots
 * take words, figures and shapes are built; a content slot nothing fits is
 * missing. An asset already chosen (by the user) stays.
 */
export function assignSlots<R extends Pick<Reading, 'scenes'>>(reading: R, assets: UserAsset[]): R & { missing: { scene: string; slot: string; role: SlotRole }[] } {
  const used = new Map<string, number>(), missing: { scene: string; slot: string; role: SlotRole }[] = [];
  const known = new Set(assets.map((a) => a.id));
  for (const s of reading.scenes) for (const sl of s.slots) if (sl.asset && known.has(sl.asset)) used.set(sl.asset, (used.get(sl.asset) ?? 0) + 1);
  const pick = (role: SlotRole): string | undefined => {
    const fits = assets.map((a) => ({ a, rank: rolesOf(a).indexOf(role) })).filter((x) => x.rank >= 0);
    if (!fits.length) return undefined;
    // the logo comes back on every slot of its own; any other asset is used once while one unused fits
    fits.sort((p, q) => (role === 'logo' ? 0 : (used.get(p.a.id) ?? 0) - (used.get(q.a.id) ?? 0)) || p.rank - q.rank);
    const best = fits[0];
    // a logo slot takes only a logo; another slot takes a logo only when nothing else fits
    if (role === 'logo' && best.rank !== 0) return undefined;
    if (role !== 'logo' && rolesOf(best.a)[0] === 'logo' && fits.some((f) => rolesOf(f.a)[0] !== 'logo')) return fits.find((f) => rolesOf(f.a)[0] !== 'logo')!.a.id;
    return best.a.id;
  };
  const scenes = reading.scenes.map((s) => ({
    ...s,
    slots: s.slots.map((sl) => {
      if (sl.role === 'headline' || sl.role === 'text') return { ...sl, fill: 'words' as const };
      if (sl.role === 'figure' || sl.role === 'shape') return { ...sl, fill: 'build' as const };
      if (sl.asset && known.has(sl.asset)) return { ...sl, fill: 'asset' as const };
      const chosen = CONTENT.includes(sl.role) ? pick(sl.role) : undefined;
      if (!chosen) { missing.push({ scene: s.id, slot: sl.id, role: sl.role }); const { asset: _, ...rest } = sl; return { ...rest, fill: 'missing' as const }; }
      used.set(chosen, (used.get(chosen) ?? 0) + 1);
      return { ...sl, asset: chosen, fill: 'asset' as const };
    }),
  }));
  return { ...reading, scenes, missing };
}

// ── the reading as the model reads it ──────────────────────────

const box = (b: Slot['box']) => `x ${b[0].toFixed(2)} y ${b[1].toFixed(2)} w ${b[2].toFixed(2)} h ${b[3].toFixed(2)}`;
const len = (s: Pick<ReadingScene, 'start' | 'end'>) => (s.end - s.start).toFixed(2);

/** one scene of a reading, in lines: its timing, ground, slots, moves, transition and text */
export function sceneText(s: ReadingScene): string {
  return [
    `${s.id} (${s.start.toFixed(2)}–${s.end.toFixed(2)} s, ${len(s)} s${s.onBeat ? `, cut on bar ${s.onBeat.bar + 1} beat ${s.onBeat.beat + 1}` : ''}), ${s.kind}, comes by ${s.transition}: ${s.what}`,
    ...(s.ground ? [`  ground: ${s.ground}`] : []),
    ...s.slots.map((sl) => `  slot ${sl.id}: ${sl.role} at ${box(sl.box)}, enters by ${sl.enter} at ${sl.at.toFixed(2)} s${sl.words ? `, ${sl.words} words` : ''}${sl.note ? ` (${sl.note})` : ''}${sl.asset ? ` → asset "${sl.asset}"` : sl.fill === 'missing' ? ' → no asset of the user fits' : ''}`),
    ...s.moves.map((m) => `  move: ${m.subject} ${m.kind}${m.direction ? ` ${m.direction}` : ''} ${m.start.toFixed(2)}–${m.end.toFixed(2)} s${m.speed ? ` at ${Math.round(m.speed)} px/s` : ''}`),
    ...(s.text !== 'none' ? [`  text comes ${s.text}`] : []),
  ].join('\n');
}

/** the whole reading for the model: the format, the music, the pace, the look, then each scene */
export function readingText(r: Reading): string {
  const pace = paceOf(r.scenes);
  return [
    `Reference "${r.name}" (${r.from}, ${r.width}×${r.height}, ${r.duration.toFixed(2)} s)${r.tempo ? `, music at ${Math.round(r.tempo)} bpm` : ''}.`,
    `Pace: ${r.scenes.length} scenes, ${pace.perSecond} cuts/s, shots ${pace.shortest}–${pace.longest} s (mean ${pace.mean}).`,
    `Palette: ${r.palette.join(', ') || 'unread'}. Type: ${r.type.description}.`,
    ...r.scenes.map(sceneText),
  ].join('\n');
}

// ── the checks ──────────────────────────────────────────────

/** a scene of the user's film as the checks see it: the reading scene it follows, its bounds, where each slot landed, its moves and how it came */
export interface BuiltScene {
  follows: string;
  start: number;
  end: number;
  /** the slots' boxes in 0..1, null for a slot no layer fills */
  slots: Record<string, Slot['box'] | null>;
  /** the kinds of move found in it */
  moves: MoveKind[];
  transition?: Transition;
}

/** how far a slot may land from its place, in share of the frame */
const PLACE = 0.12;
/** how far a scene's length may differ, in share of it (at least LENGTH_MIN s) */
const LENGTH = 0.1, LENGTH_MIN = 0.15;

/** the families of moves that read alike in a built film (a pan is found as a slide of the whole) */
const FAMILY: Record<MoveKind, string> = {
  'push-in': 'scale', 'pull-out': 'scale', scale: 'scale', pan: 'travel', tilt: 'travel', rise: 'travel', fall: 'travel', slide: 'travel', parallax: 'travel',
  rotate: 'rotate', 'mask-reveal': 'mask', 'type-on': 'text', hold: 'hold',
};

/** a line of the structure check; blocking when it is measured for sure (a scene, a length, a cut, an empty slot), advice when read from the layers' keyframes and places */
export interface StructureIssue { line: string; blocking: boolean }

/**
 * What keeps the user's film from following the reading's structure, one line
 * each: scenes missing or added, lengths off, cuts off the beats and empty
 * slots (blocking); slots away from their place, moves and transitions not
 * made (advice: what the layers say of them is a reading too).
 */
export function structureIssues(reading: Pick<Reading, 'scenes'>, built: BuiltScene[], timing?: { id: string; start: number; end: number }[]): StructureIssue[] {
  const out: StructureIssue[] = [];
  const block = (line: string) => out.push({ line, blocking: true }), advise = (line: string) => out.push({ line, blocking: false });
  const wanted = timing ?? reading.scenes.map((s) => ({ id: s.id, start: s.start, end: s.end }));
  for (const s of reading.scenes) {
    const b = built.find((x) => x.follows === s.id);
    if (!b) { block(`${s.id}: no scene of the film follows it`); continue; }
    const want = wanted.find((w) => w.id === s.id) ?? s, length = want.end - want.start, got = b.end - b.start;
    if (Math.abs(got - length) > Math.max(LENGTH_MIN, length * LENGTH)) block(`${s.id}: lasts ${got.toFixed(2)} s, the reference's ${length.toFixed(2)} s`);
    if (s.onBeat && Math.abs(b.start - want.start) > 0.08) block(`${s.id}: starts at ${b.start.toFixed(2)} s, its cut is on bar ${s.onBeat.bar + 1} beat ${s.onBeat.beat + 1} at ${want.start.toFixed(2)} s`);
    for (const sl of s.slots) {
      const at = b.slots[sl.id];
      if (at === undefined || at === null) { block(`${s.id}, ${sl.id}: the ${sl.role} slot is empty`); continue; }
      const dx = Math.abs(at[0] + at[2] / 2 - (sl.box[0] + sl.box[2] / 2)), dy = Math.abs(at[1] + at[3] / 2 - (sl.box[1] + sl.box[3] / 2));
      if (Math.max(dx, dy) > PLACE) advise(`${s.id}, ${sl.id}: the ${sl.role} sits at ${box(at)}, the reference's at ${box(sl.box)}`);
      const size = (b2: Slot['box']) => Math.max(b2[2], b2[3]);
      if (size(sl.box) > 0 && Math.abs(size(at) - size(sl.box)) / size(sl.box) > 0.35) advise(`${s.id}, ${sl.id}: the ${sl.role} is ${size(at) > size(sl.box) ? 'larger' : 'smaller'} than the reference's (${size(at).toFixed(2)} of the frame against ${size(sl.box).toFixed(2)})`);
    }
    const found = new Set(b.moves.map((m) => FAMILY[m]));
    for (const m of s.moves) if (m.kind !== 'hold' && !found.has(FAMILY[m.kind])) advise(`${s.id}: the reference's ${m.kind} of ${m.subject} is not made`);
    if (b.transition && b.transition !== s.transition && reading.scenes.indexOf(s) > 0) advise(`${s.id}: comes by ${b.transition}, the reference's by ${s.transition}`);
  }
  const extra = built.filter((b) => !reading.scenes.some((s) => s.id === b.follows));
  if (extra.length) block(`${extra.length} scene(s) of the film follow no scene of the reference: ${extra.map((b) => b.follows).join(', ')}`);
  return out;
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const wordsIn = (s: string) => fold(s).match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * The reference's words found in the film, one line each: a run of three of
 * its words in a row, or a name of it (a capitalised or upper-case word, or
 * one with digits, of four letters or more) that the user's own words (the
 * brief, the asset names) do not hold.
 */
export function contentIssues(referenceTexts: string[], filmTexts: string[], userWords: string): string[] {
  const film = filmTexts.map(wordsIn), own = new Set(wordsIn(userWords)), out: string[] = [];
  const filmRuns = new Set(film.flatMap((w) => w.slice(0, -2).map((_, i) => w.slice(i, i + 3).join(' '))));
  const filmWords = new Set(film.flat());
  const seen = new Set<string>();
  for (const text of referenceTexts) {
    const words = wordsIn(text);
    for (let i = 0; i + 3 <= words.length; i++) {
      const run = words.slice(i, i + 3).join(' ');
      if (filmRuns.has(run) && !words.slice(i, i + 3).every((w) => own.has(w)) && !seen.has(run)) { seen.add(run); out.push(`the film says "${run}", words of the reference`); }
    }
    for (const raw of text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []) {
      const w = fold(raw);
      const name = raw.length >= 4 && (/^\p{Lu}/u.test(raw) || /\p{N}/u.test(raw));
      if (name && filmWords.has(w) && !own.has(w) && !seen.has(w)) { seen.add(w); out.push(`the film shows "${raw}", a name of the reference`); }
    }
  }
  return out;
}
