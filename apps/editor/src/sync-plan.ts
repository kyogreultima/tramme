// The plan that lines clips up by their sound: the sound each clip plays is
// compared with the first one's (syncOffset, in @tramme/core), the others move
// to where it agrees. No state of the editor here: the timeline's menu
// (sync.ts) and the assistant's tool (montage-tools.ts) both use it.

import { linkedIds, shiftLayerOps, staticValue, syncDelta, syncOffset, type Op, type TrammeDoc } from '@tramme/core';
import { decodeMono, RATE } from './perception.ts';

/** how much of each clip's sound is compared, s */
const SPAN = 120;
/** under this the two sounds are not taken for the same (0 to 1) */
const SURE = 0.35;
/** how far a clip may have to move, s */
const REACH = 30;

/** what the plan could not do: the clips given are too few, one has no sound, two share none */
export type SyncNote = { kind: 'few' } | { kind: 'nosound'; clip: string } | { kind: 'nomatch'; a: string; b: string };

/** the sound a clip plays: from where it starts in its file, as long as the clip (at most SPAN) */
async function soundOf(doc: TrammeDoc, compId: string, id: string, urlOf: (asset: string) => string, signal: AbortSignal): Promise<{ at: number; samples: Float32Array } | null> {
  const c = doc.compositions[compId], l = c.layers[id];
  const asset = staticValue(l?.type === 'audio' ? l.props?.audio : l?.props?.video);
  if (!l || typeof asset !== 'string' || !doc.assets[asset]) return null;
  const start = Math.max(0, Number(staticValue(l.props?.start) ?? 0) || 0), length = Math.min(SPAN, (l.out ?? c.duration) - (l.in ?? 0));
  const all = await decodeMono(urlOf(asset), signal, start + length);
  return { at: l.in ?? 0, samples: all.subarray(Math.round(start * RATE), Math.round((start + length) * RATE)) };
}

/** the operations that line the other clips up with the first one by their sound (those that play at normal speed), and what could not be done */
export async function syncPlan(doc: TrammeDoc, compId: string, ids: string[], urlOf: (asset: string) => string, signal: AbortSignal = new AbortController().signal): Promise<{ ops: Op[]; notes: SyncNote[] }> {
  const c = doc.compositions[compId], notes: SyncNote[] = [];
  const clips = ids.filter((id) => (c.layers[id]?.type === 'video' || c.layers[id]?.type === 'audio') && Number(staticValue(c.layers[id].props?.rate) ?? 1) === 1);
  if (clips.length < 2) return { ops: [], notes: [{ kind: 'few' }] };
  const [first, ...rest] = clips, base = await soundOf(doc, compId, first, urlOf, signal).catch(() => null);
  if (!base) return { ops: [], notes: [{ kind: 'nosound', clip: first }] };
  const ops: Op[] = [], moved = new Set<string>(linkedIds(c, first));
  for (const id of rest) {
    if (moved.has(id)) continue;
    const other = await soundOf(doc, compId, id, urlOf, signal).catch(() => null), r = other ? syncOffset(base.samples, other.samples, RATE, REACH) : null;
    if (!other || !r || r.confidence < SURE) { notes.push({ kind: 'nomatch', a: first, b: id }); continue; }
    const dt = Math.round(syncDelta({ in: base.at }, { in: other.at }, r.offset) * c.fps) / c.fps;
    for (const m of linkedIds(c, id)) { if (!moved.has(m)) { ops.push(...shiftLayerOps(doc, compId, m, dt)); moved.add(m); } }
  }
  return { ops, notes };
}
