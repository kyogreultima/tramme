import { describe, expect, it } from 'vitest';
import { newProject } from '@tramme/project';
import { assetWithHash, contentHash, WHOLE } from '../src/hash.ts';

describe('the same file imported twice', () => {
  it('has one hash, whatever its name', async () => {
    const a = new Blob([new Uint8Array([1, 2, 3, 4])]);
    const b = new File([new Uint8Array([1, 2, 3, 4])], 'copy of take.mp4');
    expect(await contentHash(a)).toBe(await contentHash(b));
    expect(await contentHash(a)).toBe('sha256:9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a');
    expect(await contentHash(new Blob([new Uint8Array([1, 2, 3, 5])]))).not.toBe(await contentHash(a));
  });

  it('hashes a large file by its size and slices, without reading it whole', async () => {
    const big = new Uint8Array(WHOLE + 1024 * 1024);
    for (let i = 0; i < big.length; i += 4096) big[i] = i & 255;
    const h = await contentHash(new Blob([big]));
    expect(h).toMatch(/^sha256-sampled:[0-9a-f]{64}$/);
    expect(await contentHash(new Blob([big]))).toBe(h);
    // another length, another file
    expect(await contentHash(new Blob([big.subarray(1)]))).not.toBe(h);
    // a change at the start, inside the first slice
    const other = big.slice();
    other[10] = 99;
    expect(await contentHash(new Blob([other]))).not.toBe(h);
  });

  it('is answered with the asset that already has it', () => {
    const { doc } = newProject({ name: 'Cut', width: 1920, height: 1080, fps: 30, duration: 10 });
    doc.assets = {
      take: { type: 'video', src: 'assets/take.mp4', hash: 'sha256:aa' },
      logo: { type: 'image', src: 'assets/logo.png' },
    };
    expect(assetWithHash(doc, 'sha256:aa')).toBe('take');
    expect(assetWithHash(doc, 'sha256:bb')).toBeUndefined();
  });
});
