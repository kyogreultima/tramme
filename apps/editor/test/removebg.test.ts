import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }), addEventListener: () => {} });
vi.stubGlobal('document', { hidden: true, hasFocus: () => false, documentElement: { dataset: {} }, querySelector: () => null });
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
vi.stubGlobal('addEventListener', () => {});

// the model and the canvas are the browser's: a matte keeping the 12 x 12 centre of a 40 x 40 picture
const matte = new Uint8ClampedArray(1600);
for (let y = 14; y < 26; y++) for (let x = 14; x < 26; x++) matte[y * 40 + x] = 255;
/** the picture the matte describes: a red square on a white ground, so the edge has something to follow */
const scene = (w: number, h: number) => {
  const d = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 14; y < 26; y++) for (let x = 14; x < 26; x++) { const i = (y * w + x) * 4; d[i + 1] = 30; d[i + 2] = 30; }
  return d;
};
vi.mock('../src/cutout.ts', async (original) => ({ ...(await original<typeof import('../src/cutout.ts')>()), matting: async () => async () => matte }));
vi.mock('../src/perception.ts', async (original) => ({
  ...(await original<typeof import('../src/perception.ts')>()),
  loadImage: async () => ({ naturalWidth: 40, naturalHeight: 40, width: 40, height: 40 }),
  canvas: (width: number, height: number) => ({
    c: { width, height, toBlob: (done: (b: Blob) => void) => done(new Blob(['png'], { type: 'image/png' })) },
    g: { drawImage() {}, translate() {}, scale() {}, getImageData: () => ({ data: scene(width, height) }) },
  }),
}));

const { cutoutBlob, REMOVEBG_TOOLS } = await import('../src/removebg.ts');

describe('the background cut out of a made picture', () => {
  it('keeps the subject in the alpha and says what share of the picture it covers', async () => {
    const out = await cutoutBlob(new Blob(['picture'], { type: 'image/png' }), 'any');
    // the edge is snapped to the picture's (here a flat one) and the specks are cleaned: what is kept is a small share, not the whole picture
    expect(out.kept).toBeGreaterThan(0);
    expect(out.kept).toBeLessThan(0.5);
    expect(out.blob.type).toBe('image/png');
    expect([out.width, out.height]).toEqual([40, 40]);
    // a real PNG, written as it is (signature first)
    expect([...new Uint8Array(await out.blob.arrayBuffer()).slice(0, 4)]).toEqual([137, 80, 78, 71]);
  });

  it('reports its steps', async () => {
    const steps: number[] = [];
    await cutoutBlob(new Blob(['picture']), 'any', (n) => steps.push(n));
    expect(steps.length).toBeGreaterThan(0);
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
  });
});

describe('several pictures in one call', () => {
  const tool = REMOVEBG_TOOLS[0];
  const ctx = (assets: Record<string, { type: string; src: string; name?: string }>) => ({
    doc: { assets, compositions: { main: { layers: {}, order: [], width: 1920, height: 1080 } } },
    compId: 'main', time: 0, selection: [],
    assetUrl: (id: string) => `/a/${id}`,
    writeFile: async (path: string) => path,
  }) as never;

  it('cuts each one out as its own asset, places none, and says them all', async () => {
    vi.stubGlobal('fetch', async () => new Response(new Blob(['picture'], { type: 'image/png' })));
    const out = await tool.run({ images: ['desk-teck', 'desk-oak', 'desk-teck'] }, ctx({ 'desk-teck': { type: 'image', src: 'a.png' }, 'desk-oak': { type: 'image', src: 'b.png' } })) as { ops: { path: string }[]; text: string };
    expect(out.ops.map((o) => o.path)).toEqual(['/assets/desk-teck-cut', '/assets/desk-oak-cut']);
    expect(out.text).toContain('2 backgrounds cut out, none placed');
  });

  it('refuses what is not a picture of the project, before cutting anything', async () => {
    await expect(tool.run({ images: ['desk-teck', 'nope'] }, ctx({ 'desk-teck': { type: 'image', src: 'a.png' } }))).rejects.toThrow('not pictures of the project: nope');
  });
});
