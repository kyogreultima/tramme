// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { builtinRegistry } from '@tramme/nodes';
import { newProject } from '@tramme/project';
import type { ToolContext, ToolOutput } from '@tramme/core';

const quads = vi.hoisted(() => vi.fn(async () => [[[40, 40], [60, 40], [60, 60], [40, 60]]]));
const placed = vi.hoisted(() => vi.fn(async () => [{ id: 'caption', name: 'Caption', type: 'text', opacity: 1,
  box: { x: 45, y: 45, w: 10, h: 10 }, textSize: 8 }]));
const values = vi.hoisted(() => vi.fn(async (address: string) => address.endsWith('zoom') ? 1.5 : [10, 20]));
vi.mock('../src/plugins/index.ts', async (original) => ({ ...await original(), pluginHost: () => ({ sampleQuads: quads, samplePlaced: placed, evaluateValue: values }) }));
vi.mock('../src/plugins/sandbox-draw.ts', async (original) => ({ ...await original(), ensureDeclared: async () => {}, ensureSandboxDoc: () => {}, moduleItemsOf: () => [] }));

const { S } = await import('../src/state.ts');
const { prefs } = await import('../src/settings.ts');
const { preview } = await import('../src/preview.ts');
const { CAMERA_TOOLS } = await import('../src/camera.ts');

it('frames a push from worker corners, placed text and camera values', async () => {
  const project = newProject({ name: 'Push', width: 100, height: 100, fps: 30, duration: 2 });
  const c = project.doc.compositions[project.doc.root];
  c.layers.target = { type: 'shape.rect', props: { size: { $expr: '[20, 20]' } } } as never;
  c.camera = { perspective: 1000, zoom: { $expr: '1.5' }, pan: { $expr: '[10, 20]' } } as never;
  const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), prefs: prefs.peek(), renderer: preview.renderer };
  try {
    S.project.value = project.manifest;
    S.docUrl.value = 'https://tramme.test/projects/push/document.tramme.json';
    prefs.value = { ...prefs.peek(), sandboxPreview: true };
    preview.renderer = { assets: { get: () => null } } as never;
    const ctx = { doc: project.doc, compId: project.doc.root, registry: builtinRegistry() } as ToolContext;
    const result = await CAMERA_TOOLS[0].run({ layer: 'target', at: 0 }, ctx) as ToolOutput;
    expect(quads).toHaveBeenCalledWith('target', project.doc.root, [0]);
    expect(placed).toHaveBeenCalledWith(0, project.doc.root);
    expect(values).toHaveBeenCalledTimes(2);
    expect((result.ops?.[0] as { value: { $k: { v: number }[] } }).value.$k[0].v).toBe(1.5);
    expect((result.ops?.[1] as { value: { $k: { v: number[] }[] } }).value.$k[0].v).toEqual([10, 20]);
    expect(result.text).toContain('smallest text');
  } finally {
    S.project.value = previous.project;
    S.docUrl.value = previous.docUrl;
    prefs.value = previous.prefs;
    preview.renderer = previous.renderer;
  }
});
