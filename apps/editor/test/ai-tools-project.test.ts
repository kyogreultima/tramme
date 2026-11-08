// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { newProject } from '@tramme/project';

const { api } = await import('../src/api.ts');
const { S } = await import('../src/state.ts');
await import('../src/ai/index.ts');
const { ToolRunner } = await import('../src/ai/tools.ts');

const first = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
const second = newProject({ name: 'Second', width: 64, height: 64, fps: 30, duration: 1 });
const open = (project: typeof first, slug: string) => {
  S.project.value = project.manifest;
  S.docUrl.value = `https://tramme.test/projects/${slug}/document.tramme.json`;
  S.doc.value = project.doc;
};

describe('built-in assistant tool project boundary', () => {
  it('refuses a delayed file listing from a closed project', async () => {
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek() };
    let finish!: (value: any) => void;
    const info = vi.spyOn(api, 'info').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const runner = new ToolRunner();
    try {
      open(first, 'first');
      const pending = runner.run('list_files', {});
      open(second, 'second');
      finish({ files: [{ path: 'assets/private.json', size: 7 }] });
      const result = await pending;
      expect(info.mock.calls[0][0]).toBe(first.manifest.id);
      expect(result.isError).toBe(true);
      expect(result.content[0]).not.toMatchObject({ text: expect.stringContaining('private.json') });
    } finally {
      runner.dispose();
      vi.restoreAllMocks();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
    }
  });

  it('does not report a delayed plugin write as belonging to the new project', async () => {
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek() };
    let finish!: (value: any) => void;
    const write = vi.spyOn(api, 'write').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const runner = new ToolRunner();
    try {
      open(first, 'first');
      const pending = runner.run('write_file', { path: 'plugins/example.js', content: 'export default {}' });
      open(second, 'second');
      finish({});
      const result = await pending;
      expect(write.mock.calls[0][0]).toBe(first.manifest.id);
      expect(result.isError).toBe(true);
      expect(runner.wrotePlugins.size).toBe(0);
      expect(runner.events).toEqual([]);
    } finally {
      runner.dispose();
      vi.restoreAllMocks();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
    }
  });
});
