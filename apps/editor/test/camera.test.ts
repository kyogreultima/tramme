import { describe, expect, it } from 'vitest';
import { applyOps, validate, type Layer, type ToolContext, type ToolOutput, type TrammeDoc } from '@tramme/core';
import { builtinRegistry } from '@tramme/nodes';
import { newProject } from '@tramme/project';
import { CAMERA_TOOLS, pushFraming } from '../src/camera.ts';

const frame = { width: 1920, height: 1080 };
const reg = builtinRegistry();

describe('the framing of a push', () => {
  it('fills the limiting side, and is held at the most it may zoom', () => {
    const f = pushFraming({ x: 860, y: 490, w: 200, h: 100 }, frame, { fill: 0.6 })!;
    expect(f.zoom).toBe(3);
    expect(f.pan).toEqual([0, 0]);
    const wide = pushFraming({ x: 460, y: 340, w: 1000, h: 400 }, frame, { fill: 0.6 })!;
    // 1000 px wide on a 1920 frame: 0.6 of the width is 1152, a zoom of about 1.15
    expect(wide.zoom).toBeCloseTo((0.6 * 1920) / 1000, 5);
  });

  it('never zooms less than a push should', () => {
    expect(pushFraming({ x: 100, y: 100, w: 1700, h: 800 }, frame, { fill: 0.6 })!.zoom).toBe(1.1);
  });

  it('is raised until the smallest text reads, when it can be', () => {
    const base = pushFraming({ x: 560, y: 440, w: 800, h: 200 }, frame, { fill: 0.6 })!.zoom;
    const read = pushFraming({ x: 560, y: 440, w: 800, h: 200 }, frame, { fill: 0.6, minText: 40, smallest: 12, maxZoom: 6 })!;
    expect(base).toBeLessThan(40 / 12);
    expect(read.zoom).toBeGreaterThanOrEqual(40 / 12);
    // at most a twentieth of the frame's height is asked of a text
    const capped = pushFraming({ x: 560, y: 440, w: 800, h: 200 }, frame, { fill: 0.6, minText: 400, smallest: 10, maxZoom: 6 })!;
    expect(capped.zoom).toBeCloseTo((0.05 * 1080) / 10, 5);
  });

  it('keeps the frame inside the composition: a detail at the edge is not centred', () => {
    const f = pushFraming({ x: 1720, y: 490, w: 200, h: 100 }, frame, { fill: 0.6 })!;
    expect(f.zoom).toBe(3);
    expect(f.pan[0]).toBeCloseTo(1920 / 2 - 1920 / 6, 6);
    expect(f.pan[1]).toBeCloseTo(0, 6);
  });

  it('is nothing for a detail off the frame, or larger than it', () => {
    expect(pushFraming({ x: 2000, y: 100, w: 100, h: 100 }, frame, { fill: 0.6 })).toBeNull();
    expect(pushFraming({ x: -100, y: -100, w: 2200, h: 1300 }, frame, { fill: 0.6 })).toBeNull();
  });
});

describe('the push-in tool', () => {
  const project = (camera = false): TrammeDoc => {
    const doc = newProject({ name: 'Push', width: 1920, height: 1080, fps: 30, duration: 12 }).doc;
    const c = doc.compositions[doc.root];
    c.layers = {
      price: { type: 'shape.rect', props: { size: [300, 120] }, transform: { position: [1300, 600] } } as Layer,
      hidden: { type: 'shape.rect', in: 8, props: { size: [300, 120] }, transform: { position: [600, 600] } } as Layer,
      away: { type: 'shape.rect', props: { size: [100, 100] }, transform: { position: [3000, 600] } } as Layer,
    };
    c.order = ['price', 'hidden', 'away'];
    if (camera) c.camera = { perspective: 1000, zoom: 1, pan: [0, 0] } as never;
    return doc;
  };
  const run = (doc: TrammeDoc, input: Record<string, unknown>) => CAMERA_TOOLS[0].run(input as never, { doc, compId: doc.root, time: 0, selection: [], registry: reg } as unknown as ToolContext) as Promise<ToolOutput>;
  const keys = (doc: TrammeDoc, prop: 'zoom' | 'pan') => (doc.compositions[doc.root].camera as unknown as Record<string, { $k: { t: number; v: unknown; ease?: unknown }[] }>)[prop].$k;

  it('adds a camera at the defaults, and keys the push, the hold and the way back', async () => {
    const doc = project(), out = await run(doc, { layer: 'price', at: 2, hold: 1 });
    const applied = applyOps(doc, out.ops!).doc;
    const zoom = keys(applied, 'zoom');
    expect(zoom).toHaveLength(4);
    expect(zoom[0]).toMatchObject({ t: 2, v: 1 });
    const length = zoom[1].t - 2;
    expect(length).toBeGreaterThanOrEqual(0.5);
    expect(zoom[1].v).toBeGreaterThan(1.1);
    expect(zoom[2].t).toBeCloseTo(2 + length + 1, 3);
    expect(zoom[2].v).toBe(zoom[1].v);
    expect(zoom[3].t).toBeCloseTo(2 + 2 * length + 1, 3);
    expect(zoom[3].v).toBe(1);
    // the pan reaches the detail's centre and comes back
    const pan = keys(applied, 'pan');
    expect(pan.map((k) => k.t)).toEqual(zoom.map((k) => k.t));
    expect(pan[0].v).toEqual([0, 0]);
    expect(pan[3].v).toEqual([0, 0]);
    expect((pan[1].v as number[])[0]).toBeGreaterThan(0);
    // eased: out on the push, in on the way back (the token's name when the document has one)
    expect(zoom[0].ease).toEqual([0.16, 1, 0.3, 1]);
    expect(validate(applied, reg)).toEqual([]);
  });

  it('uses the tokens of the project for its eases, and stays on the detail when it does not come back', async () => {
    const doc = project(true);
    doc.tokens = { ...doc.tokens, out: { type: 'ease', value: [0.2, 0, 0, 1] }, in: { type: 'ease', value: [0.7, 0, 0.84, 0] } };
    const applied = applyOps(doc, (await run(doc, { layer: 'price', at: 1, back: false })).ops!).doc;
    const zoom = keys(applied, 'zoom');
    expect(zoom).toHaveLength(3);
    expect(zoom[0].ease).toBe('@out');
    expect(validate(applied, reg)).toEqual([]);
  });

  it('says so and proposes nothing for a layer off the frame, hidden at that time, or missing', async () => {
    for (const [layer, at] of [['away', 1], ['hidden', 1]] as const) {
      const out = await run(project(), { layer, at });
      expect(out.ops ?? []).toEqual([]);
      expect(out.text).toMatch(/nothing was proposed/i);
    }
    await expect(run(project(), { layer: 'nope', at: 1 })).rejects.toThrow(/nope/);
  });
});
