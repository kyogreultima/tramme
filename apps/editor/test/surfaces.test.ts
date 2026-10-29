import { describe, expect, it } from 'vitest';
import { applyOps, validate, type ToolContext, type ToolOutput, type TrammeDoc } from '@tramme/core';
import { newProject } from '@tramme/project';
import { SURFACES, SURFACE_TOOLS, type SurfaceKind } from '../src/surfaces.ts';
import { editorRegistry } from '../src/vocabulary.ts';

const reg = editorRegistry();
const kinds = Object.keys(SURFACES) as SurfaceKind[];
const tool = SURFACE_TOOLS[0];

function project(w = 1080, h = 1920, tokens = true): TrammeDoc {
  const doc = newProject({ name: 'Surface', width: w, height: h, fps: 30, duration: 8 }).doc;
  if (tokens) doc.tokens = { ...doc.tokens, plate: { type: 'color', value: '#101820' }, accent: { type: 'color', value: '#F2AA4C' } };
  return doc;
}
const run = (doc: TrammeDoc, input: Record<string, unknown>) => tool.run(input as never, { doc, compId: doc.root, time: 0, selection: [], registry: reg } as unknown as ToolContext) as Promise<ToolOutput>;

describe('the surface presets', () => {
  it('are nine, each with a shade function and the line of when it fits', () => {
    expect(kinds).toEqual(['grain', 'paper', 'halftone', 'gradient', 'glow', 'ribbons', 'grid', 'bokeh', 'caustics']);
    for (const k of kinds) {
      expect(SURFACES[k].code, k).toContain('vec4 shade(vec2 uv)');
      expect(SURFACES[k].line.length, k).toBeGreaterThan(20);
    }
  });

  it('use only the uniforms the node gives', () => {
    const allowed = new Set(['uTime', 'uSize', 'uColorA', 'uColorB', 'uParams']);
    for (const k of kinds) for (const u of SURFACES[k].code.match(/\bu[A-Z]\w*/g) ?? []) expect(allowed.has(u), `${k}: ${u}`).toBe(true);
  });

  it('are pure functions of time: no clock, no random state, no window coordinates', () => {
    for (const k of kinds) for (const bad of ['Date', 'random(', 'gl_FragCoord']) expect(SURFACES[k].code, `${k}: ${bad}`).not.toContain(bad);
  });

  it('read the size of the layer when they draw a pattern in pixels, so no format is assumed', () => {
    for (const k of ['grain', 'halftone', 'grid', 'paper'] as const) expect(SURFACES[k].code, k).toContain('uSize');
    for (const k of kinds) expect(SURFACES[k].code, k).not.toMatch(/16\.0\s*\/\s*9\.0|1\.7778/);
  });
});

describe('the surface tool', () => {
  it('lays a glow over the content, in the palette, covering a vertical frame', async () => {
    const doc = project();
    const out = await run(doc, { kind: 'glow' });
    const applied = applyOps(doc, out.ops!).doc, c = applied.compositions[applied.root];
    const id = c.order.at(-1)!;
    expect(c.layers[id]).toMatchObject({ type: 'shader', blend: 'add', transform: { position: [540, 960] }, props: { size: [1080, 1920], colorA: '@plate', colorB: '@accent' } });
    expect(validate(applied, reg)).toEqual([]);
  });

  it('lays paper under the content, with the normal blend', async () => {
    const doc = project(1080, 1080);
    const applied = applyOps(doc, (await run(doc, { kind: 'paper' })).ops!).doc, c = applied.compositions[applied.root];
    expect(c.layers[c.order[0]]).toMatchObject({ type: 'shader', blend: 'normal', props: { size: [1080, 1080] } });
    expect(validate(applied, reg)).toEqual([]);
  });

  it('puts the amount and the speed in the first two settings, and its own colours without tokens', async () => {
    const doc = project(1920, 1080, false);
    const applied = applyOps(doc, (await run(doc, { kind: 'gradient', colors: ['#112233', '#ffcc00'], amount: 0.8, speed: 2 })).ops!).doc, c = applied.compositions[applied.root];
    expect(c.layers[c.order[0]].props).toMatchObject({ colorA: '#112233', colorB: '#ffcc00', p1: 0.8, p2: 2 });
    const plain = applyOps(doc, (await run(doc, { kind: 'grain' })).ops!).doc;
    expect(plain.compositions[plain.root].layers[plain.compositions[plain.root].order.at(-1)!].props.colorA).toBeDefined();
  });

  it('places it for a span of the film when asked', async () => {
    const doc = project();
    const applied = applyOps(doc, (await run(doc, { kind: 'bokeh', at: 2, duration: 3 })).ops!).doc, c = applied.compositions[applied.root];
    expect(c.layers[c.order.at(-1)!]).toMatchObject({ in: 2, out: 5 });
  });

  it('lists the kinds, and changes nothing, when none is named', async () => {
    const out = await run(project(), {});
    expect(out.ops ?? []).toEqual([]);
    for (const k of kinds) expect(out.text).toContain(SURFACES[k].line);
  });

  it('every kind lays a valid layer', async () => {
    for (const k of kinds) {
      const doc = project();
      expect(validate(applyOps(doc, (await run(doc, { kind: k })).ops!).doc, reg), k).toEqual([]);
    }
  });
});
