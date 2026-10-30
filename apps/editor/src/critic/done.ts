// What "done" means, measured before any opinion: a film is not done while a
// scene is a flat plate, the type has no hierarchy, a talking video has a long
// bare stretch, nothing is the hero, the ending is thin, scenes meet with no
// transition, the sound is missing, something is provisional or the text
// cannot be read. The critic's verdict cannot overrule these.

import { staticValue, type Layer, type QualityIssue, type Registry, type TrammeDoc } from '@tramme/core';
import { filmTime, scenesOf, sceneAt, type Scene } from '../scenes.ts';
import type { FilmPlan } from '../filmplan.ts';

export interface DoneIssue { id: string; scene?: string; line: string }

/** what the beats of the project say, when it has them */
export interface BeatData { data: (id: string) => unknown; analysisIds: string[] }

/** a type this far apart in size reads as a hierarchy */
const RATIO = 1.6;
/** a cut this near a beat is on it (s) */
const ON_BEAT = 0.05;
/** a transition effect this near a cut belongs to it (s) */
const NEAR_CUT = 0.6;
const PROVISIONAL = /lorem|ipsum|placeholder|todo|tbd|xxx|\[[^\]]*\]/i;
/** layers that are no picture: words, sound */
const NOT_VISUAL = new Set(['text', 'captions', 'audio', 'sound', 'group']);
const WORDS = new Set(['text', 'captions']);

/** a prop's value: the first key of an animated one, the value of a static one */
function valueOf(p: unknown): unknown {
  if (p && typeof p === 'object' && Array.isArray((p as { $k?: unknown[] }).$k)) return ((p as { $k: { v: unknown }[] }).$k[0])?.v;
  return staticValue(p);
}

/** a flat-filled shape: a solid colour and nothing else to look at */
function isFlat(l: Layer): boolean {
  if (!l.type.startsWith('shape.') && l.type !== 'path') return false;
  const fill = valueOf(l.props?.fill);
  return fill === undefined || fill === null || typeof fill === 'string';
}

/** what a scene is made of: the layers of its composition, or the film's layers it spans (the film's own sound and its scenes' places are not it) */
function layersOf(doc: TrammeDoc, compId: string, s: Scene): { id: string; layer: Layer }[] {
  const comp = s.comp ? doc.compositions[s.comp] : doc.compositions[compId];
  return Object.entries(comp.layers)
    .filter(([, l]) => l.visible !== false && (s.comp || l.type !== 'comp' || scenesOf(doc, compId).length === 1))
    .filter(([, l]) => s.comp || ((l.in ?? 0) < s.to && (l.out ?? comp.duration) > s.from))
    .map(([id, layer]) => ({ id, layer }));
}

const textSize = (l: Layer) => Number(valueOf(l.props?.size));

export function doneIssues(doc: TrammeDoc, compId: string, registry: Registry, plan: FilmPlan | null, issues: QualityIssue[], beats?: BeatData): DoneIssue[] {
  void registry;
  const comp = doc.compositions[compId];
  if (!comp) return [];
  const scenes = scenesOf(doc, compId), out: DoneIssue[] = [];
  const parts = scenes.map((s) => ({ scene: s, layers: layersOf(doc, compId, s) }));
  const where = (t: number | undefined) => (t === undefined ? undefined : sceneAt(scenes, t)?.name);

  // material: a scene with nothing to look at but words and flat shapes
  for (const { scene, layers } of parts) {
    if (!layers.some(({ layer: l }) => !NOT_VISUAL.has(l.type) && !isFlat(l))) out.push({ id: 'material', scene: scene.name, line: `${scene.name} is flat plates and words: give it something to look at (a picture, an object, a texture, a chart, a solid)` });
  }

  // hierarchy: the film's texts, and each scene's
  const sizes = (list: { layer: Layer }[]) => list.filter(({ layer }) => WORDS.has(layer.type)).map(({ layer }) => textSize(layer)).filter((n) => n > 0);
  const all = [...new Set(parts.length ? parts.flatMap((p) => p.layers) : [])];
  const filmSizes = sizes(all);
  if (filmSizes.length >= 3 && Math.max(...filmSizes) / Math.min(...filmSizes) < RATIO) out.push({ id: 'hierarchy', line: 'the type has no hierarchy: set the key words much larger than the rest (a ratio of 1.6 or more between two sizes)' });
  else for (const { scene, layers } of parts) {
    const s = sizes(layers);
    if (s.length >= 3 && Math.max(...s) / Math.min(...s) < 1.01) out.push({ id: 'hierarchy', scene: scene.name, line: `${scene.name} says everything in one size: set what matters larger` });
  }

  // coverage: the stretches of a talking video with only the speaker
  for (const i of issues) if (i.check === 'coverage' && i.severity === 'warning') out.push({ id: 'coverage', scene: where(i.t), line: `${Math.round(i.rank ?? 0)} s with only the speaker on screen from ${(i.t ?? 0).toFixed(1)} s: put something to look at over it` });

  // hero: the one moment the film is for
  const heroes = plan?.scenes.some((s) => s.hero) || Object.values(doc.compositions).some((c) => (c.markers ?? []).some((m) => m.kind === 'hero'));
  if (!heroes) out.push({ id: 'hero', line: 'no scene is the hero: mark the one that must be seen (a marker of kind hero, or the plan) and give it the most room, the closest look and the loudest cue' });

  // ending: the last scene closes the film
  const last = parts.at(-1);
  if (last) {
    const closes = last.layers.some(({ id, layer: l }) => WORDS.has(l.type) || l.type === 'image' || /logo/i.test(l.name ?? id));
    if (last.scene.to - last.scene.from < 1.5) out.push({ id: 'ending', scene: last.scene.name, line: `${last.scene.name} lasts under 1.5 s: the ending needs time to land` });
    else if (!closes) out.push({ id: 'ending', scene: last.scene.name, line: `${last.scene.name} closes on no words and no logo or picture: end on a line, a logo or a held picture` });
  }

  // transitions: two scenes meeting
  const beatTimes = (beats?.analysisIds ?? []).flatMap((id) => { const a = beats!.data(id) as { beats?: number[] } | undefined; return Array.isArray(a?.beats) ? a!.beats : []; });
  scenes.slice(1).forEach((s, i) => {
    const before = scenes[i];
    const overlap = before.to > s.from + 0.05;
    const nearFx = (list: [string, Layer][], when: (l: Layer) => number | null) => list.some(([, l]) => (l.effects ?? []).some((e) => e.type === 'fx.transition' && e.enabled !== false) && Math.abs((when(l) ?? Infinity) - s.from) <= NEAR_CUT);
    const root = Object.entries(comp.layers), inner = s.comp ? Object.entries(doc.compositions[s.comp].layers) : [];
    const named = root.some(([id, l]) => /transition/i.test(l.name ?? id) && Math.abs((l.in ?? 0) - s.from) <= NEAR_CUT);
    const onBeat = beatTimes.some((b) => Math.abs(b - s.from) <= ON_BEAT);
    if (!overlap && !nearFx(root, (l) => l.in ?? 0) && !nearFx(inner, (l) => filmTime(doc, compId, s, l.in ?? 0)) && !named && !onBeat) out.push({ id: 'transitions', scene: s.name, line: `${before.name} to ${s.name} is a hard cut with no transition, overlap or beat under it: cut on a beat, overlap the two, or use a transition` });
  });

  // sound: a film with no sound, or the sound checks' warnings
  const sounded = Object.values(doc.compositions).some((c) => Object.values(c.layers).some((l) => (l.type === 'audio' || l.type === 'video') && l.visible !== false));
  if (!sounded) out.push({ id: 'sound', line: 'the film has no sound: add music, and sound effects on the moments that matter' });
  for (const i of issues.filter((x) => x.check === 'sound' && x.severity === 'warning').slice(0, 3)) out.push({ id: 'sound', scene: where(i.t), line: i.message });

  // provisional: what is not finished
  for (const [cid, c] of Object.entries(doc.compositions)) {
    for (const [id, l] of Object.entries(c.layers)) {
      const name = l.name ?? id, at = cid === compId ? '' : ` in ${c.name ?? cid}`;
      const text = WORDS.has(l.type) ? valueOf(l.props?.text) : undefined;
      if (typeof text === 'string' && PROVISIONAL.test(text)) out.push({ id: 'provisional', line: `"${name}"${at} holds provisional text ("${text.slice(0, 40)}")` });
      else if ((l.type === 'image' && !valueOf(l.props?.image)) || (l.type === 'video' && !valueOf(l.props?.video))) out.push({ id: 'provisional', line: `"${name}"${at} has no file` });
      else if (/placeholder/i.test(l.name ?? '')) out.push({ id: 'provisional', line: `"${name}"${at} is a placeholder` });
    }
  }

  // readable: the checks' warnings on text
  for (const i of issues.filter((x) => (x.check === 'text-size' || x.check === 'text-time') && x.severity === 'warning').slice(0, 3)) out.push({ id: 'readable', scene: where(i.t), line: i.message });
  return out;
}
