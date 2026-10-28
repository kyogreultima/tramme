// Clips lined up by their sound: two cameras on one scene, a camera and a
// separate recorder. The sound each clip plays is compared with the first
// one's (syncOffset, in @tramme/core), and the others move to where it
// agrees.

import { linkedIds, shiftLayerOps, staticValue, syncDelta, syncOffset, type Op } from '@tramme/core';
import { commit, S, toast } from './state.ts';
import { decodeMono, RATE } from './perception.ts';
import { t } from './i18n/index.ts';

/** how much of each clip's sound is compared, s */
const SPAN = 120;
/** under this the two sounds are not taken for the same (0 to 1) */
const SURE = 0.35;
/** how far a clip may have to move, s */
const REACH = 30;

/** the sound a clip plays: from where it starts in its file, as long as the clip (at most SPAN) */
async function soundOf(id: string): Promise<{ at: number; samples: Float32Array } | null> {
  const doc = S.doc.peek(), c = doc.compositions[S.compId.peek()], l = c.layers[id];
  const asset = staticValue(l?.type === 'audio' ? l.props?.audio : l?.props?.video);
  if (!l || typeof asset !== 'string' || !doc.assets[asset]) return null;
  const start = Math.max(0, Number(staticValue(l.props?.start) ?? 0) || 0), length = Math.min(SPAN, (l.out ?? c.duration) - (l.in ?? 0));
  const url = new URL(doc.assets[asset].src, new URL(S.docUrl.peek(), location.href)).href;
  const all = await decodeMono(url, new AbortController().signal, start + length);
  return { at: l.in ?? 0, samples: all.subarray(Math.round(start * RATE), Math.round((start + length) * RATE)) };
}

/** the other clips of the selection moved so that their sound agrees with the first one's; says what it could not do */
export async function syncClips(ids: string[]): Promise<boolean> {
  const c = S.doc.peek().compositions[S.compId.peek()];
  const clips = ids.filter((id) => (c.layers[id]?.type === 'video' || c.layers[id]?.type === 'audio') && Number(staticValue(c.layers[id].props?.rate) ?? 1) === 1);
  if (clips.length < 2) { toast(t('timeline.syncNeedsTwo'), 'error'); return false; }
  toast(t('timeline.syncing'), 'info', 1500);
  const [first, ...rest] = clips, base = await soundOf(first).catch(() => null);
  if (!base) { toast(t('timeline.syncNoSound', { name: first }), 'error'); return false; }
  const ops: Op[] = [], moved = new Set<string>(linkedIds(c, first));
  for (const id of rest) {
    if (moved.has(id)) continue;
    const other = await soundOf(id).catch(() => null), r = other ? syncOffset(base.samples, other.samples, RATE, REACH) : null;
    if (!other || !r || r.confidence < SURE) { toast(t('timeline.syncNoMatch', { a: first, b: id }), 'error'); continue; }
    const dt = Math.round(syncDelta({ in: base.at }, { in: other.at }, r.offset) * c.fps) / c.fps;
    for (const m of linkedIds(c, id)) { if (!moved.has(m)) { ops.push(...shiftLayerOps(S.doc.peek(), S.compId.peek(), m, dt)); moved.add(m); } }
  }
  return ops.length > 0 && commit(t('timeline.syncBySound'), ops);
}
