// A range of a media file: made a layer, and kept under a name (a sub-clip).
// A sub-clip is a name for a range of a file that is already in the project:
// no second copy, no second decoder.

import { pointer, staticValue, type Layer, type Op, type TrammeDoc } from '@tramme/core';
import { freshId, slug } from './model.ts';

/** the layer playing the file from `inAt` to `outAt` (s of the file): it starts at 0, as long as the range lasts at its speed */
export function clipFromRange(layer: Layer, inAt: number, outAt: number): Layer {
  const rate = Number(staticValue(layer.props?.rate));
  const speed = rate > 0 ? rate : 1;
  return { ...structuredClone(layer), in: 0, out: +((outAt - inAt) / speed).toFixed(4), props: { ...layer.props, start: +inAt.toFixed(4) } };
}

/** the media file an asset is: itself, or for a sub-clip the media it is a range of */
export const mediaOf = (doc: TrammeDoc, id: string): string => doc.assets[id]?.of ?? id;

/** a range of a video or a sound saved under a name; null for a picture, an empty or backwards range, or an unknown media */
export function subclipOps(doc: TrammeDoc, assetId: string, name: string, inAt: number, outAt: number): { ops: Op[]; id: string } | null {
  const media = mediaOf(doc, assetId), a = doc.assets[media];
  if (!a || (a.type !== 'video' && a.type !== 'audio') || !(inAt >= 0 && outAt > inAt)) return null;
  const id = freshId(doc.assets, slug(name) || 'subclip');
  return { id, ops: [{ op: 'add', path: pointer('assets', id), value: { type: a.type, src: a.src, name, of: media, range: [+inAt.toFixed(4), +outAt.toFixed(4)] } }] };
}
