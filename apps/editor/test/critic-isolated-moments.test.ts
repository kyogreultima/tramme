// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { builtinRegistry } from '@tramme/nodes';
import { newProject } from '@tramme/project';
import type { ToolContext } from '@tramme/core';

const sampled = vi.hoisted(() => vi.fn(async () => [{ id: 'plate', name: 'Plate', type: 'shape.rect', opacity: 1,
  box: { x: 0, y: 0, w: 80, h: 80 } }]));
vi.mock('../src/plugins/index.ts', async (original) => ({ ...await original(), pluginHost: () => ({ samplePlaced: sampled }) }));
vi.mock('../src/plugins/sandbox-draw.ts', async (original) => ({ ...await original(), ensureDeclared: async () => {}, ensureSandboxDoc: () => {}, moduleItemsOf: () => [] }));

const { S } = await import('../src/state.ts');
const { prefs } = await import('../src/settings.ts');
const { preview } = await import('../src/preview.ts');
const { momentsForEvidence } = await import('../src/critic/evidence.ts');

it('chooses a visible entrance from worker placement for isolated evidence', async () => {
  const project = newProject({ name: 'Critic', width: 100, height: 100, fps: 30, duration: 2 });
  const c = project.doc.compositions[project.doc.root];
  c.layers.plate = { type: 'shape.rect', name: 'Plate', in: 0.5, props: { size: { $expr: '[80, 80]' } } } as never;
  c.order = ['plate'];
  const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), prefs: prefs.peek(), renderer: preview.renderer };
  try {
    S.project.value = project.manifest;
    S.docUrl.value = 'https://tramme.test/projects/critic/document.tramme.json';
    prefs.value = { ...prefs.peek(), sandboxPreview: true };
    preview.renderer = { assets: { get: () => null } } as never;
    const ctx = { doc: project.doc, compId: project.doc.root, registry: builtinRegistry() } as ToolContext;
    expect(await momentsForEvidence(ctx, project.doc.root)).toContainEqual({ t: 0.5, why: 'Plate enters', scene: 'Critic' });
    expect(sampled).toHaveBeenCalledWith(0.9, project.doc.root);
  } finally {
    S.project.value = previous.project;
    S.docUrl.value = previous.docUrl;
    prefs.value = previous.prefs;
    preview.renderer = previous.renderer;
  }
});
