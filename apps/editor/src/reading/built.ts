// The user's film as the checks against a reading see it: for each scene of
// the plan that follows a scene of the reading, where it plays in the root,
// where each slot landed (the layer showing its asset, the text of its role,
// the shape nearest its place), the kinds of move its layers make and the
// transition it comes by. Read from the document, never rendered.

import { sampleAt, staticValue, type BuiltScene, type Composition, type Layer, type MoveKind, type PlacedLayer, type Reading, type Registry, type Slot, type Transition, type TrammeDoc } from '@tramme/core';
import { editorEvaluator } from '../evaluator.ts';
import type { FilmPlan } from '../filmplan.ts';
import { transitionOf } from '../transitions.ts';

/** a property that changes over time: keyframes holding more than one value */
const moving = (p: unknown) => !!p && typeof p === 'object' && Array.isArray((p as { $k?: unknown }).$k) && new Set((p as { $k: { v: unknown }[] }).$k.map((k) => JSON.stringify(k.v))).size > 1;
const driven = (p: unknown) => !!p && typeof p === 'object' && (Array.isArray((p as { $mod?: unknown }).$mod) || typeof (p as { $expr?: unknown }).$expr === 'string');

/** the kinds of move a composition's layers make, its camera included */
export function movesIn(comp: Composition): MoveKind[] {
  const out = new Set<MoveKind>();
  if (moving(comp.camera?.zoom) || driven(comp.camera?.zoom)) out.add('push-in');
  if (moving(comp.camera?.pan) || driven(comp.camera?.pan)) out.add('pan');
  for (const l of Object.values(comp.layers) as Layer[]) {
    const tr = (l.transform ?? {}) as Record<string, unknown>;
    if (moving(tr.scale) || driven(tr.scale)) out.add(l.children?.length || l.type === 'comp' ? 'push-in' : 'scale');
    if (moving(tr.position) || driven(tr.position)) out.add('slide');
    if (moving(tr.rotation) || moving(tr.rotationX) || moving(tr.rotationY)) out.add('rotate');
    if ((l.masks ?? []).some((m) => Object.values(m as unknown as Record<string, unknown>).some(moving)) || (l.clip && moving((comp.layers[l.clip]?.transform as Record<string, unknown> | undefined)?.position))) out.add('mask-reveal');
    if (l.type === 'text' && Object.entries(l.props ?? {}).some(([k, v]) => k !== 'text' && moving(v))) out.add('type-on');
    for (const st of l.styles ?? []) {
      const n = JSON.stringify(st).toLowerCase();
      if (/push|zoom/.test(n)) out.add('push-in');
      if (/rise|slide|drift|pan/.test(n)) out.add('slide');
      if (/type|reveal|word/.test(n)) out.add('type-on');
    }
  }
  return [...out];
}

const TRANSITION_OF: Record<string, Transition> = { crossfade: 'dissolve', dip: 'fade', push: 'push', slide: 'push', zoom: 'zoom', whip: 'whip', luma: 'wipe', glitch: 'cut' };

/** where a scene's composition plays in the root, and the transition it comes by */
function placeOf(doc: TrammeDoc, comp: string): { start: number; end: number; transition: Transition } | null {
  const root = doc.compositions[doc.root];
  for (const l of Object.values(root.layers)) {
    if (l.type !== 'comp' || staticValue(l.props?.comp) !== comp) continue;
    const start = l.in ?? 0, end = l.out ?? Math.min(root.duration, start + (doc.compositions[comp]?.duration ?? root.duration));
    const kind = staticValue(transitionOf(l)?.props?.kind);
    return { start, end, transition: typeof kind === 'string' ? TRANSITION_OF[kind] ?? 'cut' : 'cut' };
  }
  return null;
}

const ASSET_ROLES = new Set<Slot['role']>(['logo', 'screenshot', 'photo', 'video', 'product', 'person']);
const centre = (b: { x: number; y: number; w: number; h: number }) => [b.x + b.w / 2, b.y + b.h / 2];

/** the layer of a frame that fills a slot, or null: by its asset, by its role, by its place */
function layerFor(slot: Slot, frame: PlacedLayer[], w: number, h: number, taken: Set<string>): PlacedLayer | null {
  const seen = frame.filter((p) => p.box && p.opacity > 0.05 && !taken.has(p.id));
  const near = (ps: PlacedLayer[]) => {
    const [sx, sy] = [(slot.box[0] + slot.box[2] / 2) * w, (slot.box[1] + slot.box[3] / 2) * h];
    return ps.sort((a, b) => Math.hypot(centre(a.box!)[0] - sx, centre(a.box!)[1] - sy) - Math.hypot(centre(b.box!)[0] - sx, centre(b.box!)[1] - sy))[0] ?? null;
  };
  if (slot.asset) {
    const showing = seen.filter((p) => Object.values(p.props).includes(slot.asset));
    return showing.sort((a, b) => b.box!.w * b.box!.h - a.box!.w * a.box!.h)[0] ?? null;
  }
  const texts = seen.filter((p) => p.text?.trim());
  if (slot.role === 'headline') return texts.sort((a, b) => (b.textSize ?? 0) - (a.textSize ?? 0))[0] ?? null;
  if (slot.role === 'text') return near(texts);
  const pictures = seen.filter((p) => p.node.type === 'image' || p.node.type === 'video');
  if (ASSET_ROLES.has(slot.role)) return near(pictures);
  // a figure or a shape: what is drawn and is no ground (it leaves some of the frame)
  return near(seen.filter((p) => !p.text && p.box!.w * p.box!.h < w * h * 0.9 && p.node.type !== 'group' && p.node.type !== 'comp'));
}

/** the scenes of the user's film that follow the reading, as the checks see them */
export function builtScenes(doc: TrammeDoc, registry: Registry, plan: FilmPlan, reading: Reading): BuiltScene[] {
  const evaluator = editorEvaluator(doc, registry);
  const out: BuiltScene[] = [];
  let at = 0;
  for (const scene of plan.scenes) {
    const length = scene.seconds ?? doc.compositions[scene.comp ?? '']?.duration ?? 0;
    const placed = scene.comp ? placeOf(doc, scene.comp) : null;
    const start = placed?.start ?? at, end = placed?.end ?? at + length;
    at = end;
    if (!scene.follows) continue;
    const of = reading.scenes.find((s) => s.id === scene.follows);
    const compId = scene.comp && doc.compositions[scene.comp] ? scene.comp : doc.root, comp = doc.compositions[compId];
    // a scene in a composition of its own is read at its own time; one in the root at the root's
    const offset = compId === doc.root ? start : 0;
    const slots: BuiltScene['slots'] = {};
    const taken = new Set<string>();
    for (const slot of of?.slots ?? []) {
      const t = Math.min(offset + Math.min(slot.at + 0.6, end - start - 0.05), comp.duration - 0.01);
      let frame: PlacedLayer[] = [];
      try { frame = sampleAt(evaluator, compId, Math.max(0, t)).layers; } catch { frame = []; }
      const p = layerFor(slot, frame, comp.width, comp.height, taken);
      if (p) taken.add(p.id);
      slots[slot.id] = p?.box ? [p.box.x / comp.width, p.box.y / comp.height, p.box.w / comp.width, p.box.h / comp.height].map((v) => +Math.max(0, Math.min(1, v)).toFixed(3)) as Slot['box'] : null;
    }
    out.push({ follows: scene.follows, start: +start.toFixed(3), end: +end.toFixed(3), slots, moves: compId === doc.root ? [] : movesIn(comp), ...(placed ? { transition: placed.transition } : {}) });
  }
  return out;
}

/** the texts the film shows, in every composition */
export function filmTexts(doc: TrammeDoc): string[] {
  return Object.values(doc.compositions).flatMap((c) => Object.values(c.layers)).filter((l) => l.type === 'text' || l.type === 'captions').map((l) => staticValue(l.props?.text)).filter((x): x is string => typeof x === 'string' && !!x.trim());
}
