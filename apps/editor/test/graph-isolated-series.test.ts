// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { newProject } from '@tramme/project';

const sampled = vi.hoisted(() => vi.fn(async (addresses: string[], times: number[]) => addresses.map(() => times.map((t) => 10 + t))));
vi.mock('../src/plugins/index.ts', async (original) => ({ ...await original(), pluginHost: () => ({ evaluateSeries: sampled }) }));
vi.mock('../src/plugins/sandbox-draw.ts', async (original) => ({
  ...await original(),
  ensureDeclared: async () => {},
  ensureSandboxDoc: () => {},
  moduleItemsOf: () => [],
}));

const { S } = await import('../src/state.ts');
const { prefs } = await import('../src/settings.ts');
const { preview } = await import('../src/preview.ts');
const { GraphEditor } = await import('../src/ui/GraphEditor.tsx');

describe('isolated graph series', () => {
  it('draws the modified curve from worker samples', async () => {
    const project = newProject({ name: 'Graph', width: 64, height: 64, fps: 30, duration: 2 });
    project.doc.compositions[project.doc.root].layers.box = {
      type: 'shape.rect', props: { radius: { $k: [{ t: 0, v: 0 }, { t: 1, v: 10 }], $mod: [{ type: 'wiggle', amp: 1 }] } },
    } as never;
    project.doc.compositions[project.doc.root].order.push('box');
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek(), compId: S.compId.peek(), selection: S.selection.peek(), prefs: prefs.peek(), renderer: preview.renderer };
    const host = document.body.appendChild(document.createElement('div'));
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    try {
      S.project.value = project.manifest;
      S.docUrl.value = 'https://tramme.test/projects/graph/document.tramme.json';
      S.doc.value = project.doc;
      S.compId.value = project.doc.root;
      S.selection.value = ['box'];
      prefs.value = { ...prefs.peek(), sandboxPreview: true };
      preview.renderer = { assets: { get: () => null } } as never;
      await act(() => { render(h(GraphEditor, {}), host); });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
      expect(sampled).toHaveBeenCalled();
      const final = host.querySelector('path.curve[stroke-dasharray]');
      expect(final?.getAttribute('d')).toMatch(/^M/);
    } finally {
      render(null, host);
      host.remove();
      sampled.mockClear();
      vi.unstubAllGlobals();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
      S.compId.value = previous.compId;
      S.selection.value = previous.selection;
      prefs.value = previous.prefs;
      preview.renderer = previous.renderer;
    }
  });
});
