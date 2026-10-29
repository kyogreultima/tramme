// Pinning a picture on four corners: a corner-pin effect on a layer, with the
// corners given (a screen on a monitor in the footage) or following another
// layer (a picture riding a card that turns). The render draws the layer
// alone and carries its box onto the corners in perspective (fx.pin).

import { DEFAULT_PERSPECTIVE, Evaluator, layerQuad, pointer, type Op, type Quad, type ToolContext, type ToolType, type Vec2 } from '@tramme/core';

interface Input { layer: string; corners?: [Vec2, Vec2, Vec2, Vec2]; onto?: string; from?: number; to?: number }

const CORNERS = ['tl', 'tr', 'br', 'bl'] as const;
/** a key every tenth of a second */
const STEP = 0.1;

/** the quad of a layer of the root composition at a time: where its box lands on screen, tilt and camera included */
export function quadAt(ev: Evaluator, compId: string, id: string, t: number): Quad {
  const frame = ev.frame(t, compId), L = frame.layers.find((x) => x.id === id);
  if (!L) throw new Error(`${id}: not drawn at ${t.toFixed(2)} s (outside its in and out points, or hidden)`);
  const host = { layerId: id, t, frame: Math.round(t * frame.comp.fps), fps: frame.comp.fps, width: frame.comp.width, height: frame.comp.height, duration: frame.comp.duration, asset: () => null, assetInfo: () => undefined, assetUrl: () => '' };
  let box = null;
  try { box = L.node.bounds?.(L.props, host as never) ?? null; } catch { box = null; }
  const size = L.props.size as Vec2 | undefined;
  box ??= size ? { x: -size[0] / 2, y: -size[1] / 2, w: size[0], h: size[1] } : null;
  if (!box) throw new Error(`${id}: a layer with no size cannot be followed`);
  return layerQuad(L, box, [1, 0, 0, 1, 0, 0], frame.camera?.perspective ?? DEFAULT_PERSPECTIVE);
}

const pin: ToolType<Input> = {
  name: 'pin', title: 'Pin on four corners', description: "pins a layer's picture on four corners in perspective (a corner-pin effect): the corners given, or those of another layer followed over time (a picture riding a card, a screen on a monitor)",
  input: {
    type: 'object',
    properties: {
      layer: { type: 'string', title: 'Layer', description: 'the layer to pin' },
      corners: { type: 'array', title: 'Corners', description: 'top left, top right, bottom right, bottom left, each [x, y] in composition pixels', items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, minItems: 4, maxItems: 4 },
      onto: { type: 'string', title: 'Onto', description: "another layer to follow: the four corners are keyed from its quad (its position, scale, rotation and tilts) every tenth of a second" },
      from: { type: 'number', minimum: 0, title: 'From (s)', description: "with onto: the start; the followed layer's in point by default" },
      to: { type: 'number', minimum: 0, title: 'To (s)', description: "with onto: the end; its out point by default" },
    },
    required: ['layer'],
  },
  ai: {
    when: 'a picture or footage must sit on a surface that turns or is already in perspective: a screen on a monitor, a poster on a wall, an image riding a card; tilt a layer (rotationX, rotationY) when no surface is involved',
    avoid: 'pinning a layer onto itself; pins on everything: a pin is for a surface, not for style',
  },
  async run(a, ctx: ToolContext) {
    const comp = ctx.doc.compositions[ctx.compId], layer = comp.layers[a.layer];
    if (!layer) throw new Error(`${a.layer}: no such layer in the composition`);
    if (a.onto === a.layer) throw new Error(`${a.layer} cannot be pinned onto itself`);
    if (!a.corners && !a.onto) throw new Error('say the corners (four points) or the layer to follow (onto)');
    let props: Record<string, unknown>;
    let said: string;
    if (a.corners) {
      props = Object.fromEntries(CORNERS.map((k, i) => [k, a.corners![i]]));
      said = 'on the four corners given';
    } else {
      const target = comp.layers[a.onto!];
      if (!target) throw new Error(`${a.onto}: no such layer in the composition`);
      const from = a.from ?? target.in ?? 0, to = Math.min(comp.duration, a.to ?? target.out ?? comp.duration);
      if (!(to > from)) throw new Error(`${a.onto}: nothing to follow between ${from} and ${to} s`);
      const ev = new Evaluator(ctx.doc, ctx.registry), n = Math.ceil((to - from) / STEP - 1e-9);
      const keys: Record<(typeof CORNERS)[number], { t: number; v: Vec2 }[]> = { tl: [], tr: [], br: [], bl: [] };
      for (let i = 0; i <= n; i++) {
        // the last key lands on the end (the last step may be shorter)
        const t = +Math.min(to - 1e-4, from + i * STEP).toFixed(4);
        const q = quadAt(ev, ctx.compId, a.onto!, t);
        CORNERS.forEach((k, j) => keys[k].push({ t: i === n ? +to.toFixed(4) : t, v: [+q[j][0].toFixed(2), +q[j][1].toFixed(2)] }));
      }
      props = Object.fromEntries(CORNERS.map((k) => [k, { $k: keys[k] }]));
      said = `following "${a.onto}" from ${from.toFixed(2)} s to ${to.toFixed(2)} s (${n + 1} keys a corner)`;
    }
    const had = layer.effects?.findIndex((e) => e.type === 'fx.pin') ?? -1;
    const fx = { id: 'pin', type: 'fx.pin', props };
    const base = pointer('compositions', ctx.compId, 'layers', a.layer, 'effects');
    const ops: Op[] = had >= 0
      ? [{ op: 'replace', path: pointer('compositions', ctx.compId, 'layers', a.layer, 'effects', String(had)), value: { ...layer.effects![had], props } }]
      : layer.effects ? [{ op: 'add', path: `${base}/-`, value: fx }] : [{ op: 'add', path: base, value: [fx] }];
    return { ops, label: `Pin ${a.layer}`, text: `"${a.layer}" is pinned ${said}: its picture is carried onto the corners in perspective. Look at a still to check the edges.` };
  },
};

export const PIN_TOOLS: ToolType[] = [pin as unknown as ToolType];
