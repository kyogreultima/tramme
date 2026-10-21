import { describe, expect, it } from 'vitest';
import { asrWords } from '../src/transcript.ts';

describe('Whisper in this browser', () => {
  it('gives words with their timing, as the companion does', () => {
    expect(asrWords({ chunks: [
      { text: ' Hello', timestamp: [0.2, 0.6] },
      { text: ' ', timestamp: [0.6, 0.7] },
      { text: ' world.', timestamp: [0.7, null] },
    ] })).toEqual([{ w: 'Hello', s: 0.2, e: 0.6 }, { w: 'world.', s: 0.7, e: 0.7 }]);
    expect(asrWords({})).toEqual([]);
  });
});
