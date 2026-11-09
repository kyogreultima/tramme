// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { newProject } from '@tramme/project';

const gate = vi.hoisted(() => {
  let release!: () => void;
  const first = new Promise<void>((resolve) => { release = resolve; });
  return { first, release, declared: vi.fn(), evaluated: vi.fn(async (..._args: unknown[]) => 7), sampled: vi.fn(async () => [{ id: 'box', props: { size: [24, 16], radius: 7 }, transform: {}, masks: [] }]) };
});
vi.mock('../src/plugins/index.ts', async (original) => ({ ...await original(), pluginHost: (base: string) => ({ base, evaluateValue: (...args: unknown[]) => gate.evaluated(base, ...args), evaluateLayers: gate.sampled }) }));
vi.mock('../src/plugins/sandbox-draw.ts', async (original) => ({ ...await original(),
  ensureDeclared: (host: { base: string }) => { gate.declared(host.base); return host.base.includes('/old/') ? gate.first : Promise.resolve(); },
  ensureSandboxDoc: () => {}, moduleItemsOf: () => [],
}));

const { S } = await import('../src/state.ts');
const { prefs } = await import('../src/settings.ts');
const { preview } = await import('../src/preview.ts');
const { Inspector } = await import('../src/ui/Inspector.tsx');

describe('isolated inspector project identity', () => {
  it('does not evaluate an old project after its module declaration completes', async () => {
    const make = (name: string) => {
      const p = newProject({ name, width: 64, height: 64, fps: 30, duration: 2 });
      p.doc.compositions[p.doc.root].layers.box = { type: 'shape.rect', props: { radius: { $expr: '7' } } } as never;
      p.doc.compositions[p.doc.root].order.push('box');
      return p;
    };
    const old = make('Old'), next = make('Next');
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek(), compId: S.compId.peek(), selection: S.selection.peek(), prefs: prefs.peek(), renderer: preview.renderer };
    const mount = document.body.appendChild(document.createElement('div'));
    try {
      S.project.value = old.manifest;
      S.docUrl.value = 'https://tramme.test/old/document.tramme.json';
      S.doc.value = old.doc;
      S.compId.value = old.doc.root;
      S.selection.value = ['box'];
      prefs.value = { ...prefs.peek(), sandboxPreview: true };
      preview.renderer = { assets: { get: () => null } } as never;
      await act(() => { render(h(Inspector, {}), mount); });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 80)); });
      expect(gate.declared).toHaveBeenCalledWith('https://tramme.test/old/document.tramme.json');
      S.project.value = next.manifest;
      S.docUrl.value = 'https://tramme.test/next/document.tramme.json';
      S.doc.value = next.doc;
      await act(async () => { gate.release(); await Promise.resolve(); });
      expect(gate.evaluated.mock.calls.some(([base]) => String(base).includes('/old/'))).toBe(false);
    } finally {
      render(null, mount);
      mount.remove();
      gate.declared.mockClear();
      gate.evaluated.mockClear();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
      S.compId.value = previous.compId;
      S.selection.value = previous.selection;
      prefs.value = previous.prefs;
      preview.renderer = previous.renderer;
    }
  });

  it('requests worker-evaluated bounds when adding a mask', async () => {
    const project = newProject({ name: 'Mask', width: 64, height: 64, fps: 30, duration: 2 });
    project.doc.compositions[project.doc.root].layers.box = { type: 'shape.rect', props: { size: { $expr: '[24, 16]' } } } as never;
    project.doc.compositions[project.doc.root].order.push('box');
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek(), compId: S.compId.peek(), selection: S.selection.peek(), prefs: prefs.peek(), renderer: preview.renderer };
    const mount = document.body.appendChild(document.createElement('div'));
    try {
      S.project.value = project.manifest;
      S.docUrl.value = 'https://tramme.test/mask/document.tramme.json';
      S.doc.value = project.doc;
      S.compId.value = project.doc.root;
      S.selection.value = ['box'];
      prefs.value = { ...prefs.peek(), sandboxPreview: true };
      preview.renderer = { assets: { get: () => null } } as never;
      await act(() => { render(h(Inspector, {}), mount); });
      const button = [...mount.querySelectorAll('button')].find((el) => el.title === 'Add a mask');
      expect(button).toBeDefined();
      await act(async () => { button!.click(); await vi.waitFor(() => expect(gate.sampled).toHaveBeenCalled()); });
      expect(gate.sampled).toHaveBeenCalledWith(['box'], expect.any(Number), project.doc.root);
    } finally {
      render(null, mount);
      mount.remove();
      gate.sampled.mockClear();
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
