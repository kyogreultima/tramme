// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { builtinRegistry } from '@tramme/nodes';
import { newProject } from '@tramme/project';
import type { ToolContext } from '@tramme/core';

const sampled = vi.hoisted(() => vi.fn(async () => [{ t: 0.5, kind: 'move', layer: 'box', strength: 0.4, weight: 'hero' }]));
vi.mock('../src/plugins/index.ts', async (original) => ({ ...await original(), pluginHost: () => ({ soundCues: sampled }) }));
vi.mock('../src/plugins/sandbox-draw.ts', async (original) => ({ ...await original(), ensureDeclared: async () => {}, ensureSandboxDoc: () => {}, moduleItemsOf: () => [] }));

const { S } = await import('../src/state.ts');
const { prefs } = await import('../src/settings.ts');
const { preview } = await import('../src/preview.ts');
const { cuesOf } = await import('../src/sound.ts');

it('reads cues of an isolated project from its worker', async () => {
  const project = newProject({ name: 'Cues', width: 64, height: 64, fps: 30, duration: 2 });
  project.doc.compositions[project.doc.root].layers.box = { type: 'shape.rect', props: { size: { $expr: '[20, 20]' } } } as never;
  const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), prefs: prefs.peek(), renderer: preview.renderer };
  try {
    S.project.value = project.manifest;
    S.docUrl.value = 'https://tramme.test/projects/cues/document.tramme.json';
    prefs.value = { ...prefs.peek(), sandboxPreview: true };
    preview.renderer = { assets: { get: () => null } } as never;
    const ctx = { doc: project.doc, compId: project.doc.root, registry: builtinRegistry() } as ToolContext;
    expect(await cuesOf(ctx)).toEqual([{ t: 0.5, kind: 'move', layer: 'box', strength: 0.4, weight: 'hero' }]);
    expect(sampled).toHaveBeenCalledWith(project.doc.root);
  } finally {
    S.project.value = previous.project;
    S.docUrl.value = previous.docUrl;
    prefs.value = previous.prefs;
    preview.renderer = previous.renderer;
  }
});
