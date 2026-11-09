// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { newProject } from '@tramme/project';
import { listClaude, unlistClaude } from './claude-listed.ts';

const ai = await import('../src/ai/index.ts');
const { api } = await import('../src/api.ts');
const { ServerSession } = await import('../src/ai/server.ts');
const { S } = await import('../src/state.ts');

describe('assistant preparation project boundary', () => {
  it('does not start a model turn with a brief returned after project switch', async () => {
    const first = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
    const second = newProject({ name: 'Second', width: 64, height: 64, fps: 30, duration: 1 });
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek(), settings: ai.aiSettings.peek(), status: ai.aiStatus.peek() };
    let finish!: (value: any) => void;
    const read = vi.spyOn(api, 'readText').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const turn = vi.spyOn(ServerSession.prototype, 'turn');
    try {
      listClaude();
      ai.setAiSettings({ model: 'claude-opus-5-5' });
      ai.aiStatus.value = { ...ai.aiStatus.peek(), server: true, companion: 'absent' };
      S.project.value = first.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      S.doc.value = first.doc;
      const iterator = ai.ask({ text: 'Make a film', context: {}, doc: first.doc, decisions: [] }, new AbortController().signal);
      const pending = iterator.next();
      for (let i = 0; !finish && i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 0));
      expect(finish).toBeTypeOf('function');
      S.project.value = second.manifest;
      S.docUrl.value = 'https://tramme.test/projects/second/document.tramme.json';
      S.doc.value = second.doc;
      finish({ text: 'Old private brief' });
      expect((await pending).done).toBe(true);
      expect(read.mock.calls[0][0]).toBe(first.manifest.id);
      expect(turn).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
      unlistClaude();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
      ai.aiSettings.value = previous.settings;
      ai.aiStatus.value = previous.status;
    }
  });
});
