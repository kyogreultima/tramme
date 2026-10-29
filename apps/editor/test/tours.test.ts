// @vitest-environment happy-dom
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { reach } from '../src/tours/engine.ts';

const SRC = join(import.meta.dirname, '../src');
const read = (p: string) => readFileSync(p, 'utf8');
const filesOf = (dir: string, ext: RegExp) => readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => ext.test(f)).map((f) => join(dir, f));

/** every place the tours point at or press: `target: 'x'`, `press('x')`, `marker('x')` */
const used = new Set<string>();
for (const f of filesOf(join(SRC, 'tours'), /\.ts$/)) {
  for (const m of read(f).matchAll(/(?:target: |press\(|marker\()'([a-z0-9-]+)'/g)) used.add(m[1]);
}
/** every data-tour marker the interface carries: written as an attribute, or as the `tour` of a segmented option or a composer */
const defined = new Set<string>();
for (const f of filesOf(join(SRC, 'ui'), /\.tsx$/)) {
  for (const line of read(f).split('\n')) {
    if (/data-tour|\btour[:=]/.test(line)) for (const m of line.matchAll(/['"]([a-z0-9]+(?:-[a-z0-9]+)*)['"]/g)) defined.add(m[1]);
  }
}
const docs = read(join(SRC, '../../../docs/tours.md'));

describe('guided tours', () => {
  it('finds the places the tours point at', () => {
    expect(used.size).toBeGreaterThan(30);
    expect(defined.has('timeline')).toBe(true);
  });

  it('points only at places the interface carries', () => {
    expect([...used].filter((name) => !defined.has(name))).toEqual([]);
  });

  it('documents every place a tour points at', () => {
    expect([...used].filter((name) => !docs.includes(`\`${name}\``))).toEqual([]);
  });

  it('lists in the documentation only places that exist', () => {
    const table = docs.split('\n').filter((l) => l.startsWith('| ')).join('\n');
    const listed = [...table.matchAll(/`([a-z0-9]+(?:-[a-z0-9]+)*)`/g)].map((m) => m[1]);
    expect(listed.length).toBeGreaterThan(30);
    expect(listed.filter((name) => !defined.has(name))).toEqual([]);
  });
});

describe('reaching a step', () => {
  const run = (shown: boolean[]) => {
    const prepared: number[] = [];
    const go = (from: number, dir: 1 | -1) => reach(shown.length, from, dir, async (i) => { prepared.push(i); }, (i) => shown[i]);
    return { prepared, go };
  };

  it('lands on the step asked for when its place is there', async () => {
    const { go, prepared } = run([true, true, true]);
    expect(await go(1, 1)).toBe(1);
    expect(prepared).toEqual([1]);
  });

  it('skips a step whose place is missing but still prepares it', async () => {
    const { go, prepared } = run([true, false, true]);
    expect(await go(1, 1)).toBe(2);
    expect(prepared).toEqual([1, 2]);
  });

  it('goes back past a missing step', async () => {
    const { go } = run([true, false, true]);
    expect(await go(1, -1)).toBe(0);
  });

  it('says so when nothing is left to show', async () => {
    const { go } = run([true, false, false]);
    expect(await go(1, 1)).toBe(-1);
    expect(await go(3, 1)).toBe(-1);
    expect(await go(-1, -1)).toBe(-1);
  });
});
