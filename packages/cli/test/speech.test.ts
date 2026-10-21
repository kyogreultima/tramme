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
