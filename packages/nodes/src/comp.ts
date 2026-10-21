// A composition inside another one. Its frame is centred on the layer
// origin; its own time runs from `start` at the layer's in point, at `speed`,
// optionally looping; `remap` (often an expression) gives the local time
// directly.

import { instanceTime, nestedTime, type Instance, type NestedTiming, type NodeType, type Placement } from '@tramme/core';

/**
 * Set by the Evaluator: $instance, how this layer reads the composition when
 * it is a component (its parameters, its overrides); $instances, the
 * instances of a distribution, each with its place
 */
interface CompProps extends NestedTiming { comp: string | null; crop: boolean; $instance?: Instance; $instances?: ({ instance: Instance } & Placement)[] }

/** where each instance's frame lies (one centred frame without a distribution) */
const frames = (p: CompProps): Placement[] => p.$instances ?? [{ at: [0, 0], rotation: 0 }];

/** local time of the nested composition (the checks read it the same way: core's nestedTime) */
export const localTime = nestedTime;

export const comp: NodeType<CompProps> = {
  type: 'comp', title: 'Composition', category: 'Structure',
  description: 'another composition of the document, with its own time',
  props: {
    comp: { type: 'comp', default: null, nullable: true, label: 'Composition', animatable: false },
    start: { type: 'number', default: 0, step: 0.01, unit: 's', label: 'Start', description: 'local time at the layer\'s in point' },
    speed: { type: 'number', default: 1, step: 0.05, unit: 'x', label: 'Speed' },
    loop: { type: 'bool', default: false, label: 'Loop' },
    remap: { type: 'number', default: null, nullable: true, step: 0.01, unit: 's', label: 'Time override', description: 'overrides start and speed (often an expression)' },
    crop: { type: 'bool', default: true, label: 'Crop to frame' },
  },
  path(p, host) {
    const s = p.comp ? host.compositionSize?.(p.comp) : null;
    if (!s) return null;
    const r = new Path2D();
    for (const f of frames(p)) {
      const one = new Path2D();
      one.rect(-s.width / 2, -s.height / 2, s.width, s.height);
      r.addPath(one, new DOMMatrix().translate(f.at[0], f.at[1]).rotate(f.rotation));
    }
    return r;
  },
  bounds(p, host) {
    const s = p.comp ? host.compositionSize?.(p.comp) : null;
    if (!s) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const f of frames(p)) {
      // the frame turned: the box around its corners
      const a = (f.rotation * Math.PI) / 180, c = Math.abs(Math.cos(a)), sn = Math.abs(Math.sin(a));
      const hw = (s.width * c + s.height * sn) / 2, hh = (s.width * sn + s.height * c) / 2;
      x0 = Math.min(x0, f.at[0] - hw); x1 = Math.max(x1, f.at[0] + hw); y0 = Math.min(y0, f.at[1] - hh); y1 = Math.max(y1, f.at[1] + hh);
    }
    return x0 <= x1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  },
  render: {
    canvas2d(ctx, p, host) {
      if (!p.comp || !host.drawComposition || !host.compositionSize) return;
      const s = host.compositionSize(p.comp);
      if (!s) return;
      const lt = localTime(p, host.t, host.layerIn ?? 0, s.duration);
      const draw = (inst?: Instance, at = lt) => {
        ctx.translate(-s.width / 2, -s.height / 2);
        if (p.crop) { ctx.beginPath(); ctx.rect(0, 0, s.width, s.height); ctx.clip(); }
        host.drawComposition!(ctx, p.comp!, at, inst);
      };
      if (!p.$instances) return draw(p.$instance);
      // the instances in order, the first at the bottom
      for (const one of p.$instances) {
        ctx.save();
        ctx.translate(one.at[0], one.at[1]);
        if (one.rotation) ctx.rotate((one.rotation * Math.PI) / 180);
        draw(one.instance, instanceTime(lt, one, s.duration));
        ctx.restore();
      }
    },
  },
};

