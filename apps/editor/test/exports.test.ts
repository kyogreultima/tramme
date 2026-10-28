import { describe, expect, it } from 'vitest';
import { applyOps, type Composition } from '@tramme/core';
import { clearRangeOps, exportRangeOf, frameSpan, setRangeOps } from '../src/exportspan.ts';
import { ExportQueue, type ExportJob } from '../src/exports.ts';

const comp = (markers: Composition['markers'] = []): Composition => ({ name: 'Film', width: 640, height: 360, fps: 30, duration: 20, background: null, markers, layers: {}, order: [] });
const doc = (c: Composition) => ({ schema: 'tramme/1', meta: { title: 't' }, tokens: {}, assets: {}, root: 'main', compositions: { main: c } }) as never;
const run = (c: Composition, ops: ReturnType<typeof setRangeOps>) => (applyOps(doc(c), ops) as unknown as { doc: { compositions: { main: Composition } } }).doc.compositions.main;

describe('the span of an export', () => {
  it('is the film between its in mark and its out mark, snapped to frames', () => {
    expect(exportRangeOf(comp([{ id: 'in', t: 2.01, kind: 'in' }, { id: 'out', t: 7.46, kind: 'out' }]))).toEqual([2, 7.4667]);
  });

  it('is the whole film when a mark is missing, or the marks are out of order', () => {
    expect(exportRangeOf(comp())).toBeUndefined();
    expect(exportRangeOf(comp([{ id: 'in', t: 2, kind: 'in' }]))).toBeUndefined();
    expect(exportRangeOf(comp([{ id: 'in', t: 9, kind: 'in' }, { id: 'out', t: 4, kind: 'out' }]))).toBeUndefined();
  });

  it('is counted in frames from the in mark, the out mark clamped to the film', () => {
    expect(frameSpan(30, 20)).toEqual({ f0: 0, f1: 600, from: 0, to: 20 });
    expect(frameSpan(30, 20, [2, 7.5])).toEqual({ f0: 60, f1: 225, from: 2, to: 7.5 });
    expect(frameSpan(30, 20, [18, 40])).toEqual({ f0: 540, f1: 600, from: 18, to: 20 });
  });

  it('is set by marks at the playhead, one of each kind, a new one replacing the old', () => {
    let c = run(comp(), setRangeOps(comp(), 'main', 'in', 3));
    c = run(c, setRangeOps(c, 'main', 'out', 8));
    c = run(c, setRangeOps(c, 'main', 'in', 4));
    expect((c.markers ?? []).map((m) => [m.kind, m.t]).sort()).toEqual([['in', 4], ['out', 8]]);
    expect(exportRangeOf(c)).toEqual([4, 8]);
  });

  it('is cleared with its two marks, and other markers stay', () => {
    const c = comp([{ id: 'in', t: 1, kind: 'in' }, { id: 'out', t: 5, kind: 'out' }, { id: 'm1', t: 3, label: 'Title' }]);
    expect(run(c, clearRangeOps(c, 'main')).markers).toEqual([{ id: 'm1', t: 3, label: 'Title' }]);
    expect(clearRangeOps(comp(), 'main')).toEqual([]);
  });
});

const job = (id: string): ExportJob => ({ id, label: id, format: 'mp4' });

describe('the export queue', () => {
  it('runs the exports one at a time, in the order they were put', async () => {
    const log: string[] = [];
    const q = new ExportQueue(async (j) => { log.push(`start ${j.id}`); await new Promise((r) => setTimeout(r, 5)); log.push(`end ${j.id}`); return { name: `${j.id}.mp4` } as never; });
    q.add(job('a')); q.add(job('b')); q.add(job('c'));
    await q.idle();
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
    expect(q.jobs.map((j) => j.status)).toEqual(['done', 'done', 'done']);
  });

  it('a cancelled export does not stop the next one', async () => {
    const q = new ExportQueue(async (j, signal) => {
      if (j.id === 'a') await new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('stopped'), { name: 'AbortError' }))));
      return { name: `${j.id}.mp4` } as never;
    });
    q.add(job('a')); q.add(job('b'));
    await new Promise((r) => setTimeout(r, 5));
    q.cancel('a');
    await q.idle();
    expect(q.jobs.map((j) => [j.id, j.status])).toEqual([['a', 'cancelled'], ['b', 'done']]);
  });

  it('a waiting export can be taken out, a failed one is told and passed over', async () => {
    const q = new ExportQueue(async (j) => { if (j.id === 'a') throw new Error('no encoder'); return { name: `${j.id}.mp4` } as never; });
    q.add(job('a')); q.add(job('b')); q.add(job('c'));
    q.cancel('c');
    await q.idle();
    expect(q.jobs.map((j) => [j.id, j.status])).toEqual([['a', 'error'], ['b', 'done'], ['c', 'cancelled']]);
    expect(q.jobs[0].error).toBe('no encoder');
  });

  it('keeps the progress of the one that runs, and lets the finished ones be cleared', async () => {
    const q = new ExportQueue(async (j, _s, progress) => { progress(5, 10); return { name: `${j.id}.mp4` } as never; });
    const seen: number[] = [];
    q.onChange = () => { const r = q.jobs.find((j) => j.status === 'running'); if (r?.progress) seen.push(r.progress); };
    q.add(job('a'));
    await q.idle();
    expect(seen).toContain(0.5);
    q.clearFinished();
    expect(q.jobs).toEqual([]);
  });
});
