// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { newProject } from '@tramme/project';

const gate = vi.hoisted(() => {
  let finish!: (value: { ops: unknown[]; notes: unknown[] }) => void;
  return { begin: () => new Promise<{ ops: unknown[]; notes: unknown[] }>((resolve) => { finish = resolve; }), finish: (value: { ops: unknown[]; notes: unknown[] }) => finish(value) };
});
vi.mock('../src/sync-plan.ts', () => ({ syncPlan: () => gate.begin() }));

const { syncClips } = await import('../src/sync.ts');
const { S } = await import('../src/state.ts');

describe('timeline sound sync project switch', () => {
  it('does not commit an old sync result into a newly opened project', async () => {
    const first = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
    const second = newProject({ name: 'Second', width: 64, height: 64, fps: 30, duration: 1 });
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek(), compId: S.compId.peek() };
    try {
      S.project.value = first.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      S.doc.value = first.doc;
      S.compId.value = first.doc.root;
      const pending = syncClips(['a', 'b']);
      S.project.value = second.manifest;
      S.docUrl.value = 'https://tramme.test/projects/second/document.tramme.json';
      S.doc.value = second.doc;
      S.compId.value = second.doc.root;
      gate.finish({ ops: [{ op: 'replace', path: '/meta/title', value: 'Wrong' }], notes: [] });
      expect(await pending).toBe(false);
      expect(S.doc.peek()).toBe(second.doc);
    } finally {
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
      S.compId.value = previous.compId;
    }
  });
});
