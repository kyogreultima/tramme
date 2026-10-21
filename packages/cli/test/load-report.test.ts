import { describe, expect, it } from 'vitest';
import { holdsBack, loadTable, type LoadResult } from '../src/load-report.ts';

const result = (id: string, ms: number, parts: Partial<LoadResult['parts']>): LoadResult => ({
  id, title: id, frames: 60, ms, parts: { evaluate: 0, draw: 0, video: 0, readback: 0, send: 0, ...parts },
});

describe('the figures of the load cases', () => {
  it('say what holds a case back, adding evaluation and drawing as the JavaScript', () => {
    expect(holdsBack(result('a', 30, { evaluate: 8, draw: 8, readback: 12 }).parts)).toBe('the JavaScript');
    expect(holdsBack(result('b', 30, { video: 20, draw: 5 }).parts)).toBe('video decoding');
    expect(holdsBack(result('c', 30, { readback: 20, draw: 5 }).parts)).toBe('the GPU');
    expect(holdsBack(result('d', 30, { send: 20, draw: 5 }).parts)).toBe('the transfer');
  });

  it('print one line per case, the parts in their order', () => {
    const table = loadTable([result('layers', 42, { evaluate: 12, draw: 25, readback: 4, send: 1 })]).split('\n');
    expect(table[0]).toMatch(/^case\s+ms\/frame\s+evaluate\s+draw\s+video\s+readback\s+send\s+held back by$/);
    expect(table[1]).toMatch(/^layers\s+42\s+12\s+25\s+0\.0\s+4\.0\s+1\.0\s+the JavaScript$/);
  });

  it('compare with an earlier run, case by case', () => {
    const before = [result('layers', 40, { draw: 20 }), result('gone', 10, {})];
    const table = loadTable([result('layers', 30, { draw: 10 }), result('new', 5, { draw: 5 })], before);
    expect(table).toContain('30 (-25 %)');
    expect(table).toContain('10 (-50 %)');
    expect(table.split('\n')[2]).not.toContain('%');
  });
});
