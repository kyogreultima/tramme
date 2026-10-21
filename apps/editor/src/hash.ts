// The same file imported twice becomes one asset (docs/performance-roadmap.md,
// step 5): a hash of its content, computed at import and kept on the asset,
// answers an import of a file already in the project with the asset that
// holds it. Small files are hashed whole; a large one (a long video) by its
// size and evenly spread slices, so a 2 GB file is not read into memory.

import type { TrammeDoc } from '@tramme/core';

/** files up to this size are hashed whole */
export const WHOLE = 64 * 1024 * 1024;
const SLICES = 32, SLICE = 256 * 1024;

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');

/** "sha256:…" of the whole file, or "sha256-sampled:…" of its size and slices for a large one */
export async function contentHash(file: Blob): Promise<string> {
  if (file.size <= WHOLE) return `sha256:${hex(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))}`;
  const parts: BlobPart[] = [new TextEncoder().encode(`${file.size};`)];
  const step = (file.size - SLICE) / (SLICES - 1);
  for (let i = 0; i < SLICES; i++) {
    const at = Math.round(i * step);
    parts.push(await file.slice(at, at + SLICE).arrayBuffer());
  }
  return `sha256-sampled:${hex(await crypto.subtle.digest('SHA-256', await new Blob(parts).arrayBuffer()))}`;
}

/** the asset holding a file of this hash, if the project has one */
export function assetWithHash(doc: TrammeDoc, hash: string): string | undefined {
  return Object.entries(doc.assets).find(([, a]) => a.hash === hash)?.[0];
}
