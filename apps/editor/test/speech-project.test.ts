// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { newProject } from '@tramme/project';

const { transcriptFor, transcriptions } = await import('../src/speech.ts');
const { answer, question } = await import('../src/confirm.ts');
const { S } = await import('../src/state.ts');

describe('transcription project boundary', () => {
  it('does not start transcription in a newly opened project after a prompt', async () => {
    const first = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
    const second = newProject({ name: 'Second', width: 64, height: 64, fps: 30, duration: 1 });
    first.doc.assets.clip = { type: 'video', src: 'assets/clip.mp4' } as never;
    second.doc.assets.clip = { type: 'video', src: 'assets/other.mp4' } as never;
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek() };
    try {
      S.project.value = first.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      S.doc.value = first.doc;
      const pending = transcriptFor('clip', true);
      expect(question.peek()).not.toBeNull();
      S.project.value = second.manifest;
      S.docUrl.value = 'https://tramme.test/projects/second/document.tramme.json';
      S.doc.value = second.doc;
      answer(true);
      await expect(pending).rejects.toThrow('The project changed during transcription.');
      expect(transcriptions.peek()).toEqual([]);
    } finally {
      if (question.peek()) answer(false);
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
    }
  });
});
