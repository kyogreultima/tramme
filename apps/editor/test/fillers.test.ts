import { describe, expect, it } from 'vitest';
import { FILLER_WORD } from '../src/fillers.ts';

describe('the words of a hesitation', () => {
  it('are the "uh"s and "um"s a transcription model may write, in English and in French', () => {
    for (const x of ['uh', 'Uh,', 'um.', 'umm', 'uhm', 'euh', 'Euh…', 'hum', 'erm', 'er', 'ah', 'hmm', 'mm', '(uh)', 'ben']) expect(FILLER_WORD.test(x), x).toBe(true);
    for (const x of ['us', 'hum-drum', 'emu', 'era', 'hello', 'the', 'bench']) expect(FILLER_WORD.test(x), x).toBe(false);
  });
});
