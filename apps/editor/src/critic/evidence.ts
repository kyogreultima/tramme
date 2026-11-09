// Bounded visual evidence: an overview across the whole film, details around
// selected events and directed beats, the target, plan and measured facts.

import { sampleAt, type QualityIssue, type Registry, type ToolContext, type TrammeDoc } from '@tramme/core';
import { qualityChecksOf } from '../isolated-checks.ts';
import { editorEvaluator } from '../evaluator.ts';
import { sandboxedDoc } from '../installed.ts';
import { prefs } from '../settings.ts';
import { samplePlacedTimes } from '../isolated-placed.ts';
import type { PlacedSample } from '../plugins/protocol.ts';
import { analyses } from '../perception.ts';
import { sheetOf, stills } from '../review.ts';
import { filmTime, scenesOf, sceneAt } from '../scenes.ts';
import { FILM_PLAN_PATH, motionText, parsePlan, planText, type FilmPlan } from '../filmplan.ts';

export interface Moment { t: number; why: string; scene: string }
export interface ReviewSample { times: number[]; caption: string }

/** Planned beats use scene-local time, unlike ordinary root-layer keyframes. */
export function directedMoments(doc: TrammeDoc, compId: string, plan: FilmPlan | null): (Moment & { end: number })[] {
  return scenesOf(doc, compId).flatMap((s) => {
    const planned = plan?.scenes.find((p) => p.id === s.id || p.name === s.name || (!!s.comp && p.comp === s.comp));
    const at = (local: number) => s.comp ? filmTime(doc, compId, s, local) : s.from + local;
    return (planned?.motion ?? []).flatMap((b) => {
      const t = at(b.start), end = at(b.settle ?? b.end);
      return t === null || end === null || t >= s.to || end < s.from ? [] : [{ t: Math.max(s.from, t), end: Math.min(s.to, end), why: `${b.subject}: ${b.action}`, scene: s.name }];
    });
  });
}

/** Keep both ends when there are more events than the visual budget can show. */
function spread<T>(items: T[], n: number): T[] {
  if (n <= 0) return [];
  if (items.length <= n) return items;
  if (n === 1) return [items[Math.floor(items.length / 2)]];
  return Array.from({ length: n }, (_, i) => items[Math.round(i * (items.length - 1) / (n - 1))]);
}

/** Three overview rows, then up to nine details, still at most 48 frames. */
export function reviewSamples(duration: number, fps: number, moments: Moment[], directed: (Moment & { end: number })[] = []): ReviewSample[] {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(fps) || fps <= 0) return [];
  const last = Math.max(0, (Math.ceil(duration * fps) - 1) / fps);
  const snap = (t: number) => Math.max(0, Math.min(last, Math.round(t * fps) / fps));
  const overview = Array.from({ length: 12 }, (_, i) => i === 11 ? last : snap(i * duration / 12));
  const rows: ReviewSample[] = Array.from({ length: 3 }, (_, i) => ({ times: overview.slice(i * 4, i * 4 + 4), caption: `Overview ${i + 1}/3, across the whole film` }));
  const beats = spread(directed.filter((m) => Number.isFinite(m.t) && Number.isFinite(m.end)).sort((a, b) => a.t - b.t), 6);
  const details = [
    ...beats.map((m) => ({ times: [m.t - 1 / fps, m.t + (m.end - m.t) / 3, m.t + 2 * (m.end - m.t) / 3, m.end + 1 / fps].map(snap), caption: `${m.scene}: ${m.why} (directed ${m.t.toFixed(3)}–${m.end.toFixed(3)} s)` })),
    ...spread(moments, 9 - beats.length).map((m) => ({ times: AROUND.map((o) => snap(m.t + o)), caption: `${m.scene}: ${m.why} (${m.t.toFixed(3)} s)` })),
  ];
  return [...rows, ...details].slice(0, 12);
}

/** a layer must cover this much of the frame to count as an entrance (a small mark is not one) */
const BIG = 0.05;
/** two moments closer than this are one */
const MERGE = 0.4;
const MOST = 12;
/** the frames of a strip, around its moment (s) */
const AROUND = [-0.3, -0.1, 0.1, 0.3];
const CELL = 320;
const PER_PICTURE = 3;
const PICTURES = 4;
/** what is not an illustration: the words of a talking video, its picture and its sound */
const NOT_ART = new Set(['text', 'captions', 'video', 'audio', 'sound']);

/**
 * The moments worth looking at, sorted: each cut between scenes (centred), the
 * first entrance in each scene of a layer that covers a twentieth of the frame,
 * every marker of kind `hero`, and in a talking video each illustration's
 * entrance and the middle of each coverage gap (`issues` are what the checks
 * gave). Merged when closer than 0.4 s and capped at 12, the cuts kept first.
 */
export function momentsOf(doc: TrammeDoc, compId: string, registry: Registry, issues: QualityIssue[] = [], placed?: Map<number, PlacedSample[]>): Moment[] {
  const comp = doc.compositions[compId];
  if (!comp) return [];
  const scenes = scenesOf(doc, compId), where = (t: number) => sceneAt(scenes, t)?.name ?? '';
  const found: (Moment & { rank: number })[] = [];
  scenes.slice(1).forEach((s, i) => found.push({ t: s.from, why: `cut from ${scenes[i].name} to ${s.name}`, scene: s.name, rank: 0 }));
  for (const m of comp.markers ?? []) if (m.kind === 'hero') found.push({ t: m.t, why: `hero: ${m.label || m.id}`, scene: where(m.t), rank: 1 });
  for (const i of issues) if (i.check === 'coverage') found.push({ t: +((i.t ?? 0) + (i.rank ?? 0) / 2).toFixed(2), why: `the speaker alone for ${Math.round(i.rank ?? 0)} s`, scene: where((i.t ?? 0) + (i.rank ?? 0) / 2), rank: 2 });

  const ev = placed ? null : editorEvaluator(doc, registry), area = comp.width * comp.height;
  /** whether the layer, a moment after it enters, covers enough of the frame (found in the root's placed layers by its id, nested ones by the end of theirs) */
  const big = (layerId: string, at: number) => {
    const time = Math.min(Math.max(0, at), comp.duration - 0.01);
    const layers = placed ? placed.get(time) : sampleAt(ev!, compId, time).layers;
    if (!layers) throw new Error('missing isolated entrance sample');
    return layers.some((p) => (p.id === layerId || p.id.endsWith(`/${layerId}`)) && p.opacity > 0.3 && p.box && (p.box.w * p.box.h) / area >= BIG);
  };
  const talking = Object.values(comp.layers).some((l) => l.type === 'video' && (l.out ?? comp.duration) - (l.in ?? 0) >= comp.duration * 0.6);
  if (talking) {
    for (const [id, l] of Object.entries(comp.layers)) {
      const at = l.in ?? 0;
      if (NOT_ART.has(l.type) || l.visible === false || at <= 0.05 || !big(id, at + 0.4)) continue;
      found.push({ t: at, why: `${l.name ?? id} enters`, scene: where(at), rank: 3 });
    }
  } else {
    for (const s of scenes) {
      const inner = s.comp ? doc.compositions[s.comp] : comp;
      const layers = Object.entries(inner.layers)
        .filter(([, l]) => l.visible !== false && !(s.comp === undefined && l.type === 'comp'))
        .map(([id, l]) => ({ id, l, at: filmTime(doc, compId, s, l.in ?? 0) }))
        .filter((x): x is { id: string; l: typeof x.l; at: number } => x.at !== null && x.at >= s.from - 1e-6 && x.at < s.to)
        .sort((a, b) => a.at - b.at);
      const first = layers.find(({ id, at }) => big(id, at + 0.4));
      if (first) found.push({ t: +first.at.toFixed(2), why: `${first.l.name ?? first.id} enters`, scene: s.name, rank: 3 });
    }
  }

  // the more important kept first when two are near, then the first MOST by importance and the rest spread
  const kept: typeof found = [];
  for (const m of [...found].sort((a, b) => a.rank - b.rank || a.t - b.t)) if (!kept.some((k) => Math.abs(k.t - m.t) < MERGE)) kept.push(m);
  const cuts = kept.filter((m) => m.rank === 0).sort((a, b) => a.t - b.t);
  const others = kept.filter((m) => m.rank !== 0).sort((a, b) => a.t - b.t);
  const out = kept.length > MOST ? [...spread(cuts, MOST), ...spread(others, MOST - Math.min(cuts.length, MOST))] : kept;
  return out.sort((a, b) => a.t - b.t).map(({ t, why, scene }) => ({ t, why, scene }));
}

/** Gather every possible entrance size in the project worker before choosing review moments. */
export async function momentsForEvidence(ctx: ToolContext, compId: string, issues: QualityIssue[] = []): Promise<Moment[]> {
  if (!sandboxedDoc(ctx.doc) && !prefs.peek().sandboxPreview) return momentsOf(ctx.doc, compId, ctx.registry, issues);
  const comp = ctx.doc.compositions[compId];
  if (!comp) return [];
  const scenes = scenesOf(ctx.doc, compId);
  const candidates = [
    ...Object.values(comp.layers).map((l) => (l.in ?? 0) + 0.4),
    ...scenes.flatMap((s) => Object.values((s.comp ? ctx.doc.compositions[s.comp] : comp)?.layers ?? {})
      .map((l) => filmTime(ctx.doc, compId, s, l.in ?? 0))
      .filter((at): at is number => at !== null)
      .map((at) => at + 0.4)),
  ];
  const times = [...new Set(candidates.map((at) => Math.min(Math.max(0, at), comp.duration - 0.01)))];
  const samples = await samplePlacedTimes(ctx, compId, times);
  return momentsOf(ctx.doc, compId, ctx.registry, issues, new Map(times.map((at, i) => [at, samples[i]])));
}

/** the format, the length, the scenes with their times and kinds, and how much sound there is */
export function factsOf(doc: TrammeDoc, compId: string, plan: FilmPlan | null): string {
  const c = doc.compositions[compId];
  const scenes = scenesOf(doc, compId).map((s) => {
    const kind = plan?.scenes.find((p) => p.name.toLowerCase() === s.name.toLowerCase())?.kind;
    return `${s.name} ${s.from.toFixed(1)}-${s.to.toFixed(1)} s${kind ? ` (${kind})` : ''}`;
  });
  const sounds = Object.values(doc.compositions).reduce((n, comp) => n + Object.values(comp.layers).filter((l) => l.type === 'audio' && l.visible !== false).length, 0);
  return `Format ${c.width} x ${c.height} px, ${c.fps} fps, ${+c.duration.toFixed(1)} s. Scenes: ${scenes.join('; ')}. ${sounds} sound layer${sounds === 1 ? '' : 's'}.`;
}

/** the strips put three to a picture, four pictures at most (what goes beyond is left out) */
export function stripPictures<T>(strips: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < strips.length && out.length < PICTURES; i += PER_PICTURE) out.push(strips.slice(i, i + PER_PICTURE));
  return out;
}

/** a file of the project as a data URL; null when it cannot be read */
async function dataUrl(ctx: ToolContext, path: string): Promise<string | null> {
  try {
    const blob = await (await fetch(ctx.fileUrl(path))).blob();
    return await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsDataURL(blob); });
  } catch { return null; }
}

export interface Evidence {
  strips: { url: string; caption: string }[];
  target: string | null;
  plan: string | null;
  facts: string;
  moments: Moment[];
  /** what the checks gave, so the measured definition of done reads the same issues */
  issues: QualityIssue[];
}

/** the evidence of a film (its checks, when they were run already are passed): its checks, its moments, a strip around each, the style frame it was made towards, the plan and the facts */
export async function gather(ctx: ToolContext, compId: string, checked?: QualityIssue[]): Promise<Evidence> {
  const doc = ctx.doc, comp = doc.compositions[compId];
  const plan = parsePlan(await ctx.readText(FILM_PLAN_PATH).catch(() => null));
  const issues = checked ?? await qualityChecksOf(ctx, compId, await analyses(ctx));
  const moments = await momentsForEvidence(ctx, compId, issues);
  const directed = directedMoments(doc, compId, plan);
  const samples = reviewSamples(comp.duration, comp.fps, moments, directed);
  const times = samples.map((s) => s.times);
  const images = await stills(ctx, times.flat(), compId);
  const h = Math.round((CELL * comp.height) / comp.width);
  const strips = stripPictures(samples.map((_, i) => i)).map((group) => ({
    url: sheetOf(group.flatMap((i) => times[i].map((t, k) => ({ image: images[i * AROUND.length + k], label: `f${Math.round(t * comp.fps)} / ${t.toFixed(3)} s` }))), CELL, h, AROUND.length),
    caption: `Rows ${group.map((i) => `${i + 1}. ${samples[i].caption}; frames ${times[i].map((t) => Math.round(t * comp.fps)).join(', ')}`).join('; ')}`,
  }));
  const target = plan?.target ? await dataUrl(ctx, plan.target) : null;
  const choreography = plan?.scenes.filter((s) => s.motion?.length).map((s) => `${s.name} (scene-local seconds):\n${motionText(s)}`).join('\n');
  return { strips, target, plan: plan ? `${planText(plan)}${choreography ? `\nTimed direction:\n${choreography}` : ''}` : null, facts: factsOf(doc, compId, plan), moments, issues };
}
