import { describe, expect, it } from 'vitest';
import { compositionOf, groupIssues, reportHead, reportLines, type Layer, type QualityIssue, type TrammeDoc } from '../src/index.ts';

const comp = (name: string, layers: Record<string, Partial<Layer>>) => ({ name, width: 1080, height: 1920, fps: 30, duration: 6, layers: layers as Record<string, Layer>, order: Object.keys(layers) });
/** a film of scenes: main plays s2 ("Illustration 2") and s3, and s2 plays an inner composition by one more level */
const doc = (): TrammeDoc => ({
  schema: 'tramme/1', meta: { title: 'Report' }, tokens: {}, assets: {}, root: 'main',
  compositions: {
    main: comp('Main', { s2: { type: 'comp', props: { comp: 'ill2' } }, s3: { type: 'comp', props: { comp: 'ill3' } }, cards: { type: 'comp', props: { comp: 'card' } }, title: { type: 'text' } }),
    ill2: comp('Illustration 2', { inner: { type: 'comp', props: { comp: 'deep' } } }),
    ill3: comp('Illustration 3', {}),
    card: comp('Card', {}),
    deep: comp('Deep', {}),
  },
});

const issue = (check: string, severity: 'warning' | 'info', message: string, extra: Partial<QualityIssue> = {}): QualityIssue => ({ check, severity, message, ...extra });
const sizes = (n: number, prefix: string, from = 0): QualityIssue[] => Array.from({ length: n }, (_, i) => issue('text-size', 'warning', `"t${from + i}" is about 14 px high`, { layers: [`${prefix}t${from + i}`], t: 0.5 + i * 0.125, rank: 1.1 + (i * 1.3) / Math.max(1, n - 1) }));

describe('where a layer sits', () => {
  it('follows the composition layers in its id, the instance rank ignored', () => {
    const d = doc();
    expect(compositionOf(d, 'main', 'title')).toBe('main');
    expect(compositionOf(d, 'main', 's2/title')).toBe('ill2');
    expect(compositionOf(d, 'main', 's2/inner/title')).toBe('deep');
    expect(compositionOf(d, 'main', 'cards#3/title')).toBe('card');
    expect(compositionOf(d, 'main', 'gone/title')).toBe('main');
  });
});

describe('the report of the checks', () => {
  it('opens with the counts of issues, not of kinds, or with the good news', () => {
    expect(reportHead(sizes(5, 'x/'))).toBe('5 warning(s), 0 note(s).');
    expect(reportHead([...sizes(2, 'x/'), issue('crowd', 'info', 'c')])).toBe('2 warning(s), 1 note(s).');
    expect(reportHead([])).toBe('No issue found by the checks.');
  });

  it('folds 38 alike into one line naming the worst, the span and the composition', () => {
    const groups = groupIssues(sizes(38, 's2/'));
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ check: 'text-size', severity: 'warning', count: 38, from: 0.5 });
    expect(groups[0].worst.rank).toBeCloseTo(2.4);
    const { lines, hidden } = reportLines(groups, { doc: doc(), compId: 'main' });
    expect(hidden).toBe(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(`- [warning] text-size x38 in "Illustration 2" (0.5 s to 5.13 s), worst: ${groups[0].worst.message} (layers: s2/t0, s2/t1, s2/t2, s2/t3, s2/t4, +33 more)`);
  });

  it('names every composition a group spans, three at most', () => {
    const { lines } = reportLines(groupIssues([...sizes(2, 's2/'), ...sizes(2, 's3/', 2), ...sizes(1, 'cards#0/', 4), ...sizes(1, 's2/inner/', 5)]), { doc: doc(), compId: 'main' });
    expect(lines[0]).toContain('in "Illustration 2", "Illustration 3", "Card", +1 more');
  });

  it('prints a lone issue as it always did', () => {
    const one = issue('safe-zone', 'warning', '"Off the side" goes past the safe zone', { layers: ['edge'] });
    const bare = issue('stillness', 'info', 'nothing moves from 2 s to 6 s');
    expect(reportLines(groupIssues([one, bare]), { doc: doc(), compId: 'main' }).lines).toEqual([
      '- [warning] "Off the side" goes past the safe zone (layers: edge)',
      '- [info] nothing moves from 2 s to 6 s',
    ]);
  });

  it('puts warnings first, then the biggest group', () => {
    const groups = groupIssues([issue('crowd', 'info', 'a'), issue('crowd', 'info', 'b'), issue('crowd', 'info', 'c'), issue('safe-zone', 'warning', 'd'), ...sizes(2, 'x/')]);
    expect(groups.map((g) => `${g.check}:${g.count}`)).toEqual(['text-size:2', 'safe-zone:1', 'crowd:3']);
  });

  it('caps the groups and says what was left out', () => {
    const many = Array.from({ length: 20 }, (_, i) => [issue(`check-${i}`, 'info', `m${i}a`), issue(`check-${i}`, 'info', `m${i}b`)]).flat();
    const { lines, hidden } = reportLines(groupIssues(many), { doc: doc(), compId: 'main', max: 12 });
    expect(hidden).toBe(8);
    expect(lines).toHaveLength(13);
    expect(lines[12]).toContain('8 more');
    expect(lines[12]).toContain('16 issue');
    expect(lines[12]).toContain('check-19');
  });

  it('reads the bilal case in at most thirteen lines', () => {
    const d = doc();
    const issues = [...sizes(200, 's2/'), ...sizes(150, 's3/', 200), ...sizes(100, 's2/inner/', 350), ...sizes(46, 'cards#1/', 450),
      ...Array.from({ length: 29 }, (_, i) => issue(['crowd', 'stillness', 'text-crossing'][i % 3], 'info', `note ${i}`, { layers: [`s2/n${i}`] }))];
    expect(issues.filter((i) => i.severity === 'warning')).toHaveLength(496);
    const { lines } = reportLines(groupIssues(issues), { doc: d, compId: 'main' });
    expect(lines.length).toBeLessThanOrEqual(13);
  });
});
