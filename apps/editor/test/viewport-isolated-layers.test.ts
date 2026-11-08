// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { newProject } from '@tramme/project';

const sampled = vi.hoisted(() => vi.fn(async (ids: string[]) => ids.map((id) => ({ id, props: { size: [20, 20], radius: 0 }, transform: {
  anchor: [0, 0], position: [32, 32], scale: [1, 1], rotation: 0, opacity: 1, depth: 0, rotationX: 0, rotationY: 0,
}, masks: [] }))));
vi.mock('../src/plugins/index.ts', async (original) => ({ ...await original(), pluginHost: () => ({ evaluateLayers: sampled }) }));
vi.mock('../src/plugins/sandbox-draw.ts', async (original) => ({ ...await original(), ensureDeclared: async () => {}, ensureSandboxDoc: () => {}, moduleItemsOf: () => [] }));

const { S } = await import('../src/state.ts');
const { prefs } = await import('../src/settings.ts');
const { preview } = await import('../src/preview.ts');
const { Viewport } = await import('../src/ui/Viewport.tsx');

describe('isolated viewport geometry', () => {
  it('draws selected handles using worker samples', async () => {
    const project = newProject({ name: 'Viewport', width: 64, height: 64, fps: 30, duration: 2 });
    project.doc.compositions[project.doc.root].layers.box = {
      type: 'shape.rect', props: { radius: { $expr: '7' } },
    } as never;
    project.doc.compositions[project.doc.root].order.push('box');
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek(), compId: S.compId.peek(), selection: S.selection.peek(), prefs: prefs.peek(), renderer: preview.renderer };
    const mount = document.body.appendChild(document.createElement('div'));
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('DOMMatrix', class {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
      constructor(values?: number[]) { if (values) [this.a, this.b, this.c, this.d, this.e, this.f] = values; }
      multiply(other: { a: number; b: number; c: number; d: number; e: number; f: number }) { return new (this.constructor as typeof DOMMatrix)([other.a, other.b, other.c, other.d, this.e + other.e, this.f + other.f]); }
      transformPoint(point: { x: number; y: number }) { return { x: point.x + this.e, y: point.y + this.f }; }
      inverse() { return new (this.constructor as typeof DOMMatrix)([1, 0, 0, 1, -this.e, -this.f]); }
    });
    vi.stubGlobal('DOMPoint', class { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } });
    try {
      S.project.value = project.manifest;
      S.docUrl.value = 'https://tramme.test/projects/viewport/document.tramme.json';
      S.doc.value = project.doc;
      S.compId.value = project.doc.root;
      S.selection.value = ['box'];
      prefs.value = { ...prefs.peek(), sandboxPreview: true };
      preview.renderer = { assets: { get: () => null }, hostFactory: () => () => ({}) } as never;
      await act(() => { render(h(Viewport, { bare: false }), mount); });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
      expect(sampled).toHaveBeenCalledWith(['box'], expect.any(Number), project.doc.root);
      expect(mount.querySelector('polygon.gizmo-box')).not.toBeNull();
    } finally {
      render(null, mount);
      mount.remove();
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
