// An asset of the project put on a track: its file read for its length and its
// sound, then placed in one commit (the operations are place-ops.ts).

import { comp, commit, S, select, toast } from '../../state.ts';
import { freshId, snap } from '../../model.ts';
import { t } from '../../i18n/index.ts';
import { assetLayer } from '../LeftPanel.tsx';
import { hasSound, mediaDuration } from '../../perception.ts';
import { nestOps, newSequenceOps, placeClipOps, type Placement } from './place-ops.ts';

export async function placeAsset(assetId: string, at: number, trackId: string, mode: 'insert' | 'overwrite'): Promise<boolean> {
  const doc = S.doc.peek(), compId = S.compId.peek(), a = doc.assets[assetId];
  if (!a) return false;
  const built = await assetLayer(assetId, a);
  if (!built) return false;
  const url = new URL(a.src, new URL(S.docUrl.peek(), location.href)).href;
  const withSound = a.type === 'video' && await hasSound(url);
  const length = a.type === 'audio' ? (await mediaDuration(url)) || undefined : undefined;
  const r = placeClipOps(S.doc.peek(), compId, a.name || assetId, { layer: built.layer, withSound, length }, snap(at, comp.peek().fps), trackId, mode);
  if (!r) { toast(t('timeline.cannotPlaceHere'), 'error'); return false; }
  if (!commit(t('timeline.placeName', { name: a.name || assetId }), r.ops)) return false;
  select([r.id]);
  return true;
}

/** a composition of the project dropped on a track: one clip as long as it is */
export function placeComp(innerId: string, at: number, trackId: string, mode: 'insert' | 'overwrite'): boolean {
  const r = nestOps(S.doc.peek(), S.compId.peek(), innerId, snap(at, comp.peek().fps), trackId, mode);
  if (!r) { toast(t('timeline.cannotNest'), 'error'); return false; }
  if (!commit(t('timeline.placeName', { name: S.doc.peek().compositions[innerId].name }), r.ops)) return false;
  select([r.id]);
  return true;
}

/** a new sequence made of an asset of the project (its sound with it when it has one), opened in the timeline */
export async function newSequenceFromAsset(assetId: string): Promise<boolean> {
  const doc = S.doc.peek(), a = doc.assets[assetId];
  const built = a ? await assetLayer(assetId, a) : null;
  if (!a || !built) return false;
  const url = new URL(a.src, new URL(S.docUrl.peek(), location.href)).href;
  const placement: Placement = { layer: built.layer, withSound: a.type === 'video' && await hasSound(url), length: a.type === 'audio' ? (await mediaDuration(url)) || undefined : undefined };
  const id = freshId(S.doc.peek().compositions, 'sequence');
  const r = newSequenceOps(S.doc.peek(), S.compId.peek(), id, a.name || assetId, [{ base: a.name || assetId, placement }]);
  if (!r || !commit(t('timeline.newSequenceName', { name: a.name || assetId }), r.ops)) return false;
  S.compId.value = id;
  select([]);
  return true;
}
