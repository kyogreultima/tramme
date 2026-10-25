// SVG to paths: a logo or an icon becomes a group of ordinary path layers
// with their fills and strokes, so its strokes can draw themselves with the
// trim and every vertex stays editable. One contour per layer, the kit's
// curves for the draw-on.

import type { ToolType } from '@tramme/core';
import { readSvg } from '@tramme/interop';
import { adder } from './templates.ts';
import { compOf, r, style } from './recipes.ts';

const svgPaths: ToolType<{
  asset: string;
  at?: number;
  scale?: number;
  width?: number;
  drawOn?: boolean | 'auto';
  name?: string;
}> = {
  name: 'svg-paths', title: 'SVG to paths',
  description: 'turns an SVG in the assets (a logo, an icon, a drawing) into a group of editable path layers with their fills and strokes, so its strokes can draw themselves with the trim',
  input: {
    type: 'object',
    properties: {
      asset: { type: 'string', format: 'asset', assetType: 'image', title: 'SVG' },
      at: { type: 'number', minimum: 0, title: 'Start (s)', description: 'when the draw-on begins' },
      scale: { type: 'number', minimum: 0.01, title: 'Scale' },
      width: { type: 'number', minimum: 8, title: 'Fit width (px)', description: 'the drawing is scaled to this width in the composition' },
      drawOn: { type: ['boolean', 'string'], enum: ['auto'], title: 'Draw on', description: 'auto (the default): the strokes without a fill draw themselves; true: every stroke does; false: none' },
      name: { type: 'string', title: 'Name' },
    },
    required: ['asset'],
  },
  ai: {
    when: 'a logo or an icon given as an SVG that has to move: each contour becomes its own layer, so parts can enter one after another and strokes can draw themselves; the layers keep the SVG\'s colours',
    avoid: 'an SVG of gradients or embedded pictures (they are left out and reported); a very large file: hundreds of contours make hundreds of layers',
    example: { asset: 'logo', width: 480, drawOn: 'auto' },
  },
  run(a, ctx) {
    const asset = ctx.doc.assets[a.asset];
    if (!asset) throw new Error(`unknown asset: ${a.asset}`);
    return (async () => {
      const text = await ctx.readText(asset.src);
      if (!text) throw new Error(`"${asset.src}" is not a text file of the project`);
      const { shapes, width, height, warnings } = readSvg(text);
      if (!shapes.length) throw new Error(`the SVG holds no path${warnings.length ? ` (${warnings.join('; ')})` : ''}`);
      const c = compOf(ctx), doc = ctx.doc, s = style(doc), at = r(a.at ?? ctx.time);
      const fit = a.width && a.width > 0 ? a.width / width : a.scale && a.scale > 0 ? a.scale : Math.min((c.width * 0.8) / width, (c.height * 0.8) / height);
      const { add, done } = adder(doc, ctx.compId);
      // the draw-on: the strokes without a fill (auto), every stroke, or none; one after the other, a little uneven
      const mode = a.drawOn === undefined ? 'auto' : String(a.drawOn);
      const drawables = shapes.filter((sh) => sh.stroke && sh.strokeWidth !== 0 && (mode === 'true' || (mode === 'auto' && !sh.fill)));
      const pace = Math.min(0.8, Math.max(0.4, (typeof s.pace === 'number' ? s.pace : 0.7) * 0.8));
      const stagger = typeof s.stagger === 'number' ? s.stagger : 0.07;
      const jitter = [1, 1.35, 0.8, 1.15, 0.9, 1.2, 1.05, 0.85];
      const enter = s.enter;
      let drawn = 0;
      const ids: string[] = [];
      for (const [k, sh] of shapes.entries()) {
        const props: Record<string, unknown> = { path: sh.path, fill: sh.fill ?? null, stroke: sh.stroke ?? null };
        if (sh.stroke) {
          props.strokeWidth = sh.strokeWidth ?? 2;
          if (sh.lineCap) props.lineCap = sh.lineCap;
          if (sh.lineJoin) props.lineJoin = sh.lineJoin;
        }
        if (drawables.includes(sh)) {
          const d = drawn++;
          const span = pace * jitter[d % jitter.length];
          props.trimStart = 0;
          props.trimEnd = { $k: [{ t: r(at + d * stagger * 3), v: 0, ease: enter }, { t: r(at + d * stagger * 3 + span), v: 1 }] };
        }
        ids.push(add(`svg-${k + 1}`, { type: 'shape.path', name: sh.id ?? `Path ${k + 1}`, in: at, props }, false));
      }
      const gid = add(a.name ?? asset.name ?? 'SVG', {
        type: 'group', name: a.name ?? asset.name ?? 'SVG',
        transform: { anchor: [r(width / 2), r(height / 2)], position: [r(c.width / 2), r(c.height / 2)], scale: [r(fit), r(fit)] },
        children: ids,
      });
      const drawnNote = drawables.length ? `, ${drawables.length} stroke(s) drawing themselves from ${at} s` : '';
      const warn = warnings.length ? ` Left out: ${warnings.join('; ')}.` : '';
      return {
        ops: done(), label: a.name ?? asset.name ?? 'SVG to paths',
        text: `"${a.name ?? asset.name ?? a.asset}": ${shapes.length} contour(s) from ${r(width)}×${r(height)} px, at ×${r(fit)}, each a path layer of the group "${gid}"${drawnNote}.${warn} The contours keep the SVG's colours; edit them vertex by vertex, or keyframe their trim.`,
      };
    })();
  },
};

export const SVG_TOOLS: ToolType[] = [svgPaths];
