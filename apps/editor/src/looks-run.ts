// Matching the look of clips to one of them: each picture is read (a frame
// of the video where the playhead is, or the middle of the clip), its colours
// measured, and the others get wheels that bring them to the first one's.
// The plan is one function (the timeline's menu and the assistant's tool use
// it); `matchLooks` is the menu's action.

import { lookStatsOf, matchGrade, staticValue, type Layer, type LookStats, type Op, type TrammeDoc, type VideoAsset } from '@tramme/core';
import { commit, S, toast } from './state.ts';
import { assetData } from './preview.ts';
import { matchLookOps } from './looks.ts';
import { t } from './i18n/index.ts';

const SIZE = 64;

/** the colours of a clip's picture at `at` (composition time); null when it cannot be read (no picture, a file not loaded) */
async function statsOf(l: Layer, at: number): Promise<LookStats | null> {
  const asset = staticValue(l.type === 'video' ? l.props?.video : l.props?.image);
  const src = typeof asset === 'string' ? assetData(asset) : undefined;
  if (!src) return null;
  let image: CanvasImageSource | null = null;
  if (l.type === 'video') {
    const v = src as VideoAsset, rate = Number(staticValue(l.props?.rate)) || 1;
    const t = Math.max(0, Number(staticValue(l.props?.start) ?? 0) + (at - (l.in ?? 0)) * rate);
    await v.request(t);
    image = v.frameAt(t).image;
  } else image = src as ImageBitmap;
  if (!image) return null;
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(image, 0, 0, SIZE, SIZE);
  return lookStatsOf(g.getImageData(0, 0, SIZE, SIZE).data);
}

/** what the plan could not do: too few clips, a picture that cannot be read yet */
export type LookNote = { kind: 'few' } | { kind: 'nopicture'; clip: string };

/** the wheels that bring the other clips' look to the first one's, as operations; the picture of a clip is read where the playhead is when it plays there, else in its middle */
export async function lookPlan(doc: TrammeDoc, compId: string, ids: string[], now: number): Promise<{ ops: Op[]; notes: LookNote[] }> {
  const c = doc.compositions[compId], notes: LookNote[] = [];
  const clips = ids.filter((id) => c.layers[id]?.type === 'video' || c.layers[id]?.type === 'image');
  if (clips.length < 2) return { ops: [], notes: [{ kind: 'few' }] };
  const where = (id: string) => { const l = c.layers[id], a = l.in ?? 0, b = l.out ?? c.duration; return now >= a && now < b ? now : (a + b) / 2; };
  const [first, ...rest] = clips, ref = await statsOf(c.layers[first], where(first));
  if (!ref) return { ops: [], notes: [{ kind: 'nopicture', clip: first }] };
  const ops: Op[] = [];
  for (const id of rest) {
    const own = await statsOf(c.layers[id], where(id));
    if (!own) { notes.push({ kind: 'nopicture', clip: id }); continue; }
    ops.push(...matchLookOps(doc, compId, id, matchGrade(ref, own)));
  }
  return { ops, notes };
}

/** the first clip's look brought to the others, as wheels on each: one undo; says what it could not read */
export async function matchLooks(ids: string[]): Promise<boolean> {
  const { ops, notes } = await lookPlan(S.doc.peek(), S.compId.peek(), ids, S.time.peek());
  for (const n of notes) toast(n.kind === 'few' ? t('timeline.matchNeedsTwo') : t('timeline.matchNoPicture', { name: n.clip }), 'error');
  return ops.length > 0 && commit(t('timeline.matchLook'), ops);
}
