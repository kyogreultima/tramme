// What the user puts on a track from the project's media: an asset (its file
// read for its length and its sound), a range of one, a composition, or a new
// sequence made of one. Each is one commit (the operations are place-ops.ts).

import type { Asset, Layer } from '@tramme/core';
import { comp, commit, S, select, toast } from '../../state.ts';
import { freshId, snap } from '../../model.ts';
import { t } from '../../i18n/index.ts';
import { assetLayer } from '../LeftPanel.tsx';
import { hasSound, mediaDuration } from '../../perception.ts';
import { clipFromRange, mediaOf } from '../../subclips.ts';
import { nestOps, newSequenceOps, placeClipOps, type Placement } from './place-ops.ts';

/** the file of an asset as the browser reads it */
const urlOf = (a: Asset) => new URL(a.src, new URL(S.docUrl.peek(), location.href)).href;

/** what the preview must know of an asset to put it on a track: its layer, whether it has a sound, how long a sound is */
async function placementOf(assetId: string, a: Asset, range?: [number, number]): Promise<Placement | null> {
  const media = mediaOf(S.doc.peek(), assetId);
  const built = await assetLayer(range ? media : assetId, range ? S.doc.peek().assets[media] : a);
  if (!built) return null;
  const layer: Layer = range ? clipFromRange(built.layer, range[0], range[1]) : built.layer;
  const withSound = a.type === 'video' && await hasSound(urlOf(a));
  const length = a.type === 'audio' && layer.out === undefined ? (await mediaDuration(urlOf(a))) || undefined : undefined;
  return { layer, withSound, length };
}

async function putOnTrack(name: string, p: Placement | null, at: number, trackId: string, mode: 'insert' | 'overwrite'): Promise<boolean> {
  const r = p && placeClipOps(S.doc.peek(), S.compId.peek(), name, p, snap(at, comp.peek().fps), trackId, mode);
  if (!r) { toast(t('timeline.cannotPlaceHere'), 'error'); return false; }
  if (!commit(t('timeline.placeName', { name }), r.ops)) return false;
  select([r.id]);
  return true;
}

/** an asset of the project (a media, or a sub-clip) put on a track at `at` */
export async function placeAsset(assetId: string, at: number, trackId: string, mode: 'insert' | 'overwrite'): Promise<boolean> {
  const a = S.doc.peek().assets[assetId];
  if (!a) return false;
  const range = a.of !== undefined && a.range ? a.range : undefined;
  return putOnTrack(a.name || assetId, await placementOf(assetId, a, range), at, trackId, mode);
}

/** the part of a media between two marks (s of its file) put on a track at `at`: the source monitor's insert and overwrite */
export async function placeRange(assetId: string, inAt: number, outAt: number, at: number, trackId: string, mode: 'insert' | 'overwrite'): Promise<boolean> {
  const a = S.doc.peek().assets[assetId];
  if (!a) return false;
  return putOnTrack(a.name || assetId, await placementOf(assetId, a, [inAt, outAt]), at, trackId, mode);
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
  const a = S.doc.peek().assets[assetId];
  const placement = a ? await placementOf(assetId, a, a.of !== undefined && a.range ? a.range : undefined) : null;
  if (!a || !placement) return false;
  const id = freshId(S.doc.peek().compositions, 'sequence');
  const r = newSequenceOps(S.doc.peek(), S.compId.peek(), id, a.name || assetId, [{ base: a.name || assetId, placement }]);
  if (!r || !commit(t('timeline.newSequenceName', { name: a.name || assetId }), r.ops)) return false;
  S.compId.value = id;
  select([]);
  return true;
}
