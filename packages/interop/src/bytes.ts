// Asset bytes for the exporters, in browsers and Node: media type, pixel
// size read from the image header (PNG, JPEG, GIF, WebP), base64.

import { readBounded, type TrammeDoc } from '@tramme/core';

export interface AssetFile { data: Uint8Array; mime: string; width: number; height: number }
/** the bytes of an asset by id, or null when it cannot be read */
export type AssetReader = (id: string) => AssetFile | null;

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
};
export const mimeOfName = (name: string) => MIME[name.split(/[?#]/)[0].split('.').pop()!.toLowerCase()] ?? 'application/octet-stream';

export function toBase64(d: Uint8Array): string {
  let s = '';
  for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000));
  return btoa(s);
}
export const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b[0] === 0x89 && b[1] === 0x50) return { width: dv.getUint32(16), height: dv.getUint32(20) };
  if (b[0] === 0x47 && b[1] === 0x49) return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
  if (b[0] === 0x52 && b[8] === 0x57 && b[12] === 0x56) {
    const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (kind === 'VP8 ') return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
    if (kind === 'VP8L') { const v = dv.getUint32(21, true); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
    if (kind === 'VP8X') return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1], len = dv.getUint16(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { width: dv.getUint16(i + 7), height: dv.getUint16(i + 5) };
      i += 2 + len;
    }
  }
  return null;
}

/** an asset as read from its bytes */
export function assetFile(type: string, name: string, data: Uint8Array): AssetFile {
  const size = type === 'image' ? imageSize(data) : null;
  return { data, mime: mimeOfName(name), width: size?.width ?? 0, height: size?.height ?? 0 };
}

/** which asset urls a conversion may read, and how many bytes each */
export interface AssetFetchOptions {
  /** false: the url is not read (an isolated project reads its own folder only) */
  approve?(url: URL): boolean;
  /** bytes per file; a larger one is not read */
  limit?: number;
}

/**
 * The images, fonts and JSON data of the document, by asset id, fetched for a
 * conversion (relative srcs resolve against base). A file refused by `approve`,
 * missing or over `limit` is left out: the exporter warns about it.
 */
export async function fetchAssetFiles(doc: TrammeDoc, base: string, opts: AssetFetchOptions = {}): Promise<Map<string, AssetFile>> {
  const files = new Map<string, AssetFile>();
  await Promise.all(Object.entries(doc.assets).filter(([, a]) => a.type === 'image' || a.type === 'font' || a.type === 'json').map(async ([id, a]) => {
    let url: URL;
    try { url = new URL(a.src, base); } catch { return; }
    if (opts.approve && !opts.approve(url)) return;
    const r = await fetch(url);
    if (!r.ok) return;
    const data = opts.limit ? await readBounded(r, opts.limit, a.src).catch(() => null) : new Uint8Array(await r.arrayBuffer());
    if (data) files.set(id, assetFile(a.type, a.src, data));
  }));
  return files;
}

/** readAsset for the exporters in a browser: the document's files fetched first, then read at once */
export async function fetchAssetReader(doc: TrammeDoc, base: string, opts: AssetFetchOptions = {}): Promise<AssetReader> {
  const files = await fetchAssetFiles(doc, base, opts);
  return (id) => files.get(id) ?? null;
}
