// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { builtinRegistry } from '@tramme/nodes';
import { newProject } from '@tramme/project';
import type { ToolContext } from '@tramme/core';

const sampled = vi.hoisted(() => vi.fn(async (at: number) => [{ id: 'plate', name: 'Plate', type: 'shape.rect', opacity: 1,
  box: { x: at === 0 ? 10 : 20, y: 10, w: 10, h: 10 } }]));
vi.mock('../src/plugins/index.ts', async (original) => ({ ...await original(), pluginHost: () => ({ samplePlaced: sampled }) }));
vi.mock('../src/plugins/sandbox-draw.ts', async (original) => ({ ...await original(), ensureDeclared: async () => {}, ensureSandboxDoc: () => {}, moduleItemsOf: () => [] }));

const { S } = await import('../src/state.ts');
const { prefs } = await import('../src/settings.ts');
const { preview } = await import('../src/preview.ts');
const { drawnBox } = await import('../src/components.ts');

it('frames a component from placed worker samples', async () => {
  const project = newProject({ name: 'Component', width: 64, height: 64, fps: 30, duration: 1 });
  project.doc.compositions[project.doc.root].layers.plate = { type: 'shape.rect', props: { size: { $expr: '[10, 10]' } } } as never;
  const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), prefs: prefs.peek(), renderer: preview.renderer };
  try {
    S.project.value = project.manifest;
    S.docUrl.value = 'https://tramme.test/projects/component/document.tramme.json';
    prefs.value = { ...prefs.peek(), sandboxPreview: true };
    preview.renderer = { assets: { get: () => null } } as never;
    const ctx = { doc: project.doc, compId: project.doc.root, registry: builtinRegistry() } as ToolContext;
    expect(await drawnBox(ctx, ['plate'])).toEqual({ x: 6, y: 6, w: 28, h: 18 });
    expect(sampled).toHaveBeenCalledWith(0, project.doc.root);
  } finally {
    S.project.value = previous.project;
    S.docUrl.value = previous.docUrl;
    prefs.value = previous.prefs;
    preview.renderer = previous.renderer;
  }
});
