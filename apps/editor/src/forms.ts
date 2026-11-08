// The form each scene is built in, read from what its composition is made of
// (a heuristic, not a judgement): the check says when scenes as built repeat
// one form, and when a scene is built in another kind than the film plan gave
// it. The kinds are the film plan's (filmplan.ts).

import { sampleAt, type Registry, type ToolContext, type TrammeDoc } from '@tramme/core';
import { editorEvaluator } from './evaluator.ts';
import { sandboxedDoc } from './installed.ts';
import { samplePlacedTimes } from './isolated-placed.ts';
import { prefs } from './settings.ts';
import type { PlacedSample } from './plugins/protocol.ts';
import { builtinRegistry } from '@tramme/nodes';
import { planIssues, type FilmPlan, type PictureKind, type PlanScene } from './filmplan.ts';
import { scenesOf, type Scene } from './scenes.ts';
import { slug } from './model.ts';

export interface Form { kind: PictureKind | null; why: string }

/** the height of the largest text, as a share of the frame's, from which a scene reads as type */
const TYPE_SHARE = 0.08;
/** the share of the frame a picture covers, from which it is a photo and not an object */
const PHOTO_SHARE = 0.5;

const NONE: Form = { kind: null, why: '' };
const kindOfType = (type: string): PictureKind | null =>
  type.startsWith('ui.') ? 'interface' : type.startsWith('chart.') || type === 'text.counter' ? 'data' : type.startsWith('diagram.') ? 'diagram'
    : type === 'model.3d' || type === 'solid.3d' ? '3d' : type.startsWith('map.') ? 'map' : null;

/** the share of the frame a placed layer covers (a layer with no bounds counts for a twentieth) */
function share(p: Pick<PlacedSample, 'box'>, w: number, h: number): number {
  if (!p.box) return 0.05;
  const x = Math.max(0, Math.min(w, p.box.x + p.box.w) - Math.max(0, p.box.x)), y = Math.max(0, Math.min(h, p.box.y + p.box.h) - Math.max(0, p.box.y));
  return (x * y) / (w * h);
}

/** the kind a composition is built in, and why: its largest kind by area on screen at `at` (the middle by default) */
export function formOf(doc: TrammeDoc, compId: string, opts: { registry?: Registry; at?: number } = {}): Form {
  const comp = doc.compositions[compId];
  if (!comp) return NONE;
  let sample;
  try { sample = sampleAt(editorEvaluator(doc, opts.registry ?? builtinRegistry()), compId, Math.min(opts.at ?? comp.duration / 2, Math.max(0, comp.duration - 1e-3))); } catch { return NONE; }
  return formOfPlaced(doc, compId, sample.layers.map((p) => ({ id: p.id, name: p.layer.name ?? p.id, type: p.layer.type, box: p.box,
    opacity: p.opacity, textSize: p.textSize, hasText: !!p.text?.trim() })));
}

/** Classify a scene from plain placed values, including worker samples. */
export function formOfPlaced(doc: TrammeDoc, compId: string, layers: PlacedSample[]): Form {
  const comp = doc.compositions[compId];
  if (!comp) return NONE;
  const area = new Map<PictureKind, { area: number; why: Set<string> }>();
  const add = (kind: PictureKind, a: number, why: string) => {
    const e = area.get(kind) ?? { area: 0, why: new Set<string>() };
    e.area += a; e.why.add(why);
    area.set(kind, e);
  };
  let biggestText = 0, textArea = 0;
  for (const p of layers) {
    if (p.opacity < 0.05) continue;
    const type = p.type, a = share(p, comp.width, comp.height), kind = kindOfType(type);
    if (kind) add(kind, a, type);
    else if (type === 'image' || type === 'video') add(a >= PHOTO_SHARE ? 'photo' : 'object', a, `${type} over ${Math.round(a * 100)} % of the frame`);
    else if (type === 'text' && p.hasText) { biggestText = Math.max(biggestText, (p.textSize ?? 0) / comp.height); textArea += a; }
  }
  if (biggestText >= TYPE_SHARE) add('type', textArea, `text ${Math.round(biggestText * 100)} % of the frame's height`);
  const [best] = [...area].sort((x, y) => y[1].area - x[1].area);
  return best ? { kind: best[0], why: [...best[1].why].join(', ') } : NONE;
}

const quoted = (names: string[]) => names.map((n) => `"${n}"`).join(', ').replace(/, ([^,]*)$/, ' and $1');

/** whether a built scene is the planned one: by its id, its slug or its name */
export const planMatches = (p: PlanScene, s: Scene) => p.id === s.id || p.id === slug(s.name) || p.name.toLowerCase() === s.name.toLowerCase();

/** the lines the check adds about the forms of the scenes: the repeats, the scenes built off their plan, the plan's own variety */
export function formLines(doc: TrammeDoc, compId: string, plan: FilmPlan | null, registry?: Registry): string[] {
  const scenes = scenesOf(doc, compId);
  if (scenes.length < 2) return [];
  const forms = scenes.map((s) => (s.comp ? formOf(doc, s.comp, { registry }) : formOf(doc, compId, { registry, at: (s.from + s.to) / 2 })));
  return linesForForms(scenes, forms, plan);
}

/** The check's scene-form lines, using isolated placement when enabled. */
export async function formLinesForReview(ctx: ToolContext, plan: FilmPlan | null): Promise<string[]> {
  if (!sandboxedDoc(ctx.doc) && !prefs.peek().sandboxPreview) return formLines(ctx.doc, ctx.compId, plan, ctx.registry);
  const scenes = scenesOf(ctx.doc, ctx.compId);
  if (scenes.length < 2) return [];
  if (scenes.length > 512) throw new Error('too many isolated scene forms');
  const specs = scenes.map((s) => {
    const id = s.comp ?? ctx.compId, comp = ctx.doc.compositions[id];
    return { id, at: Math.min(s.comp ? comp.duration / 2 : (s.from + s.to) / 2, Math.max(0, comp.duration - 1e-3)) };
  });
  const forms: Form[] = Array(scenes.length);
  for (const id of new Set(specs.map((s) => s.id))) {
    const positions = specs.map((s, i) => s.id === id ? i : -1).filter((i) => i >= 0);
    const samples = await samplePlacedTimes(ctx, id, positions.map((i) => specs[i].at));
    positions.forEach((i, j) => { forms[i] = formOfPlaced(ctx.doc, id, samples[j]); });
  }
  return linesForForms(scenes, forms, plan);
}

function linesForForms(scenes: Scene[], forms: Form[], plan: FilmPlan | null): string[] {
  const out: string[] = [];
  for (let i = 0; i < scenes.length;) {
    let j = i + 1;
    while (j < scenes.length && forms[i].kind && forms[j].kind === forms[i].kind) j++;
    if (j - i >= 2) out.push(`${quoted(scenes.slice(i, j).map((s) => s.name))} are all built as ${forms[i].kind} (${forms[i].why}), one after another: change the kind of some of them, not the colours (see the film plan, assets/film-plan.json).`);
    i = j;
  }
  if (plan) {
    scenes.forEach((s, i) => {
      const planned = plan.scenes.find((p) => planMatches(p, s));
      if (planned && forms[i].kind && planned.kind !== forms[i].kind) out.push(`"${s.name}" is planned as ${planned.kind} but built as ${forms[i].kind} (${forms[i].why}): rebuild it in its kind, or change the plan.`);
    });
    out.push(...planIssues(plan).map((l) => `Film plan: ${l}`));
  }
  return out;
}
