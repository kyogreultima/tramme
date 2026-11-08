// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { builtinRegistry } from '@tramme/nodes';
import { newProject } from '@tramme/project';
import type { ToolContext } from '@tramme/core';

const sampled = vi.hoisted(() => vi.fn(async (ids: string[]) => ids.map((id) => ({ id,
  props: id === 'rect' ? { size: [200, 200] } : { size: [1080, 1920], fit: 'cover' },
  transform: { anchor: [0, 0], position: [540, 960], scale: [1, 1], rotation: 0, opacity: 1, depth: 0, rotationX: 0, rotationY: 0 }, masks: [],
}))));
vi.mock('../src/plugins/index.ts', async (original) => ({ ...await original(), pluginHost: () => ({ evaluateLayers: sampled }) }));
vi.mock('../src/plugins/sandbox-draw.ts', async (original) => ({ ...await original(), ensureDeclared: async () => {}, ensureSandboxDoc: () => {}, moduleItemsOf: () => [] }));

const { S } = await import('../src/state.ts');
const { prefs } = await import('../src/settings.ts');
const { preview } = await import('../src/preview.ts');
const { rectangleBox } = await import('../src/tracking.ts');

it('uses isolated rectangle and video geometry for the tracked picture box', async () => {
  const project = newProject({ name: 'Track', width: 1080, height: 1920, fps: 30, duration: 6 });
  const c = project.doc.compositions[project.doc.root];
  c.layers.video = { type: 'video', props: { video: 'clip', size: [1080, 1920], fit: 'cover' } } as never;
  c.layers.rect = { type: 'shape.rect', props: { size: { $expr: '[200, 200]' } } } as never;
  const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), prefs: prefs.peek(), renderer: preview.renderer };
  vi.stubGlobal('location', { href: 'https://tramme.test/' });
  try {
    S.project.value = project.manifest;
    S.docUrl.value = 'https://tramme.test/projects/track/document.tramme.json';
    prefs.value = { ...prefs.peek(), sandboxPreview: true };
    preview.renderer = { assets: { get: () => null } } as never;
    const ctx = { doc: project.doc, compId: project.doc.root, time: 2, registry: builtinRegistry() } as ToolContext;
    const [x, y, w, h] = await rectangleBox(ctx, 'rect', 'video', 1920, 1080);
    expect(sampled).toHaveBeenCalledWith(['rect', 'video'], 2, project.doc.root);
    expect(x).toBeCloseTo(0.4707, 3);
    expect(y).toBeCloseTo(0.4479, 3);
    expect(w).toBeCloseTo(0.0586, 3);
    expect(h).toBeCloseTo(0.1042, 3);
  } finally {
    S.project.value = previous.project;
    S.docUrl.value = previous.docUrl;
    prefs.value = previous.prefs;
    preview.renderer = previous.renderer;
    vi.unstubAllGlobals();
  }
});
