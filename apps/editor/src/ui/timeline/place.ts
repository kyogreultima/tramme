// An asset of the project put on a track: its file read for its length and its
// sound, then placed in one commit (the operations are place-ops.ts).

import { comp, commit, S, select, toast } from '../../state.ts';
import { snap } from '../../model.ts';
import { t } from '../../i18n/index.ts';
import { assetLayer } from '../LeftPanel.tsx';
import { hasSound, mediaDuration } from '../../perception.ts';
import { placeClipOps } from './place-ops.ts';

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
