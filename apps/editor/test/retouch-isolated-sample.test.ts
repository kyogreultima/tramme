// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { newProject } from '@tramme/project';

const sampled = vi.hoisted(() => vi.fn(async (): Promise<unknown[]> => [{ id: 'box', name: 'Box', type: 'shape.rect', box: { x: 2, y: 3, w: 20, h: 20 }, opacity: 1 }]));
vi.mock('../src/plugins/index.ts', async (original) => ({ ...await original(), pluginHost: () => ({ samplePlaced: sampled }) }));
vi.mock('../src/plugins/sandbox-draw.ts', async (original) => ({ ...await original(), ensureDeclared: async () => {}, ensureSandboxDoc: () => {}, moduleItemsOf: () => [] }));

const { S } = await import('../src/state.ts');
const { prefs } = await import('../src/settings.ts');
const { preview } = await import('../src/preview.ts');
const { placedNow } = await import('../src/ui/Retouch.tsx');

describe('isolated retouch placement', () => {
  it('reads placed layers from the worker and rejects a late result after project navigation', async () => {
    const first = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 2 });
    const next = newProject({ name: 'Next', width: 64, height: 64, fps: 30, duration: 2 });
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek(), compId: S.compId.peek(), prefs: prefs.peek(), renderer: preview.renderer };
    try {
      S.project.value = first.manifest;
      S.docUrl.value = 'https://tramme.test/first/document.tramme.json';
      S.doc.value = first.doc;
      S.compId.value = first.doc.root;
      prefs.value = { ...prefs.peek(), sandboxPreview: true };
      preview.renderer = { assets: { get: () => null } } as never;
      await expect(placedNow()).resolves.toMatchObject([{ id: 'box', box: { x: 2 } }]);
      expect(sampled).toHaveBeenCalledWith(expect.any(Number), first.doc.root);
      let finish!: (value: unknown[]) => void;
      sampled.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
      const pending = placedNow();
      await Promise.resolve();
      S.project.value = next.manifest;
      S.docUrl.value = 'https://tramme.test/next/document.tramme.json';
      S.doc.value = next.doc;
      finish([{ id: 'box', name: 'Old', type: 'shape.rect', box: null, opacity: 1 }]);
      await expect(pending).rejects.toThrow();
    } finally {
      sampled.mockReset();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
      S.compId.value = previous.compId;
      prefs.value = previous.prefs;
      preview.renderer = previous.renderer;
    }
  });
});
