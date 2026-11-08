// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { newProject } from '@tramme/project';
import { builtinRegistry } from '@tramme/nodes';
import { Registry, type ToolContext, type TrammeDoc } from '@tramme/core';

await import('../src/ai/index.ts');
const { ToolRunner } = await import('../src/ai/tools.ts');
const { S } = await import('../src/state.ts');

describe('tool project boundary', () => {
  it('refuses a worker capability after the open project changes', async () => {
    const first = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
    const second = newProject({ name: 'Second', width: 64, height: 64, fps: 30, duration: 1 });
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek() };
    const fetch = vi.fn(async () => new Response('private'));
    vi.stubGlobal('fetch', fetch);
    const runner = new ToolRunner();
    try {
      S.project.value = first.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      const context = (runner as unknown as { toolContext(doc: TrammeDoc, registry: Registry): ToolContext }).toolContext(first.doc, builtinRegistry());
      S.project.value = second.manifest;
      S.docUrl.value = 'https://tramme.test/projects/second/document.tramme.json';
      await expect(context.readText('assets/notes.json')).rejects.toThrow('the project changed');
      await expect(context.files()).rejects.toThrow('the project changed');
      await expect(context.writeFile('assets/out.json', 'private')).rejects.toThrow('the project changed');
      expect(() => context.assetUrl('secret')).toThrow('the project changed');
      expect(() => context.fileUrl('assets/secret.json')).toThrow('the project changed');
      expect(() => context.renderStill(0)).toThrow('the project changed');
      await expect(context.transcript('secret')).rejects.toThrow('the project changed');
      expect(fetch).not.toHaveBeenCalled();
      S.project.value = first.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first-copy/document.tramme.json';
      await expect(context.readText('assets/notes.json')).rejects.toThrow('the project changed');
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      runner.dispose();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      vi.unstubAllGlobals();
    }
  });

  it('does not return a file read after the project changes during the request', async () => {
    const first = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
    const second = newProject({ name: 'Second', width: 64, height: 64, fps: 30, duration: 1 });
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek() };
    let deliver!: (response: Response) => void;
    vi.stubGlobal('fetch', () => new Promise<Response>((resolve) => { deliver = resolve; }));
    const runner = new ToolRunner();
    try {
      S.project.value = first.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      const context = (runner as unknown as { toolContext(doc: TrammeDoc, registry: Registry): ToolContext }).toolContext(first.doc, builtinRegistry());
      const pending = context.readText('assets/notes.json');
      S.project.value = second.manifest;
      S.docUrl.value = 'https://tramme.test/projects/second/document.tramme.json';
      deliver(new Response('old project data'));
      await expect(pending).rejects.toThrow('the project changed');
    } finally {
      runner.dispose();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      vi.unstubAllGlobals();
    }
  });

  it('does not propose a completed tool result into the next project', async () => {
    const first = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
    const second = newProject({ name: 'Second', width: 64, height: 64, fps: 30, duration: 1 });
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek() };
    let started!: () => void, finish!: (result: any) => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const registry = new Registry();
    registry.use({ tools: [{
      name: 'slow.proposal', description: 'test project switch',
      run: () => { started(); return new Promise((resolve) => { finish = resolve; }); },
    }] }, 'test');
    const runner = new ToolRunner();
    (runner as unknown as { registry(doc: TrammeDoc): Promise<Registry> }).registry = async () => registry;
    try {
      S.project.value = first.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      S.doc.value = first.doc;
      const pending = (runner as unknown as { useTool(name: string, input: unknown): Promise<{ isError?: boolean; content: unknown[] }> }).useTool('slow.proposal', {});
      await startedPromise;
      S.project.value = second.manifest;
      S.docUrl.value = 'https://tramme.test/projects/second/document.tramme.json';
      S.doc.value = second.doc;
      finish({ text: 'old project result', ops: [{ op: 'replace', path: '/compositions/main/name', value: 'Wrong project' }] });
      const result = await pending;
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([{ type: 'text', text: 'the project changed while the tool was running' }]);
      expect(runner.pending).toBeNull();
      expect(runner.events).toEqual([]);
    } finally {
      runner.dispose();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
    }
  });

  it('refuses a file capability path outside the project', async () => {
    const project = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek() };
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const runner = new ToolRunner();
    try {
      S.project.value = project.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      const context = (runner as unknown as { toolContext(doc: TrammeDoc, registry: Registry): ToolContext }).toolContext(project.doc, builtinRegistry());
      expect(() => context.fileUrl('../private.json')).toThrow();
      expect(() => context.fileUrl('https://tramme.test/api/private')).toThrow();
      await expect(context.readText('../private.json')).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      runner.dispose();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      vi.unstubAllGlobals();
    }
  });

  it('refuses an asset URL outside the current project root', () => {
    const project = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek() };
    const runner = new ToolRunner();
    try {
      S.project.value = project.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      const doc = { ...project.doc, assets: {
        local: { type: 'image', src: 'assets/photo.png' },
        private: { type: 'image', src: 'https://tramme.test/api/private' },
        sibling: { type: 'image', src: '../second/assets/photo.png' },
      } } as TrammeDoc;
      const context = (runner as unknown as { toolContext(doc: TrammeDoc, registry: Registry): ToolContext }).toolContext(doc, builtinRegistry());
      expect(context.assetUrl('local')).toBe('https://tramme.test/projects/first/assets/photo.png');
      expect(() => context.assetUrl('private')).toThrow('asset must belong to this project');
      expect(() => context.assetUrl('sibling')).toThrow('asset must belong to this project');
    } finally {
      runner.dispose();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
    }
  });
});
