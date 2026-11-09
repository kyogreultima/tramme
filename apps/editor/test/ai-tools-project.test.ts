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
  it('refuses transcript assets that point outside project assets before fetch', async () => {
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek() };
    const fetch = vi.fn(async () => new Response('private'));
    vi.stubGlobal('fetch', fetch);
    const runner = new ToolRunner();
    try {
      open(first, 'first');
      for (const src of ['https://tramme.test/api/private', '../second/assets/transcript.json', '.tramme/chats/index.json', 'assets/%2e%2e/private.json']) {
        S.doc.value = { ...first.doc, assets: { transcript: { type: 'json', src } } };
        const result = await runner.run('get_transcript', { asset: 'transcript' });
        expect(result.isError).toBe(true);
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      runner.dispose();
      vi.unstubAllGlobals();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
    }
  });

  it('refuses encoded file names before a read or write request', async () => {
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek() };
    const fetch = vi.fn(async () => new Response('private'));
    const write = vi.spyOn(api, 'write');
    vi.stubGlobal('fetch', fetch);
    const runner = new ToolRunner();
    try {
      open(first, 'first');
      const path = 'assets/%2e%2e/private.json';
      expect((await runner.run('read_file', { path })).isError).toBe(true);
      expect((await runner.run('write_file', { path, content: '{}' })).isError).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    } finally {
      runner.dispose();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
    }
  });

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

  it('does not add a still rendered after navigation to the new conversation', async () => {
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek() };
    let finish!: (value: string) => void;
    const runner = new ToolRunner();
    vi.spyOn(runner as any, 'stillUrl').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    try {
      open(first, 'first');
      const pending = runner.run('render_still', { t: 0 });
      open(second, 'second');
      finish('data:image/jpeg;base64,AA==');
      const result = await pending;
      expect(result.isError).toBe(true);
      expect(runner.events).toEqual([]);
    } finally {
      runner.dispose();
      vi.restoreAllMocks();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
    }
  });

  it('refuses oversized text before reading its body', async () => {
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek() };
    const cancel = vi.fn(async () => {});
    const fetch = vi.fn(async () => ({
      status: 200,
      ok: true,
      headers: new Headers({ 'content-length': String(8 * 1024 * 1024 + 1) }),
      body: { cancel },
    } as unknown as Response));
    vi.stubGlobal('fetch', fetch);
    const runner = new ToolRunner();
    try {
      open(first, 'first');
      const result = await runner.run('read_file', { path: 'assets/large.json' });
      expect(result.isError).toBe(true);
      expect(result.content[0]).toMatchObject({ text: expect.stringContaining('exceeds 8 MB') });
      expect(fetch.mock.calls).toHaveLength(1);
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      runner.dispose();
      vi.unstubAllGlobals();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
    }
  });

  it('refuses an oversized transcript before parsing JSON', async () => {
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek() };
    const cancel = vi.fn(async () => {});
    vi.stubGlobal('fetch', vi.fn(async () => ({
      status: 200,
      ok: true,
      headers: new Headers({ 'content-length': String(8 * 1024 * 1024 + 1) }),
      body: { cancel },
    } as unknown as Response)));
    const runner = new ToolRunner();
    try {
      open(first, 'first');
      S.doc.value = { ...first.doc, assets: { ...first.doc.assets, transcript: { type: 'json', src: 'assets/transcripts/large.json' } } };
      const result = await runner.run('get_transcript', { asset: 'transcript' });
      expect(result.isError).toBe(true);
      expect(result.content[0]).toMatchObject({ text: expect.stringContaining('exceeds 8 MB') });
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      runner.dispose();
      vi.unstubAllGlobals();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
    }
  });
});
