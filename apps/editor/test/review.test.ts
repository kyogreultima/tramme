import { describe, expect, it } from 'vitest';
import { newProject } from '@tramme/project';
import { issueReport, keyTimes } from '../src/review.ts';
import type { QualityIssue } from '@tramme/core';

describe('the contact sheet', () => {
  it('looks just after the entrances and covers the whole duration', () => {
    const { doc } = newProject({ name: 'Sheet', width: 1080, height: 1080, fps: 30, duration: 10 });
    const c = doc.compositions.main;
    c.layers = { a: { type: 'shape.rect', in: 0 }, b: { type: 'shape.rect', in: 1 }, c: { type: 'shape.rect', in: 1.05 } } as never;
    c.order = ['a', 'b', 'c'];
    const times = keyTimes(doc, 'main', [], 6);
    expect(times).toHaveLength(6);
    expect(times).toContain(0.5);
    expect(times).toContain(1.5);
    expect(Math.max(...times)).toBeGreaterThan(8);
    expect([...times].sort((x, y) => x - y)).toEqual(times);
  });
});

describe('the check as it is read', () => {
  const { doc } = newProject({ name: 'Report', width: 1080, height: 1080, fps: 30, duration: 10 });
  doc.compositions.ill = { name: 'Illustration', width: 1080, height: 1080, fps: 30, duration: 4, layers: {}, order: [] } as never;
  doc.compositions.main.layers.s1 = { type: 'comp', props: { comp: 'ill' } } as never;
  const small = (n: number): QualityIssue[] => Array.from({ length: n }, (_, i) => ({
    check: 'text-size', severity: 'warning', t: i * 0.1, layers: [`s1/t${i}`], rank: 1 + i / 100,
    message: `"t${i}" is about 14 px high`, say: { text: '"{name}" is about {px} px high: too small to read on a phone (at least {min} px)', params: { name: `t${i}`, px: 14, min: 32 } },
  }));

  it('folds 496 warnings and 29 notes into a short text for the model and a short notice for the user', () => {
    const notes: QualityIssue[] = Array.from({ length: 29 }, (_, i) => ({ check: ['crowd', 'stillness', 'text-crossing'][i % 3], severity: 'info', message: `note ${i}` }));
    const { lines, notice } = issueReport([...small(496), ...notes], doc, 'main');
    expect(lines.length).toBeLessThanOrEqual(13);
    expect(lines[0]).toContain('text-size x496 in "Illustration"');
    expect(notice[0]).toContain('495 similar');
    expect(notice.length).toBeLessThanOrEqual(13);
  });

  it('says nothing for no issue', () => {
    expect(issueReport([], doc, 'main')).toEqual({ lines: [], notice: [] });
  });
});
