// Image comparison for the equivalence checks: PSNR, mean and max channel
// difference, share of visibly different pixels, and a diff image (the
// reference dimmed, differences in red with intensity by size).

import fs from 'node:fs';
import { PNG } from 'pngjs';
import { pictureDiff, type Diff, type Pixels } from '@tramme/core';

export type { Diff };

const read = (f: string) => PNG.sync.read(fs.readFileSync(f));

const pixelsOf = (p: PNG): Pixels => ({ data: new Uint8ClampedArray(p.data.buffer, p.data.byteOffset, p.data.length), width: p.width, height: p.height });

export function compareFiles(a: string, b: string, { threshold = 16, diffOut = null as string | null } = {}): Diff {
  const A = read(a), { image, ...diff } = pictureDiff(pixelsOf(A), pixelsOf(read(b)), { threshold, diff: !!diffOut });
  if (image && diffOut) {
    const out = new PNG({ width: A.width, height: A.height });
    out.data = Buffer.from(image.buffer, image.byteOffset, image.length);
    fs.writeFileSync(diffOut, PNG.sync.write(out));
  }
  return diff;
}
