// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { newProject } from '@tramme/project';

const { S } = await import('../src/state.ts');
const { chat } = await import('../src/ai/index.ts');
const { consume, running } = await import('../src/ai/conversation.ts');

describe('assistant conversation project boundary', () => {
  it('drops a proposal event received after another project opens', async () => {
    const first = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
    const second = newProject({ name: 'Second', width: 64, height: 64, fps: 30, duration: 1 });
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek(), proposal: S.proposal.peek(), chat: chat.peek() };
    let release!: () => void;
    let turnSignal!: AbortSignal;
    try {
      S.project.value = first.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      S.doc.value = first.doc;
      const pending = consume(async function* (signal) {
        turnSignal = signal;
        await new Promise<void>((resolve) => { release = resolve; });
        yield { type: 'proposal', id: 'old-proposal', label: 'Old', ops: [] } as const;
      }, false);
      S.project.value = second.manifest;
      S.docUrl.value = 'https://tramme.test/projects/second/document.tramme.json';
      S.doc.value = second.doc;
      expect(turnSignal.aborted).toBe(true);
      S.proposal.value = null;
      chat.value = [{ id: 'new-chat', role: 'user', text: 'new project' }];
      release();
      await pending;
      expect(S.proposal.peek()).toBeNull();
      expect(chat.peek()).toEqual([{ id: 'new-chat', role: 'user', text: 'new project' }]);
      expect(running.peek()).toBe(false);
    } finally {
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
      S.proposal.value = previous.proposal;
      chat.value = previous.chat;
    }
  });
});
