// Files a provider made, kept in the project beside the record of what made
// them, and the layer that shows them. Pictures and clips share this path:
// only the folder, the asset prefix, the record suffix and the layer type
// differ.

import { pointer, type Op, type ToolContext } from '@tramme/core';
import { freshId } from './model.ts';

export type MediaKind = 'image' | 'video';

const DIR: Record<MediaKind, string> = { image: 'assets/images', video: 'assets/videos' };
const PREFIX: Record<MediaKind, string> = { image: 'image-', video: 'video-' };
const LAYER_PREFIX: Record<MediaKind, string> = { image: 'pic-', video: 'clip-' };
const RECORD: Record<MediaKind, string> = { image: '.image.json', video: '.video.json' };
const EXT: Record<MediaKind, Record<string, string>> = {
  image: { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' },
  video: { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' },
};
const FALLBACK: Record<MediaKind, string> = { image: 'png', video: 'mp4' };
const NAME_FALLBACK: Record<MediaKind, string> = { image: 'picture', video: 'clip' };

export const slugOf = (name: string, fallback = 'media') => name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 56) || fallback;

/** a canvas of a size, its 2D context */
export function canvasOf(w: number, h: number): { c: OffscreenCanvas; g: OffscreenCanvasRenderingContext2D } {
  const c = new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  return { c, g: c.getContext('2d')! };
}

/** a canvas as a PNG data URL */
export async function dataUrl(c: OffscreenCanvas): Promise<string> {
  const blob = await c.convertToBlob({ type: 'image/png' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(s)}`;
}

/** the scale that keeps a picture at most `side` px on its longest side, never enlarging it */
export const fitSide = (w: number, h: number, side = 1536) => Math.min(1, side / Math.max(w, h));

export interface KeptMedia {
  asset: string;
  /** the project path the file was written to */
  src: string;
  ops: Op[];
  reload: string[];
}

/** a picture or clip kept under its assets folder with its record, replaced when made again */
export async function keepMedia(ctx: ToolContext, kind: MediaKind, name: string, blob: Blob, made: unknown): Promise<KeptMedia> {
  const slug = slugOf(name, NAME_FALLBACK[kind]);
  const asset = `${PREFIX[kind]}${slug}`.slice(0, 64);
  const src = await ctx.writeFile(`${DIR[kind]}/${slug}.${EXT[kind][blob.type] ?? FALLBACK[kind]}`, blob);
  await ctx.writeFile(`${DIR[kind]}/${slug}${RECORD[kind]}`, JSON.stringify(made, null, 1));
  const had = !!ctx.doc.assets[asset];
  return { asset, src, reload: had ? [asset] : [], ops: [{ op: had ? 'replace' : 'add', path: pointer('assets', asset), value: { type: kind, src, name } }] };
}

/** a layer showing the file: fills the frame (cover) or shows it whole (contain); a background goes under the others */
export function placeMedia(ctx: ToolContext, kind: MediaKind, asset: string, name: string, o: { fit: 'cover' | 'contain'; at: number; out: number; background: boolean }): { ops: Op[]; layer: string } {
  const c = ctx.doc.compositions[ctx.compId];
  const id = freshId({ ...c.layers }, asset.replace(new RegExp(`^${PREFIX[kind]}`), LAYER_PREFIX[kind]));
  const at = Math.max(0, o.at), out = Math.min(c.duration, Math.max(at, o.out));
  const ops: Op[] = [
    { op: 'add', path: pointer('compositions', ctx.compId, 'layers', id), value: { type: kind, name, in: +at.toFixed(3), out: +out.toFixed(3), transform: { position: [c.width / 2, c.height / 2] }, props: { [kind]: asset, size: [c.width, c.height], fit: o.fit } } },
    { op: 'add', path: pointer('compositions', ctx.compId, 'order', o.background ? '0' : '-'), value: id },
  ];
  return { ops, layer: id };
}

/** the record of a file made before (beside it, with the kind's suffix), or null */
export async function recordOf(ctx: ToolContext, kind: MediaKind, asset: string): Promise<Record<string, unknown> | null> {
  const src = ctx.doc.assets[asset]?.src;
  if (!src) return null;
  const text = await ctx.readText(src.replace(/\.[a-z0-9]+$/i, RECORD[kind])).catch(() => null);
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

/** made again: the same asset entry, its src moved to the new file when the file's name changed */
export function againOps(ctx: ToolContext, oldAsset: string, kept: KeptMedia): Op[] {
  const old = ctx.doc.assets[oldAsset];
  if (!old || kept.asset === oldAsset) return kept.ops;
  return [{ op: 'replace', path: pointer('assets', oldAsset), value: { ...old, src: kept.src } }];
}
