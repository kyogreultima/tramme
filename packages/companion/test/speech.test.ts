import { describe, expect, it } from 'vitest';
import { whisperModel } from '../src/speech.ts';

describe('the model the companion transcribes with', () => {
  it('is the one the editor asks for', () => {
    expect(whisperModel('Xenova/whisper-base', '')).toBe('Xenova/whisper-base');
  });

  it('is the default when the editor asks for nothing, or for what is not a model hub id', () => {
    expect(whisperModel(undefined, '')).toBe('Xenova/whisper-small');
    expect(whisperModel('../../etc', '')).toBe('Xenova/whisper-small');
    expect(whisperModel(42, '')).toBe('Xenova/whisper-small');
  });

  it('is the machine’s own when TRAMME_WHISPER_MODEL names one', () => {
    expect(whisperModel('Xenova/whisper-base', 'Xenova/whisper-medium')).toBe('Xenova/whisper-medium');
  });
});

describe('the transformers.js the published companion installs', () => {
  it('is the version the editor uses', async () => {
    const fs = await import('node:fs');
    const { WHISPER_PACKAGE } = await import('../src/speech.ts');
    const root = JSON.parse(fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
    expect(WHISPER_PACKAGE).toBe(`@huggingface/transformers@${root.dependencies['@huggingface/transformers'].replace(/^[\^~]/, '')}`);
  });
});
