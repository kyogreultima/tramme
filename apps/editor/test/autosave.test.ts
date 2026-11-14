// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { newProject } from '@tramme/project';

const { api, ApiError } = await import('../src/api.ts');
const { S, commit, load, saveNow } = await import('../src/state.ts');

describe('saving the document', () => {
  it('never conflicts with itself: a save asked while another is on its way waits for it, and the saves go on', async () => {
    const { manifest, doc } = newProject({ name: 'Saves', width: 64, height: 64, fps: 30, duration: 1 });
    // the server as the worker is: a write naming an older version than the stored one is refused (412)
    let version = 0, stored = '';
    const write = vi.spyOn(api, 'write').mockImplementation(async (_id: string, _path: string, body: unknown, opts?: { ifMatch?: string }) => {
      const asked = opts?.ifMatch;
      await new Promise((r) => setTimeout(r, 30));
      if (asked && asked !== `v${version}`) throw new ApiError(412, 'changed');
      version++;
      stored = String(body);
      return { etag: `v${version}`, modified: new Date().toISOString() } as never;
    });
    const previous = { project: S.project.peek(), doc: S.doc.peek(), save: S.save.peek() };
    try {
      load(doc, manifest, 'https://tramme.test/projects/saves/document.tramme.json', 'v0');
      // a change: the autosave leaves after 700 ms; an immediate save (Ctrl+S, a version) asked while it is on its way
      commit('one', [{ op: 'replace', path: `/compositions/${doc.root}/duration`, value: 2 }]);
      await new Promise((r) => setTimeout(r, 710));
      const now = saveNow();
      await now;
      expect(S.save.peek()).toBe('saved');
      // and the saves go on: a later change is stored
      commit('two', [{ op: 'replace', path: `/compositions/${doc.root}/duration`, value: 3 }]);
      for (let i = 0; i < 40 && S.save.peek() !== 'saved'; i++) await new Promise((r) => setTimeout(r, 50));
      expect(S.save.peek()).toBe('saved');
      expect(JSON.parse(stored).compositions[doc.root].duration).toBe(3);
    } finally {
      write.mockRestore();
      S.project.value = previous.project;
      S.doc.value = previous.doc;
      S.save.value = previous.save;
    }
  }, 15_000);
});
