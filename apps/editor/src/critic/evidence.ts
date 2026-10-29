// What the critic is shown: the film in motion around its cuts and entrances
// (strips of four frames over 0.6 s), the style frame it was made towards, the
// plan, and a few facts. The critic never sees the film being made: this is all
// it has, so it is chosen to show what a review of motion asks for.

import { Evaluator, runChecks, sampleAt, type QualityIssue, type Registry, type ToolContext, type TrammeDoc } from '@tramme/core';
import { analyses } from '../perception.ts';
import { sheetOf, stills } from '../review.ts';
import { scenesOf, sceneAt } from '../scenes.ts';
import { FILM_PLAN_PATH, parsePlan, planText, type FilmPlan } from '../filmplan.ts';

export interface Moment { t: number; why: string; scene: string }

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
export function momentsOf(doc: TrammeDoc, compId: string, registry: Registry, issues: QualityIssue[] = []): Moment[] {
  const comp = doc.compositions[compId];
  if (!comp) return [];
  const scenes = scenesOf(doc, compId), where = (t: number) => sceneAt(scenes, t)?.name ?? '';
  const found: (Moment & { rank: number })[] = [];
  scenes.slice(1).forEach((s, i) => found.push({ t: s.from, why: `cut from ${scenes[i].name} to ${s.name}`, scene: s.name, rank: 0 }));
  for (const m of comp.markers ?? []) if (m.kind === 'hero') found.push({ t: m.t, why: `hero: ${m.label || m.id}`, scene: where(m.t), rank: 1 });
  for (const i of issues) if (i.check === 'coverage') found.push({ t: +((i.t ?? 0) + (i.rank ?? 0) / 2).toFixed(2), why: `the speaker alone for ${Math.round(i.rank ?? 0)} s`, scene: where((i.t ?? 0) + (i.rank ?? 0) / 2), rank: 2 });

  const ev = new Evaluator(doc, registry), area = comp.width * comp.height;
  /** whether the layer, a moment after it enters, covers enough of the frame (found in the root's placed layers by its id, nested ones by the end of theirs) */
  const big = (layerId: string, at: number) => {
    const sample = sampleAt(ev, compId, Math.min(Math.max(0, at), comp.duration - 0.01));
    return sample.layers.some((p) => (p.id === layerId || p.id.endsWith(`/${layerId}`)) && p.opacity > 0.3 && p.box && (p.box.w * p.box.h) / area >= BIG);
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
        .map(([id, l]) => ({ id, l, at: s.comp ? s.from + (l.in ?? 0) : l.in ?? 0 }))
        .filter(({ at }) => at >= s.from - 1e-6 && at < s.to)
        .sort((a, b) => a.at - b.at);
      const first = layers.find(({ id, at }) => big(id, at + 0.4));
      if (first) found.push({ t: +first.at.toFixed(2), why: `${first.l.name ?? first.id} enters`, scene: s.name, rank: 3 });
    }
  }

  // the more important kept first when two are near, then the first MOST by importance and the rest spread
  const kept: typeof found = [];
  for (const m of [...found].sort((a, b) => a.rank - b.rank || a.t - b.t)) if (!kept.some((k) => Math.abs(k.t - m.t) < MERGE)) kept.push(m);
  const out = kept.length > MOST ? [...kept.filter((m) => m.rank === 0), ...kept.filter((m) => m.rank !== 0).sort((a, b) => a.rank - b.rank || a.t - b.t)].slice(0, MOST) : kept;
  return out.sort((a, b) => a.t - b.t).map(({ t, why, scene }) => ({ t, why, scene }));
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
  const issues = checked ?? await runChecks(doc, ctx.registry, compId, { data: await analyses(ctx) });
  const moments = momentsOf(doc, compId, ctx.registry, issues);
  const shown = moments.slice(0, PER_PICTURE * PICTURES);
  const times = shown.map((m) => AROUND.map((o) => +Math.min(Math.max(0, m.t + o), Math.max(0, comp.duration - 0.01)).toFixed(3)));
  const images = await stills(ctx, times.flat(), compId);
  const h = Math.round((CELL * comp.height) / comp.width);
  const strips = stripPictures(shown.map((_, i) => i)).map((group) => ({
    url: sheetOf(group.flatMap((i) => times[i].map((t, k) => ({ image: images[i * AROUND.length + k], label: `${t.toFixed(2)} s` }))), CELL, h, AROUND.length),
    caption: `Strips ${group.map((i) => `${i + 1}. ${shown[i].why} (${shown[i].t.toFixed(1)} s)`).join('; ')}`,
  }));
  const target = plan?.target ? await dataUrl(ctx, plan.target) : null;
  return { strips, target, plan: plan ? planText(plan) : null, facts: factsOf(doc, compId, plan), moments: shown, issues };
}
