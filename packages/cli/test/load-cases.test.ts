import { describe, expect, it } from 'vitest';
import { validate } from '@tramme/core';
import { builtinRegistry } from '@tramme/nodes';
import { loadCases } from '../../../bench/load/cases.ts';

describe('the load cases of the bench', () => {
  const cases = loadCases();

  it('are valid documents', () => {
    for (const c of cases) expect(validate(c.doc, builtinRegistry()), c.id).toEqual([]);
  });

  it('each push one part of a frame, under its own name', () => {
    expect(cases.map((c) => c.id)).toEqual(['layers', 'effects', 'video4k', 'crossfade4k', 'simulation', 'instances']);
  });

  it('are the same on every run', () => {
    expect(JSON.stringify(loadCases())).toBe(JSON.stringify(cases));
  });

  it('make the media they point to', () => {
    for (const c of cases) {
      const srcs = Object.values(c.doc.assets).map((a) => a.src);
      expect(Object.keys(c.media ?? {}).sort(), c.id).toEqual(srcs.sort());
    }
  });
});
