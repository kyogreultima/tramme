// A mask that follows a tracked object (docs/editing-roadmap.md, step 5): its
// path keeps the shape drawn and moves with the object, by an expression that
// reads the track now and at the moment the mask was drawn (`track()` with a
// time). Where the object is lost, the mask stays where it was drawn.

import { pointer, propKind, staticValue, type KeyframedProp, type Op, type Prop, type TrammeDoc } from '@tramme/core';

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** the expression that moves a path by the tracked object's move since `at`, in the layer's space (divided by its scale) */
export function followExpr(video: string, track: string, at: number, scale: [number, number] = [1, 1]): string {
  const q = (s: string) => JSON.stringify(s);
  return `const r = track(${q(video)}, ${q(track)}), r0 = track(${q(video)}, ${q(track)}, ${r4(at)});
if (!r.found || !r0.found) return value;
const dx = (r.center[0] - r0.center[0]) / ${r4(scale[0]) || 1}, dy = (r.center[1] - r0.center[1]) / ${r4(scale[1]) || 1};
return { ...value, v: value.v.map((p) => [p[0] + dx, p[1] + dy]) };`;
}

/** the tracks a composition's video layers can be followed by: [video layer, track asset id, its name] */
export function tracksOf(doc: TrammeDoc, compId: string): [string, string, string][] {
  const c = doc.compositions[compId], out: [string, string, string][] = [];
  for (const [lid, l] of Object.entries(c?.layers ?? {})) {
    if (l.type !== 'video') continue;
    const asset = String(staticValue(l.props?.video) ?? '');
    for (const [aid, a] of Object.entries(doc.assets)) if (asset && aid.startsWith(`track-${asset}-`)) out.push([lid, aid, a.name?.replace(/^Track · /, '') ?? aid]);
  }
  return out;
}

/** the mask's path made to follow a track from time `at`: the shape it has (its keyframes kept) moved by the expression */
export function followTrackOps(doc: TrammeDoc, compId: string, layerId: string, maskId: string, video: string, track: string, at: number): Op[] {
  const l = doc.compositions[compId].layers[layerId];
  const i = (l.masks ?? []).findIndex((m) => m.id === maskId);
  if (i < 0) return [];
  const raw = l.masks![i].props?.path as Prop | undefined;
  const scale = staticValue(l.transform?.scale) as [number, number] | undefined;
  const expr = followExpr(video, track, at, Array.isArray(scale) ? scale : [1, 1]);
  // keyframes keep theirs; a drawn shape becomes one key, the base the expression moves
  const base: KeyframedProp = raw !== undefined && propKind(raw) === 'keyframes'
    ? { ...(raw as KeyframedProp) }
    : { $k: [{ t: r4(at), v: raw !== undefined && propKind(raw) === 'static' ? staticValue(raw) : { v: [[-200, -150], [200, -150], [200, 150], [-200, 150]], closed: true } }] };
  return [{ op: 'add', path: pointer('compositions', compId, 'layers', layerId, 'masks', i, 'props', 'path'), value: { ...base, $expr: expr } }];
}
