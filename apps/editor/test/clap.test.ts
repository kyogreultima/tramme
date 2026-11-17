import { describe, expect, it, vi } from 'vitest';
import { catalogVectors, cosine, packVector, textVector, unpackVector } from '../src/clap.ts';

describe('CLAP vectors', () => {
  it('keeps a unit vector within 1% cosine when packed as int8', () => {
    const vector = Float32Array.from({ length: 512 }, (_, i) => Math.sin(i * 7) / Math.sqrt(256));
    expect(cosine(vector, unpackVector(packVector(vector)))).toBeGreaterThan(0.99);
  });

  it('reads ids and vectors from the catalog binary', async () => {
    const bytes = new Uint8Array(4 + 2 + 3 + 4 + 512);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 1, true);
    view.setUint16(4, 3, true);
    bytes.set(new TextEncoder().encode('hit'), 6);
    view.setFloat32(9, 1 / 127, true);
    bytes[13] = 127;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)));
    try {
      const vectors = await catalogVectors();
      expect([...vectors.keys()]).toEqual(['hit']);
      expect(vectors.get('hit')?.[0]).toBeCloseTo(1);
    } finally { vi.unstubAllGlobals(); }
  });

  it('returns null when no browser model cache is available', async () => {
    expect(await textVector('whoosh')).toBeNull();
  });
});
