import { describe, expect, it } from 'vitest';
import { lastReason, plainError } from '../src/plain-error.ts';

describe('the reason of a failed command', () => {
  // what the renderer of the exports in the cloud kept of a failed render: the page's stack, its reason lost
  const failed = [
    'rendering project (mp4): 1920x1080 at 30 fps',
    'Error: asset "voice" (assets/voice.wav): HTTP 404',
    'AssetStore.sync (http://127.0.0.1:40387/__tramme/render/page.js:53322:31)',
    'async _Renderer.setDoc (http://127.0.0.1:40387/__tramme/render/page.js:55181:5)',
    'async _Renderer.open (http://127.0.0.1:40387/__tramme/render/page.js:55165:5)',
    '    at async file:///repo/packages/cli/src/main.ts:369:3',
  ].join('\n');

  it('leaves the stack out and keeps the reason', () => {
    expect(plainError(failed)).toBe('rendering project (mp4): 1920x1080 at 30 fps\nasset "voice" (assets/voice.wav): HTTP 404');
    expect(lastReason(failed, 1)).toBe('asset "voice" (assets/voice.wav): HTTP 404');
  });

  it('keeps every line of a reason given on several lines', () => {
    expect(plainError('project.tramme: 2 issue(s)\n  document.tramme.json/assets/a : file missing\n  document.tramme.json/assets/b : file missing'))
      .toBe('project.tramme: 2 issue(s)\n  document.tramme.json/assets/a : file missing\n  document.tramme.json/assets/b : file missing');
  });

  it('says nothing of a text that is only a stack', () => {
    expect(plainError('run (http://127.0.0.1:51409/__tramme/render/page.js:64176:54)')).toBe('');
  });
});
