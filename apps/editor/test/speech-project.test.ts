// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { newProject } from '@tramme/project';

const { transcriptFor, transcribeAsset, transcriptions } = await import('../src/speech.ts');
const { answer, question } = await import('../src/confirm.ts');
const { S } = await import('../src/state.ts');

describe('transcription project boundary', () => {
  it('refuses media outside project assets before opening a transcription source', async () => {
    const project = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek() };
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    try {
      S.project.value = project.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      for (const src of ['https://tramme.test/api/private', '../second/assets/clip.mp4', 'assets/%2e%2e/private.mp4']) {
        S.doc.value = { ...project.doc, assets: { clip: { type: 'video', src } } };
        await expect(transcribeAsset('clip')).rejects.toThrow('project asset');
      }
      expect(fetch).not.toHaveBeenCalled();
      expect(transcriptions.peek()).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
    }
  });

  it('asks the user, or starts at once when their settings say so, a turn left alone included', async () => {
    const project = newProject({ name: 'First', width: 64, height: 64, fps: 30, duration: 1 });
    // a source outside the project's assets: a started transcription stops there, before any network
    project.doc.assets.clip = { type: 'video', src: 'https://tramme.test/api/private' } as never;
    const previous = { project: S.project.peek(), docUrl: S.docUrl.peek(), doc: S.doc.peek() };
    const { turnBegins, turnEnds } = await import('../src/confirm.ts');
    const { setPrefs } = await import('../src/settings.ts');
    try {
      S.project.value = project.manifest;
      S.docUrl.value = 'https://tramme.test/projects/first/document.tramme.json';
      S.doc.value = project.doc;
      turnBegins(true);
      // nobody is there to answer: it does without
      await expect(transcriptFor('clip', true)).rejects.toThrow('starts transcriptions themselves');
      setPrefs({ assistantTranscribes: true });
      await expect(transcriptFor('clip', true)).rejects.toThrow('project asset');
      expect(question.peek()).toBeNull();
    } finally {
      turnEnds();
      setPrefs({ assistantTranscribes: false });
      S.project.value = previous.project;
      S.docUrl.value = previous.docUrl;
      S.doc.value = previous.doc;
    }
  });

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
