// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { newProject } from '@tramme/project';

const evaluated = vi.hoisted(() => vi.fn(async () => 7));
vi.mock('../src/plugins/index.ts', async (original) => ({ ...await original(), pluginHost: () => ({ evaluateValue: evaluated }) }));
vi.mock('../src/plugins/sandbox-draw.ts', async (original) => ({
  ...await original(),
  ensureDeclared: async () => {},
  ensureSandboxDoc: () => {},
  moduleItemsOf: () => [],
}));

await import('../src/ai/index.ts');
const { ToolRunner } = await import('../src/ai/tools.ts');
const { S } = await import('../src/state.ts');
const { prefs } = await import('../src/settings.ts');
const { preview } = await import('../src/preview.ts');

describe('isolated assistant evaluation', () => {
  it('reads an expression value from the worker', async () => {
    const project = newProject({ name: 'Evaluate', width: 64, height: 64, fps: 30, duration: 1 });
    project.doc.compositions[project.doc.root].layers.box = { type: 'shape.rect', props: { radius: { $expr: '3 + 4' } } } as never;
    project.doc.compositions[project.doc.root].order.push('box');
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek(), prefs: prefs.peek(), renderer: preview.renderer };
    const runner = new ToolRunner();
    try {
      S.project.value = project.manifest;
      S.docUrl.value = 'https://tramme.test/projects/evaluate/document.tramme.json';
      S.doc.value = project.doc;
      prefs.value = { ...prefs.peek(), sandboxPreview: true };
      preview.renderer = { assets: { get: () => null } } as never;
      const result = await runner.run('evaluate', { address: 'box.radius', t: 0, compId: project.doc.root });
      expect(result.isError).not.toBe(true);
      expect(result.content).toEqual([{ type: 'text', text: '7' }]);
      expect(evaluated).toHaveBeenCalledWith('box.radius', 0, project.doc.root);
    } finally {
      runner.dispose();
      evaluated.mockClear();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
      prefs.value = previous.prefs;
      preview.renderer = previous.renderer;
    }
  });

  it('discards an evaluated value returned after a project switch', async () => {
    const first = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
    const second = newProject({ name: 'Second', width: 64, height: 64, fps: 30, duration: 1 });
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek(), prefs: prefs.peek(), renderer: preview.renderer };
    let finish!: (value: number) => void;
    evaluated.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const runner = new ToolRunner();
    try {
      S.project.value = first.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      S.doc.value = first.doc;
      prefs.value = { ...prefs.peek(), sandboxPreview: true };
      preview.renderer = { assets: { get: () => null } } as never;
      const pending = runner.run('evaluate', { address: '$comp.width', t: 0, compId: first.doc.root });
      for (let i = 0; !finish && i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 0));
      expect(finish).toBeTypeOf('function');
      S.project.value = second.manifest;
      S.docUrl.value = 'https://tramme.test/projects/second/document.tramme.json';
      S.doc.value = second.doc;
      finish(64);
      const result = await pending;
      expect(result.isError).toBe(true);
      expect(result.content[0]).not.toMatchObject({ text: '64' });
    } finally {
      runner.dispose();
      evaluated.mockClear();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
      prefs.value = previous.prefs;
      preview.renderer = previous.renderer;
    }
  });
});
