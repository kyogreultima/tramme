// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { builtinRegistry } from '@tramme/nodes';
import { newProject } from '@tramme/project';
import type { ToolContext } from '@tramme/core';

const checked = vi.hoisted(() => vi.fn(async () => [{ check: 'text-size', severity: 'warning', message: 'Small text' }]));
vi.mock('../src/plugins/index.ts', async (original) => ({ ...await original(), pluginHost: () => ({ qualityChecks: checked }) }));
vi.mock('../src/plugins/sandbox-draw.ts', async (original) => ({ ...await original(), ensureDeclared: async () => {}, ensureSandboxDoc: () => {}, moduleItemsOf: () => [] }));

const { S } = await import('../src/state.ts');
const { prefs } = await import('../src/settings.ts');
const { preview } = await import('../src/preview.ts');
const { qualityChecksOf } = await import('../src/isolated-checks.ts');

it('gets isolated quality issues from the project worker', async () => {
  const project = newProject({ name: 'Checks', width: 100, height: 100, fps: 30, duration: 2 });
  project.doc.compositions[project.doc.root].layers.title = { type: 'text', props: { text: { $expr: '"Hi"' } } } as never;
  const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), prefs: prefs.peek(), renderer: preview.renderer };
  try {
    S.project.value = project.manifest;
    S.docUrl.value = 'https://tramme.test/projects/checks/document.tramme.json';
    prefs.value = { ...prefs.peek(), sandboxPreview: true };
    preview.renderer = { assets: { get: () => null } } as never;
    const ctx = { doc: project.doc, compId: project.doc.root, registry: builtinRegistry() } as ToolContext;
    await expect(qualityChecksOf(ctx, project.doc.root)).resolves.toEqual([{ check: 'text-size', severity: 'warning', message: 'Small text' }]);
    expect(checked).toHaveBeenCalledWith(project.doc.root);
  } finally {
    S.project.value = previous.project;
    S.docUrl.value = previous.docUrl;
    prefs.value = previous.prefs;
    preview.renderer = previous.renderer;
  }
});
