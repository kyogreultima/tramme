import { describe, expect, it, vi } from 'vitest';

const sandbox = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock('../src/plugins/index.ts', async (load) => ({
  ...(await load<typeof import('../src/plugins/index.ts')>()),
  pluginHost: () => ({
    ensure: async () => new Map(),
    vector: async (...args: unknown[]) => { sandbox.calls.push(args); return { text: '<svg>from the sandbox</svg>', warnings: [] }; },
  }),
}));
import { newProject } from '@tramme/project';
import { builtinRegistry } from '@tramme/nodes';
import { exportInBrowser } from '../src/webexport.ts';

describe('browser web scene export', () => {
  it('refuses visual export before opening a renderer', async () => {
    const doc = newProject({ name: 'Web scene', width: 64, height: 64, fps: 1, duration: 1 }).doc;
    doc.compositions.main.layers.scene = { type: 'webscene', props: { folder: 'scenes/main', frames: [], fps: 1, size: [64, 64] }, transform: {} } as never;
    doc.compositions.main.order = ['scene'];
    await expect(exportInBrowser(doc, 'https://tramme.test/project/document.tramme.json', 'png', {
      compId: 'main', registry: builtinRegistry(),
    })).rejects.toThrow(/tramme render/);
  });

  it('converts an isolated vector export in the sandbox, never on the page', async () => {
    const doc = newProject({ name: 'Expression', width: 64, height: 64, fps: 1, duration: 1 }).doc;
    // run on the page, this expression would write a global
    doc.compositions.main.layers.title = { type: 'text', props: { text: { $expr: '(globalThis.__pageRan = true, "hello")' } }, transform: {} } as never;
    doc.compositions.main.order = ['title'];
    vi.stubGlobal('location', new URL('https://tramme.test/project/document.tramme.json'));
    const result = await exportInBrowser(doc, 'https://tramme.test/project/document.tramme.json', 'svg', {
      compId: 'main', registry: builtinRegistry(), t: 0.5,
    });
    expect(await result.blob.text()).toBe('<svg>from the sandbox</svg>');
    expect(sandbox.calls).toEqual([['svg', doc, 0.5, 'main', {}]]);
    expect((globalThis as { __pageRan?: boolean }).__pageRan).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
