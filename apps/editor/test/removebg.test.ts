import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }), addEventListener: () => {} });
vi.stubGlobal('document', { hidden: true, hasFocus: () => false, documentElement: { dataset: {} }, querySelector: () => null });
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
vi.stubGlobal('addEventListener', () => {});

// the model and the canvas are the browser's: a matte keeping the four centre pixels of a 10 x 10 picture
const matte = new Uint8ClampedArray(100);
for (const [x, y] of [[4, 4], [5, 4], [4, 5], [5, 5]]) matte[y * 10 + x] = 255;
const alphas: number[] = [];
vi.mock('../src/cutout.ts', async (original) => ({ ...(await original<typeof import('../src/cutout.ts')>()), matting: async () => async () => matte }));
vi.mock('../src/perception.ts', async (original) => ({
  ...(await original<typeof import('../src/perception.ts')>()),
  loadImage: async () => ({ naturalWidth: 10, naturalHeight: 10, width: 10, height: 10 }),
  canvas: (width: number, height: number) => ({
    c: { width, height, toBlob: (done: (b: Blob) => void) => done(new Blob(['png'], { type: 'image/png' })) },
    g: { drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(width * height * 4) }), putImageData: (px: { data: Uint8ClampedArray }) => { for (let i = 3; i < px.data.length; i += 4) alphas.push(px.data[i]); } },
  }),
}));

const { cutoutBlob } = await import('../src/removebg.ts');

describe('the background cut out of a made picture', () => {
  it('keeps the subject in the alpha and says what share of the picture it covers', async () => {
    const out = await cutoutBlob(new Blob(['picture'], { type: 'image/png' }), 'any');
    expect(out.kept).toBeCloseTo(0.04, 5);
    expect(out.blob.type).toBe('image/png');
    expect(alphas.filter((a) => a === 255)).toHaveLength(4);
    expect(alphas).toHaveLength(100);
  });

  it('reports its steps', async () => {
    const steps: number[] = [];
    await cutoutBlob(new Blob(['picture']), 'any', (n) => steps.push(n));
    expect(steps.length).toBeGreaterThan(0);
  });
});
