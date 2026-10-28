import { describe, expect, it } from 'vitest';
import { cutsOf, restoreInput } from '../src/fillercuts.ts';

const saved = JSON.stringify({ version: 1, kind: 'fillers', asset: 'talk', layer: 'talk-layer', cuts: [{ n: 1, from: 3.2, to: 3.6 }, { n: 2, from: 10, to: 10.4, word: 'uh' }] });

describe('the hesitations the fillers tool cut, listed to be put back', () => {
  it('reads the list the tool saved beside the file', () => {
    expect(cutsOf(saved)).toEqual({ asset: 'talk', cuts: [{ n: 1, from: 3.2, to: 3.6 }, { n: 2, from: 10, to: 10.4, word: 'uh' }] });
  });

  it('reads nothing from a file that is not that list', () => {
    expect(cutsOf('not json')).toBeNull();
    expect(cutsOf(JSON.stringify({ kind: 'analysis' }))).toBeNull();
    expect(cutsOf(JSON.stringify({ version: 1, kind: 'fillers', asset: 'x', cuts: 'no' }))).toBeNull();
  });

  it('puts one back by its number: what the tool is asked', () => {
    expect(restoreInput('talk', 2)).toEqual({ video: 'talk', restore: [2] });
  });
});
