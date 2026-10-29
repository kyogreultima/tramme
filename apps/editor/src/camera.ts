// A camera with intent: push onto the detail that matters (a price, a button, a
// figure) and come back, keyed on the composition camera, with the framing
// kept readable. A pure function frames the detail; the tool keys the move.

import { Evaluator, quadBounds, sampleAt, pointer, type Op, type ToolContext, type ToolType, type Vec2 } from '@tramme/core';
import { quadAt } from './pin.ts';

interface Box { x: number; y: number; w: number; h: number }

/** the most a text is asked to read at: a twentieth of the frame's height */
const TEXT_SHARE = 0.05;
/** the zoom a screencast pack reads at, per second, so a push feels like its own */
const SPEED = 1.5;

/**
 * How the camera frames a detail: the zoom that makes it fill `fill` of the
 * frame on its limiting side (at least 1.1, at most `maxZoom`), raised when the
 * smallest text inside (`smallest`, px) would still be under `minText`, and the
 * pan that centres it without the frame leaving the composition. Null when
 * the detail is off the frame, or larger than it already.
 */
export function pushFraming(target: Box, frame: { width: number; height: number }, o: { fill: number; minText?: number; smallest?: number; maxZoom?: number }): { zoom: number; pan: Vec2 } | null {
  const { width: W, height: H } = frame, maxZoom = o.maxZoom ?? 3;
  if (target.w <= 0 || target.h <= 0 || target.w > W || target.h > H) return null;
  if (target.x + target.w <= 0 || target.x >= W || target.y + target.h <= 0 || target.y >= H) return null;
  let zoom = o.fill * Math.min(W / target.w, H / target.h);
  if (o.minText && o.smallest && o.smallest > 0) zoom = Math.max(zoom, Math.min(o.minText, TEXT_SHARE * H) / o.smallest);
  zoom = Math.min(maxZoom, Math.max(1.1, zoom));
  // the frame at this zoom shows W / zoom of the composition: the pan stays where it does not look past the edge
  const lx = W / 2 - W / (2 * zoom), ly = H / 2 - H / (2 * zoom);
  const clamp = (v: number, l: number) => Math.max(-l, Math.min(l, v));
  return { zoom, pan: [clamp(target.x + target.w / 2 - W / 2, lx), clamp(target.y + target.h / 2 - H / 2, ly)] };
}

interface Input { layer: string; at: number; hold?: number; back?: boolean; fill?: number }

const r4 = (n: number) => +n.toFixed(4);

const pushIn: ToolType<Input> = {
  name: 'push-in', title: 'Push in', description: 'pushes the composition camera onto a layer (a price, a button, a figure) and, by default, back: keyed on the camera, framed so the detail fills most of the screen and its text reads',
  input: {
    type: 'object',
    properties: {
      layer: { type: 'string', title: 'Layer', description: 'the detail to push onto' },
      at: { type: 'number', minimum: 0, title: 'At (s)', description: 'when the push starts' },
      hold: { type: 'number', minimum: 0, title: 'Hold (s)', description: 'how long the camera stays on it: 1.2 by default' },
      back: { type: 'boolean', title: 'Back', description: 'come back to where the camera was (yes by default)' },
      fill: { type: 'number', minimum: 0.2, maximum: 0.95, title: 'Fill', description: "the share of the frame the detail fills: 0.6 by default" },
    },
    required: ['layer', 'at'],
  },
  ai: {
    when: 'a built scene has one detail that must be seen (a price, a button, a figure, a name): bring it close, hold, and come back. A composition with no camera gets one at the defaults, so nothing moves before the push',
    avoid: 'a push on every scene; a push on footage (the screencast pack zooms a recording on its own); a push onto something already large',
  },
  async run(a, ctx: ToolContext) {
    const comp = ctx.doc.compositions[ctx.compId];
    if (!comp.layers[a.layer]) throw new Error(`${a.layer}: no such layer in the composition`);
    const none = (why: string) => ({ ops: [] as Op[], text: `${a.layer} ${why}: nothing was proposed.` });
    const ev = new Evaluator(ctx.doc, ctx.registry);
    let target: Box;
    try { target = quadBounds(quadAt(ev, ctx.compId, a.layer, a.at)); } catch (e) { return none(`cannot be pushed onto at ${a.at.toFixed(2)} s (${(e as Error).message})`); }
    // the smallest text inside the detail, so it reads when the camera is there
    const inside = sampleAt(ev, ctx.compId, a.at).layers.filter((p) => p.textSize && p.textSize > 0 && p.box && p.box.x + p.box.w / 2 >= target.x && p.box.x + p.box.w / 2 <= target.x + target.w && p.box.y + p.box.h / 2 >= target.y && p.box.y + p.box.h / 2 <= target.y + target.h);
    const smallest = inside.length ? Math.min(...inside.map((p) => p.textSize!)) : undefined;
    const framing = pushFraming(target, comp, { fill: a.fill ?? 0.6, minText: Math.round(Math.min(comp.width, comp.height) * 0.03), smallest });
    if (!framing) return none('is off the frame, or already larger than it');
    const cam = ev.frame(a.at, ctx.compId).camera, z0 = cam?.zoom ?? 1, p0 = cam?.pan ?? [0, 0];
    const length = Math.max(0.5, (framing.zoom - z0) / SPEED), hold = a.hold ?? 1.2, back = a.back ?? true;
    const token = (n: string) => ctx.doc.tokens?.[n]?.type === 'ease';
    const ease = { out: token('out') ? '@out' : [0.16, 1, 0.3, 1], in: token('in') ? '@in' : [0.7, 0, 0.84, 0] };
    const times = [a.at, a.at + length, a.at + length + hold, a.at + 2 * length + hold].map(r4);
    const rows: [number, number, Vec2, unknown][] = [[times[0], z0, p0 as Vec2, ease.out], [times[1], framing.zoom, framing.pan, undefined], [times[2], framing.zoom, framing.pan, ease.in], [times[3], z0, p0 as Vec2, undefined]];
    const used = rows.slice(0, back ? 4 : 3);
    const key = (pick: (r: (typeof rows)[number]) => unknown) => ({ $k: used.map((r) => ({ t: r[0], v: pick(r), ...(r[3] ? { ease: r[3] } : {}) })) });
    const zoom = key((r) => +r[1].toFixed(4)), pan = key((r) => [+r[2][0].toFixed(2), +r[2][1].toFixed(2)]);
    const ops: Op[] = comp.camera
      ? [{ op: 'add', path: pointer('compositions', ctx.compId, 'camera', 'zoom'), value: zoom }, { op: 'add', path: pointer('compositions', ctx.compId, 'camera', 'pan'), value: pan }]
      : [{ op: 'add', path: pointer('compositions', ctx.compId, 'camera'), value: { perspective: 1000, zoom, pan } }];
    return {
      ops, label: `Push in on ${a.layer}`,
      text: `The camera pushes onto "${a.layer}" at ${a.at.toFixed(2)} s: zoom ${framing.zoom.toFixed(2)} in ${length.toFixed(2)} s${smallest ? ` (its smallest text reads ${Math.round(smallest * framing.zoom)} px)` : ''}, held ${hold} s${back ? `, then back over ${length.toFixed(2)} s` : ', and stays there'}.${comp.camera ? ' The camera\'s own zoom and pan keys are replaced.' : ' The composition had no camera: one is added at the defaults.'} Look at the strip of the move (motion).`,
    };
  },
};

export const CAMERA_TOOLS: ToolType[] = [pushIn as unknown as ToolType];
