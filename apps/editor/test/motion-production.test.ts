import { describe, expect, it } from 'vitest';
import { newProject } from '@tramme/project';
import { builtinRegistry } from '@tramme/nodes';
import type { ToolContext } from '@tramme/core';
import * as plans from '../src/filmplan.ts';
import * as evidence from '../src/critic/evidence.ts';
import { doneIssues } from '../src/critic/done.ts';
import { scenePrompt } from '../src/ai/scenes-run.ts';

const beat = { subject: 'Product', start: 1, end: 2, action: 'Rise 120 px; overshoot 7%', easing: 'easeOut', settle: 2.4, soundAt: 2.02 };
const scene = { id: 'product', name: 'Product', kind: '3d' as const, idea: 'One product turns', seconds: 6, comp: 'main', motion: [beat] };
const plan = () => ({ version: 1 as const, kind: 'film-plan' as const, updated: '', idea: 'A product loop', kinds: ['3d' as const], scenes: [scene], directions: [], loop: true });
const project = (name: string) => newProject({ name, duration: 6, width: 1920, height: 1080, fps: 30 });

describe('timed motion direction', () => {
  it('allows a one-shot film to use one kind of picture', () => {
    expect(plans.planIssues(plan())).toEqual([]);
  });

  it('keeps a full motion brief in a scene builder, outside the clipped global summary', () => {
    const { doc } = project('Loop');
    const prompt = scenePrompt(plan(), scene, doc);
    expect(prompt).toContain('1–2 s');
    expect(prompt).toContain('Rise 120 px; overshoot 7%');
    expect(prompt).toContain('2.4');
    expect(prompt).toContain('2.02');
    expect(prompt).toContain('loop');
  });

  it('rejects motion outside the scene or settling before the movement ends', () => {
    const bad = { ...scene, motion: [{ ...beat, end: 8, settle: 1.5 }] };
    expect(plans.motionIssues([bad]).join('\n')).toMatch(/Product.*6 s/);
    expect(plans.motionIssues([bad]).join('\n')).toMatch(/settle/i);
    expect(plans.motionIssues([{ ...scene, motion: [{ ...beat, start: NaN }] }])).not.toEqual([]);
  });

  it('round-trips loop and beats, and refuses invalid timing before writing a file', async () => {
    const { doc } = project('Loop');
    const files = new Map<string, string>();
    const ctx = { doc, readText: async () => null, writeFile: async (p: string, v: string) => { files.set(p, v); return p; } } as unknown as ToolContext;
    const input = plan();
    await plans.FILM_PLAN_TOOLS[0].run(input, ctx);
    expect(plans.parsePlan(files.get(plans.FILM_PLAN_PATH))).toMatchObject({ loop: true, scenes: [{ motion: [beat] }] });
    files.clear();
    await expect(plans.FILM_PLAN_TOOLS[0].run({ ...input, scenes: [{ ...scene, motion: [{ ...beat, end: -1 }] }] }, ctx)).rejects.toThrow(/motion/i);
    expect(files.size).toBe(0);
  });
});

describe('bounded visual evidence', () => {
  it('converts scene-local beats in a root scene to film time', () => {
    const { doc } = project('Film');
    doc.compositions.main.duration = 12;
    doc.compositions.main.markers = [{ id: 'later', label: 'Product', kind: 'scene', t: 6 }];
    const p = { ...plan(), scenes: [{ ...scene, id: 'later', comp: undefined }] };
    expect(evidence.directedMoments(doc, 'main', p)).toContainEqual(expect.objectContaining({ t: 7, end: 8.4, scene: 'Product' }));
  });

  it('covers the beginning, middle and last frame even when all events are early', () => {
    const frames = evidence.reviewSamples(120, 30, Array.from({ length: 20 }, (_, i) => ({ t: i, why: 'cut', scene: 'Early' })));
    const times = frames.flatMap((r) => r.times);
    expect(frames.length).toBeLessThanOrEqual(12);
    expect(times).toContain(0);
    expect(times).toContain(60);
    expect(Math.max(...times)).toBeCloseTo(120 - 1 / 30, 5);
    expect(times.every((t) => t >= 0 && t < 120)).toBe(true);
  });

  it('samples the whole directed movement and its settle time', () => {
    const frames = evidence.reviewSamples(6, 30, [], [{ t: 1, end: 2.4, why: 'Product rises', scene: 'Product' }]);
    const detail = frames.find((r) => r.caption.includes('Product rises'))!;
    expect(detail.times[0]).toBeLessThanOrEqual(1);
    expect(detail.times.at(-1)).toBeGreaterThanOrEqual(2.4);
    expect(evidence.reviewSamples(0.01, 30, []).flatMap((r) => r.times)).toEqual(expect.arrayContaining([0]));
  });
});

describe('art direction is not a measured defect', () => {
  it('leaves flat graphics, silence and ending choices to the brief and visual review', () => {
    const { doc } = project('Flat loop');
    doc.compositions[doc.root].layers = { bg: { type: 'shape.rect', props: { size: [1920, 1080], fill: '#fff' } } };
    const issues = doneIssues(doc, doc.root, builtinRegistry(), plan(), []);
    expect(issues.filter((i) => i.blocking)).toEqual([]);
  });

  it('still blocks provisional content and measured unreadable text', () => {
    const { doc } = project('Draft');
    doc.compositions[doc.root].layers = { title: { type: 'text', props: { text: 'TODO', size: 12 } } };
    const issues = doneIssues(doc, doc.root, builtinRegistry(), null, [{ check: 'text-size', severity: 'warning', message: 'Too small', layers: ['title'] }]);
    expect(issues.filter((i) => i.blocking).map((i) => i.id)).toEqual(['provisional', 'readable']);
  });
});
