// The shipped plugin packs: each module registers cleanly, every node
// validates with its default props, the simulations are deterministic, and
// the pure helpers (scales, layouts, contrast, retiming) answer as documented.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Registry, validate, type TrammeDoc, type ToolContext } from '@tramme/core';
import { builtinRegistry } from '@tramme/nodes';
import { newProject } from '@tramme/project';
import { niceMax, barSlots, linePoints, donutArcs, seriesOf } from '../../../plugins/charts.js';
import { charState, bounce, lineStart } from '../../../plugins/kinetic.js';
import { parseColor, lum, contrast, flashRate } from '../../../plugins/a11y.js';
import { sentencesOf, retimed } from '../../../plugins/localize.js';
import { searchIcons, wordsOf } from '../../../plugins/icons.js';
import * as icons from '../../../plugins/icons.js';
import { parseDiagram, layoutDiagram, layoutKind, topoOrder } from '../../../plugins/diagram.js';
import * as diagram from '../../../plugins/diagram.js';
import * as charts from '../../../plugins/charts.js';
import * as kinetic from '../../../plugins/kinetic.js';
import * as a11y from '../../../plugins/a11y.js';
import * as physics from '../../../plugins/physics.js';
import * as styk from '../../../plugins/styk.js';
import * as walkthrough from '../../../plugins/walkthrough.js';
import * as localize from '../../../plugins/localize.js';

// the packs are JavaScript on purpose: their shape is checked at runtime by Registry.use, which these tests run
const PACKS = [charts, kinetic, a11y, physics, styk, icons, diagram, walkthrough, localize] as unknown as import('@tramme/core').PluginModule[];

describe('the packs register', () => {
  it('each module registers into a registry without error', () => {
    for (const mod of PACKS) {
      const reg = new Registry().use(mod, mod.meta?.name ?? 'x');
      expect(reg.hasNode('chart.bar')).toBe(mod === charts);
      expect(reg.hasNode('styk.figure')).toBe(mod === styk);
      expect(reg.listChecks().length).toBeGreaterThanOrEqual((mod.checks ?? []).length);
    }
  });

  it('every node validates with its default props', () => {
    for (const mod of PACKS) {
      const reg = builtinRegistry().clone().use(mod, mod.meta?.name ?? 'x');
      for (const node of mod.nodes ?? []) {
        const { doc } = newProject({ name: 'T', width: 1000, height: 600, fps: 30, duration: 3 });
        const props = Object.fromEntries(Object.entries(node.props).map(([k, d]) => [k, d.default]));
        doc.compositions[doc.root].layers.a = { type: node.type, props } as never;
        doc.compositions[doc.root].order = ['a'];
        const issues = validate(doc, reg);
        expect(issues, `${node.type}: ${JSON.stringify(issues)}`).toEqual([]);
      }
    }
  });

  it('every tool and check is well formed and named', () => {
    for (const mod of PACKS) {
      for (const tool of mod.tools ?? []) expect(tool.description.length).toBeGreaterThan(10);
      for (const check of mod.checks ?? []) expect(check.description.length).toBeGreaterThan(10);
    }
  });

  // what a pack may say about itself, translated (docs/packs-roadmap.md, "Complete when it lands"):
  // titles, labels and descriptions — the ai notes stay English, they speak to the assistant
  const stringsOf = (mod: import('@tramme/core').PluginModule): string[] => {
    const out: string[] = [];
    const prop = (name: string, d: { label?: string; description?: string }) => {
      if (d.label) out.push(d.label);
      if (d.description) out.push(d.description);
      void name;
    };
    for (const n of mod.nodes ?? []) {
      out.push(n.title);
      if (n.description) out.push(n.description);
      for (const [k, d] of Object.entries(n.props)) prop(k, d as never);
    }
    for (const e of mod.effects ?? []) {
      out.push(e.title);
      if (e.description) out.push(e.description);
      for (const [k, d] of Object.entries(e.props)) prop(k, d as never);
    }
    for (const m of mod.modifiers ?? []) {
      out.push(m.title, m.description);
      for (const [k, d] of Object.entries(m.params)) prop(k, d as never);
    }
    for (const t of mod.tools ?? []) { if (t.title) out.push(t.title); out.push(t.description); }
    for (const c of mod.checks ?? []) { if (c.title) out.push(c.title); out.push(c.description); }
    for (const k of mod.kits ?? []) { if (k.title) out.push(k.title); out.push(k.description); }
    for (const p of mod.presets ?? []) { if (p.title) out.push(p.title); if (p.description) out.push(p.description); }
    return out;
  };

  it('every pack of the index registers, validates and speaks French', async () => {
    const index: { file: string; name: string }[] = JSON.parse(readFileSync(new URL('../../../plugins/index.json', import.meta.url), 'utf8'));
    const modules = (import.meta as ImportMeta & { glob: (p: string, o: { eager: true }) => Record<string, unknown> }).glob('../../../plugins/*.js', { eager: true }) as Record<string, { meta?: { name?: string } } & import('@tramme/core').PluginModule>;
    expect(index.length).toBeGreaterThanOrEqual(PACKS.length);
    for (const entry of index) {
      const mod = modules[`../../../plugins/${entry.file}`];
      expect(mod, `${entry.file}: listed in the index but missing`).toBeTruthy();
      // registered: its names never clash with the built-in vocabulary or each other
      const reg = builtinRegistry().clone().use(mod as never, entry.file);
      expect(reg.listNodes().length + reg.listTools().length + reg.listChecks().length).toBeGreaterThan(0);
      // every node validates with its default props
      for (const node of mod.nodes ?? []) {
        const { doc } = newProject({ name: 'T', width: 1000, height: 600, fps: 30, duration: 3 });
        const props = Object.fromEntries(Object.entries(node.props).map(([k, d]) => [k, d.default]));
        doc.compositions[doc.root].layers.a = { type: node.type, props } as never;
        doc.compositions[doc.root].order = ['a'];
        const issues = validate(doc, reg);
        expect(issues, `${entry.file} ${node.type}: ${JSON.stringify(issues)}`).toEqual([]);
      }
      // the interface strings carry their French
      const fr = (mod.messages as { fr?: Record<string, string> } | undefined)?.fr ?? {};
      const missing = stringsOf(mod).filter((s) => !(s in fr));
      expect(missing, `${entry.file}: not translated: ${missing.slice(0, 8).join(' | ')}${missing.length > 8 ? ` (+${missing.length - 8})` : ''}`).toEqual([]);
    }
  });
});

describe('charts', () => {
  it('the scale rounds up to a readable grid', () => {
    expect(niceMax(370)).toBe(400);
    expect(niceMax(0)).toBe(1);
    expect(niceMax(1200)).toBe(1500);
    expect(niceMax(-5)).toBe(1);
  });

  it('the bars sit centred in their slots', () => {
    const { slot, barW, x } = barSlots(400, 4);
    expect(slot).toBe(100);
    expect(barW).toBeCloseTo(62);
    expect(x(0)).toBeCloseTo(19);
    expect(x(3)).toBeCloseTo(319);
  });

  it('the line spans the plot, top at max', () => {
    const pts = linePoints(300, 100, [0, 50, 100], 100);
    expect(pts[0]).toEqual([0, 100]);
    expect(pts[2]).toEqual([300, 0]);
    expect(linePoints(300, 100, [], 1)).toEqual([]);
  });

  it('the donut slices sum to a full turn', () => {
    const arcs = donutArcs([1, 1, 2]);
    expect(arcs[0].share).toBeCloseTo(0.25);
    expect(arcs[2].a1 - arcs[0].a0).toBeCloseTo(Math.PI * 2);
    expect(arcs[0].a0).toBeCloseTo(-Math.PI / 2);
  });

  it('the data comes from the values, normalised', () => {
    expect(seriesOf({ values: [{ label: 'A', value: 1 }, { label: 'B', value: 'x' }] }, {} as never)).toEqual([{ label: 'A', value: 1 }]);
    expect(seriesOf({ values: null, data: 'd' }, { asset: () => ({ series: [{ label: 'X', value: 3 }] }) } as never)).toEqual([{ label: 'X', value: 3 }]);
  });
});

describe('kinetic type', () => {
  it('the characters land in their order and hold', () => {
    expect(charState('typewriter', 0, 0, 0).a).toBe(0);
    expect(charState('typewriter', 0.5, 0, 0).a).toBe(1);
    expect(charState('typewriter', 1, 0, 0).a).toBe(1);
    // the wave keeps breathing after it lands: it moves with the clock
    expect(charState('wave', 1, 0, 0).dy).not.toBe(charState('wave', 1, 0, 1.2).dy);
  });

  it('the scatter starts from a place and settles at rest, the same every time', () => {
    const a = charState('scatter', 0, 3, 0), b = charState('scatter', 0, 3, 0);
    expect(a).toEqual(b);
    expect(charState('scatter', 1, 3, 0)).toEqual({ a: 1, dx: 0, dy: 0, rot: 0 });
  });

  it('the drop bounces and settles at the baseline', () => {
    expect(bounce(0)).toBe(0);
    expect(bounce(1)).toBeCloseTo(1);
    const mid = charState('drop', 0.4, 0, 0);
    expect(mid.dy).toBeLessThan(0);
    expect(charState('drop', 1, 0, 0).dy).toBeCloseTo(0);
  });

  it('the lines start where their align says', () => {
    const widths = [10, 10, 10];
    expect(lineStart(widths, 0, 'left', 100)).toBe(0);
    expect(lineStart(widths, 0, 'center', 100)).toBe(35);
    expect(lineStart(widths, 0, 'right', 100)).toBe(70);
  });
});

describe('accessibility checks', () => {
  it('reads the colours it knows, refuses the ones it does not', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255]);
    expect(parseColor('#FF8800')).toEqual([255, 136, 0]);
    expect(parseColor('rgba(10, 20, 30, 0.5)')).toEqual([10, 20, 30]);
    expect(parseColor('@ink')).toBeNull();
    expect(contrast('#FFFFFF', '#000000')).toBeCloseTo(21);
    expect(contrast('#FFFFFF', '#FFFFFF')).toBe(1);
    expect(contrast('#FFFFFF', '@ink')).toBeNull();
    expect(lum('#000000')).toBe(0);
  });

  it('counts the flashes of a series per second', () => {
    // on-off-on-off at 4 samples a second: 2 appearances a second
    const series = [0, 1, 0, 1, 0, 1, 0, 1, 0];
    expect(flashRate(series, 0.25)).toBeCloseTo(2);
    expect(flashRate([1, 1, 1], 0.25)).toBe(0);
  });
});

describe('stick figures', () => {
  it('the man stands symmetric: head above the hip, hands and feet mirrored', () => {
    const { parts, box } = styk.layoutOf(styk.MAN, {});
    expect(parts).toHaveLength(10);
    const footL = parts.find((p) => p.seg.id === 'legL2')!;
    const footR = parts.find((p) => p.seg.id === 'legR2')!;
    expect(footL.tx).toBeCloseTo(-footR.tx);
    expect(footL.ty).toBeCloseTo(footR.ty);
    expect(footL.ty).toBeGreaterThan(0);
    const head = parts.find((p) => p.seg.id === 'head')!;
    expect((head.sy + head.ty) / 2).toBeLessThan(0);
    expect(box!.h).toBeGreaterThan(200);
  });

  it('an IK target within reach is hit exactly, one beyond it clamps', () => {
    const hit = styk.layoutOf(styk.MAN, { armR2: { target: [60, -40] } }).parts.find((p) => p.seg.id === 'armR2')!;
    expect(hit.tx).toBeCloseTo(60);
    expect(hit.ty).toBeCloseTo(-40);
    const far = styk.layoutOf(styk.MAN, { armR2: { target: [500, 0] } }).parts.find((p) => p.seg.id === 'armR2')!;
    const shoulder = styk.layoutOf(styk.MAN, {}).parts.find((p) => p.seg.id === 'armR1')!.sy;
    expect(Math.hypot(far.tx, far.ty - shoulder)).toBeLessThanOrEqual(104 + 1e-3);
  });

  it('a stretched limb keeps its angle and grows its length', () => {
    const torso = styk.layoutOf(styk.MAN, { torso: { a: 0, l: 1.5 } }).parts.find((p) => p.seg.id === 'torso')!;
    expect(torso.len).toBeCloseTo(132);
    expect(torso.tx).toBeCloseTo(0);
  });

  it('the walk cycle loops: the last pose is the first, held key to key', () => {
    const walk = styk.walkPose();
    expect(walk.$k).toHaveLength(9);
    expect(walk.$k[0].t).toBe(0);
    expect(walk.$k[8].t).toBe(1);
    expect(walk.$k[8].v).toEqual(walk.$k[0].v);
    for (const key of walk.$k) expect(key.ease).toBe('hold');
    // two cycles carry on from where the first ended
    expect(styk.walkPose(2).$k[9].t).toBe(1);
  });

  it('the check says what a pose breaks, once per layer', () => {
    const placed = (props: object, name: string) => ({ id: name.toLowerCase(), layer: { name, type: 'styk.figure' }, node: { type: 'styk.figure' }, props, opacity: 1, box: null });
    const ctx = {
      doc: {}, compId: 'main', comp: {}, registry: null, evaluator: null, step: 0.25,
      samples: [
        { t: 0, layers: [placed({ figure: styk.MAN, pose: { armL3: 10, legR2: { target: [900, 900] } } }, 'Fig')] },
        { t: 0.5, layers: [placed({ figure: styk.MAN, pose: { armL3: 10, legR2: { target: [900, 900] } } }, 'Fig')] },
      ],
    } as never;
    const issues = styk.checks[0].run(ctx) as { message: string }[];
    expect(issues).toHaveLength(2);
    expect(issues[0].message).toContain('armL3');
    expect(issues[1].message).toContain('legR2');
  });

  it('the tool adds the figure layer and its order entry', async () => {
    const { doc } = newProject({ name: 'T', width: 1280, height: 720, fps: 30, duration: 2 });
    const tool = styk.tools[0];
    const out = await tool.run({ figure: 'walker', name: 'Styker' } as never, {
      doc, compId: doc.root, registry: builtinRegistry(), time: 0, selection: [],
    } as never as ToolContext);
    const next = JSON.parse(JSON.stringify(doc)) as TrammeDoc;
    for (const op of out.ops as never[]) applyOp(next, op);
    const layer = next.compositions[next.root].layers.styk1!;
    expect(layer.type).toBe('styk.figure');
    expect((layer.props!.pose as { $k: unknown[] }).$k).toHaveLength(9);
    expect(next.compositions[next.root].order).toContain('styk1');
  });
});

describe('icons', () => {
  const data = JSON.parse(readFileSync(new URL('../../../plugins/icons/lucide.json', import.meta.url), 'utf8'));

  it('finds icons by name, tag and synonym, and nothing when the words say nothing', () => {
    expect(searchIcons(data, 'trending-up', 1)[0].name).toBe('trending-up');
    expect(searchIcons(data, 'shield-check', 1)[0].name).toBe('shield-check');
    expect(searchIcons(data, 'money', 6).map((x) => x.name)).toEqual(expect.arrayContaining(['banknote', 'wallet', 'coins']));
    expect(searchIcons(data, 'pulse', 6).map((x) => x.name)).toContain('activity');
    expect(searchIcons(data, 'zzzq', 5)).toEqual([]);
    expect(wordsOf('team work')).toContain('users');
  });

  it('lays a row and a grid whose operations validate, in both formats', async () => {
    const { doc } = newProject({ name: 'T', width: 1920, height: 1080, fps: 30, duration: 3 });
    const tool = icons.tools[0];
    const reg = builtinRegistry().clone().use(icons as never, 'icons.js');
    for (const [w, h, layout] of [[1920, 1080, 'row'], [1080, 1920, 'grid']] as [number, number, string][]) {
      doc.compositions.main.width = w;
      doc.compositions.main.height = h;
      const out = await tool.run({ icons: 'trending-up, shield-check, users', layout, size: 96 } as never, {
        doc, compId: 'main', time: 0, selection: [], registry: reg,
        packFile: async () => readFileSync(new URL('../../../plugins/icons/lucide.json', import.meta.url), 'utf8'),
      } as never as ToolContext);
      const next = JSON.parse(JSON.stringify(doc)) as TrammeDoc;
      for (const op of out.ops as never[]) applyOp(next, op);
      const issues = validate(next, reg);
      expect(issues, `${layout}: ${JSON.stringify(issues)}`).toEqual([]);
      const groups = Object.values(next.compositions.main.layers).filter((l) => l.type === 'group');
      expect(groups).toHaveLength(3);
      expect(groups.every((g) => g.name?.startsWith('icon:'))).toBe(true);
      expect(groups[0].children!.length).toBeGreaterThan(0);
    }
  });

  it('scales the stroke with the icon and draws it on with the trim', async () => {
    const { doc } = newProject({ name: 'T', width: 1280, height: 720, fps: 30, duration: 3 });
    const tool = icons.tools[0];
    const out = await tool.run({ icons: 'activity', size: 120 } as never, {
      doc, compId: 'main', time: 0, selection: [], registry: builtinRegistry(),
      packFile: async () => readFileSync(new URL('../../../plugins/icons/lucide.json', import.meta.url), 'utf8'),
    } as never as ToolContext);
    const next = JSON.parse(JSON.stringify(doc)) as TrammeDoc;
    for (const op of out.ops as never[]) applyOp(next, op);
    const contour = Object.values(next.compositions.main.layers).find((l) => l.type === 'shape.path')!;
    const group = Object.values(next.compositions.main.layers).find((l) => l.type === 'group')!;
    // the contours stay on the 24-unit grid: the group's scale carries the size, the stroke rides it
    expect(group.transform!.scale).toEqual([5, 5]);
    // anchored on the grid's centre: the icon sits centred on its place
    expect(group.transform!.anchor).toEqual([12, 12]);
    expect(contour.props!.strokeWidth).toBe(2);
    expect((contour.props!.trimEnd as { $k: unknown[] }).$k).toHaveLength(2);
    expect(contour.props!.trimStart).toBe(0);
  });

  it('lays the one icon asked for, not a contact sheet', async () => {
    const { doc } = newProject({ name: 'T', width: 1280, height: 720, fps: 30, duration: 3 });
    const out = await icons.tools[0].run({ icons: 'shield-check', count: 1 } as never, {
      doc, compId: 'main', time: 0, selection: [], registry: builtinRegistry(),
      packFile: async () => readFileSync(new URL('../../../plugins/icons/lucide.json', import.meta.url), 'utf8'),
    } as never as ToolContext);
    const next = JSON.parse(JSON.stringify(doc)) as TrammeDoc;
    for (const op of out.ops as never[]) applyOp(next, op);
    const layers = Object.values(next.compositions.main.layers);
    expect(layers.filter((l) => l.type === 'group').map((l) => l.name)).toEqual(['icon:shield-check']);
    expect(layers.some((l) => l.type === 'text')).toBe(false); // no sheet labels
  });

  it('draws the shipped circle round', () => {
    const [circle] = data.icons.circle.d as { v: [number, number][]; i: [number, number][]; o: [number, number][] }[];
    // the right point's handle leaves downwards, towards the bottom point that follows
    expect(circle.v[0]).toEqual([22, 12]);
    expect(circle.o[0][1]).toBeGreaterThan(0);
    expect(circle.i[0][1]).toBeLessThan(0);
  });
});

describe('diagrams', () => {
  it('the parser reads every form and names its errors', () => {
    const dia = parseDiagram('flowchart TB\nA[Pull] --> B(Build)\nB -->|ok| C\nA --- D\nD -.-> E\nsubgraph s [Zone]\nA\nB\nend');
    expect(dia.direction).toBe('TB');
    expect(dia.nodes.map((n) => `${n.id}:${n.label}:${n.shape}`)).toEqual(['A:Pull:rect', 'B:Build:round', 'C:C:rect', 'D:D:rect', 'E:E:rect']);
    expect(dia.edges.map((e) => `${e.from}${e.kind}${e.to}`)).toEqual(['AarrowB', 'BarrowC', 'AlineD', 'DdashedE']);
    expect(dia.edges[1].label).toBe('ok');
    expect(dia.groups[0]).toMatchObject({ id: 's', title: 'Zone' });
    expect(() => parseDiagram('flowchart XX\nA --> B')).toThrow(/line 1/);
    expect(() => parseDiagram('flowchart LR\nA -->')).toThrow(/line 2/);
    const json = parseDiagram({ direction: 'TB', nodes: [{ id: 'a', label: 'One' }, { id: 'b' }], edges: [{ from: 'a', to: 'b', kind: 'dashed' }], groups: [] });
    expect(json.edges[0].kind).toBe('dashed');
    // Mermaid's spaceless arrows, and ids that hold a hyphen
    const tight = parseDiagram('flowchart LR\nA-->B[Build]-.->C\nmy-step --> A');
    expect(tight.edges.map((e) => `${e.from}${e.kind}${e.to}`)).toEqual(['AarrowB', 'BdashedC', 'my-steparrowA']);
  });

  it('routes a ring\'s edges by the sides facing each other, never through the boxes', () => {
    const ring = layoutDiagram(parseDiagram('flowchart LR\nA --> B --> C --> D --> E --> F --> A'), { wide: true, typeSize: 22 });
    const placed = ring.placed as Record<string, { x: number; y: number; w: number; h: number }>;
    for (const r of ring.routes as { from: string; to: string; pts: { x: number; y: number }[] }[]) {
      // the line between its two ends (the arrowhead left out) stays clear of both boxes' insides
      const [p0, p1] = [r.pts[0], r.pts[1]];
      for (const id of [r.from, r.to]) {
        const b = placed[id];
        for (let s = 1; s < 10; s++) {
          const x = p0.x + ((p1.x - p0.x) * s) / 10, y = p0.y + ((p1.y - p0.y) * s) / 10;
          const inside = x > b.x + 1 && x < b.x + b.w - 1 && y > b.y + 1 && y < b.y + b.h - 1;
          expect(inside, `${r.from}→${r.to} crosses ${id}`).toBe(false);
        }
      }
    }
  });

  it('scales the type with the boxes it fits', async () => {
    const { doc } = newProject({ name: 'T', width: 1920, height: 1080, fps: 30, duration: 6 });
    const reg = builtinRegistry().clone().use(diagram as never, 'diagram.js');
    const run = async (text: string) => {
      const out = await diagram.tools[0].run({ text, typeSize: 20 } as never, { doc, compId: 'main', time: 0, selection: [], registry: reg } as never as ToolContext);
      const next = JSON.parse(JSON.stringify(doc)) as TrammeDoc;
      for (const op of out.ops as never[]) applyOp(next, op);
      const layers = Object.values(next.compositions.main.layers);
      const box = layers.find((l) => String(l.name).startsWith('box '))!;
      const label = layers.find((l) => String(l.name).startsWith('label '))!;
      return (label.props!.size as number) / (box.props!.size as number[])[1];
    };
    // a short flow grows to fill the frame, a long one shrinks: the label keeps its share of its box
    const few = await run('flowchart LR\nA[Pull] --> B[Ship]');
    const many = await run('flowchart LR\nA[One] --> B[Two] --> C[Three] --> D[Four] --> E[Five] --> F[Six] --> G[Seven] --> H[Eight] --> I[Nine] --> J[Ten]');
    expect(few).toBeCloseTo(many, 1);
  });

  it('the layouts place without overlap, read in order, and switch to portrait', () => {
    const chain = parseDiagram('flowchart LR\nA --> B --> C --> D --> E');
    const wide = layoutDiagram(chain, { wide: true, typeSize: 22 });
    expect(wide.kind).toBe('layered');
    const outs = Object.fromEntries(chain.nodes.map((n) => [n.id as string, chain.edges.filter((e) => e.from === n.id).map((e) => e.to as string)]));
    expect(topoOrder(chain.nodes.map((n) => n.id), outs)).toEqual(['A', 'B', 'C', 'D', 'E']);
    // one column: the boxes line up, no two overlap
    const placedWide = wide.placed as Record<string, { cx: number; cy: number; x: number; y: number; w: number; h: number }>;
    const xs = wide.order.map((id) => placedWide[id].cx);
    expect(new Set(xs).size).toBe(5);
    for (const a of wide.order) for (const b of wide.order) {
      if (a >= b) continue;
      const A = placedWide[a], B = placedWide[b];
      const overlap = A.x < B.x + B.w && B.x < A.x + A.w && A.y < B.y + B.h && B.y < A.y + A.h;
      expect(overlap, `${a} overlaps ${b}`).toBe(false);
    }
    expect(JSON.stringify(layoutDiagram(chain, { wide: true, typeSize: 22 }))).toBe(JSON.stringify(wide));
    // without a direction, the format picks it: left to right in 16:9, top to bottom in 9:16
    const free = parseDiagram('flowchart\nA --> B --> C --> D --> E');
    expect(free.direction).toBeNull();
    expect(layoutDiagram(free, { wide: true, typeSize: 22 }).direction).toBe('LR');
    const tall = layoutDiagram(free, { wide: false, typeSize: 22 });
    expect(tall.direction).toBe('TB');
    expect(new Set(tall.order.map((id) => (tall.placed as typeof placedWide)[id].cy)).size).toBe(5);
    // a direction the text writes holds in any format
    expect(layoutDiagram(chain, { wide: false, typeSize: 22 }).direction).toBe('LR');
    expect(layoutDiagram(parseDiagram('flowchart TB\nA --> B'), { wide: true, typeSize: 22 }).direction).toBe('TB');
    expect(() => parseDiagram({ direction: 'XY', nodes: [{ id: 'a' }], edges: [] })).toThrow(/direction/);
    // RL and BT run backwards: the first box sits right of (under) the last, the edges leave by the facing side
    const rl = layoutDiagram(parseDiagram('flowchart RL\nA --> B'), { wide: true, typeSize: 22 });
    const pr = rl.placed as typeof placedWide;
    expect(pr.A.cx).toBeGreaterThan(pr.B.cx);
    expect(rl.routes[0].pts[0].x).toBe(pr.A.x); // out of A's left side
    const bt = layoutDiagram(parseDiagram('flowchart BT\nA --> B'), { wide: true, typeSize: 22 });
    const pb = bt.placed as typeof placedWide;
    expect(pb.A.cy).toBeGreaterThan(pb.B.cy);
    const ring = layoutDiagram(parseDiagram('flowchart LR\nA --> B --> C --> A'), { wide: true, typeSize: 22 });
    expect(ring.kind).toBe('ring');
    // the barycentre sweep untangles a known crossing: A feeds Z, B feeds Y, and the layout lines them up
    const crossed = parseDiagram('flowchart LR\nA --> Z\nB --> Y');
    const laid = layoutDiagram(crossed, { wide: true, typeSize: 22 });
    const placed = laid.placed as Record<string, { cy: number }>; // the pack is JavaScript: its placed boxes type loosely
    expect(placed.Z.cy).toBeLessThan(placed.Y.cy);
    expect(layoutKind(['h', 'a', 'b', 'c'], { h: ['a', 'b', 'c'], a: [], b: [], c: [] }, { h: [], a: ['h'], b: ['h'], c: ['h'] }, 3)).toBe('hub');
  });

  it('the tool builds a diagram that validates, the highlight lifting one route', async () => {
    const { doc } = newProject({ name: 'T', width: 1920, height: 1080, fps: 30, duration: 6 });
    doc.tokens.ink = { type: 'color', value: '#1c1917' };
    doc.tokens.plate = { type: 'color', value: '#f4f1ea' };
    doc.tokens.accent = { type: 'color', value: '#0d99ff' };
    const reg = builtinRegistry().clone().use(diagram as never, 'diagram.js');
    const tool = diagram.tools[0];
    const out = await tool.run({ text: 'flowchart LR\nA[Pull] --> B[Build] --> C[Test]\nC -->|ok| D[Ship]\nC -.->|fail| B', highlight: 'Ship' } as never, {
      doc, compId: 'main', time: 0.5, selection: [], registry: reg,
    } as never as ToolContext);
    const next = JSON.parse(JSON.stringify(doc)) as TrammeDoc;
    for (const op of out.ops as never[]) applyOp(next, op);
    expect(validate(next, reg)).toEqual([]);
    const layers = next.compositions.main.layers;
    const accents = Object.values(layers).filter((l) => (l.props?.stroke as string) === '@accent');
    expect(accents.map((l) => l.name)).toEqual(['edge A to B', 'edge B to C', 'edge C to D (ok)']);
    const dimmed = Object.values(layers).filter((l) => (l.transform?.opacity as number) === 0.35);
    expect(dimmed.length).toBe(2);
    const edges = Object.values(layers).filter((l) => String(l.name).startsWith('edge ') && !String(l.name).endsWith(' label'));
    for (const e of edges) expect((e.props!.trimEnd as { $k: unknown[] }).$k).toHaveLength(2);
  });
});

describe('localize', () => {
  const transcript = {
    version: 1 as const, duration: 4, language: 'en',
    words: [
      { w: 'One', s: 0, e: 0.5 }, { w: 'two.', s: 0.5, e: 1 },
      { w: 'Three,', s: 2, e: 2.5 }, { w: 'four!', s: 2.5, e: 3 },
    ],
  };

  it('cuts the transcript into sentences', () => {
    const lines = sentencesOf(transcript);
    expect(lines).toEqual([
      { s: 0, e: 1, text: 'One two.' },
      { s: 2, e: 3, text: 'Three, four!' },
    ]);
  });

  it('spreads the translation over the line it translates', () => {
    const out = retimed(sentencesOf(transcript), ['Un deux trois', 'Quatre !']);
    expect(out.words.map((w) => w.w)).toEqual(['Un', 'deux', 'trois', 'Quatre', '!']);
    expect(out.words[0].s).toBe(0);
    expect(out.words[2].e).toBeLessThanOrEqual(1);
    expect(out.words[3].s).toBeCloseTo(2);
    expect(out.duration).toBeGreaterThanOrEqual(3);
    // an empty translation still holds its slot
    const held = retimed(sentencesOf(transcript), ['', 'Quatre !']);
    expect(held.words[0].w).toBe('·');
  });

  it('the apply tool writes the asset and duplicates the captioning compositions', async () => {
    const mod = localize as { tools: { name: string; run: (i: never, c: ToolContext) => Promise<{ ops: unknown[]; text: string }> }[] };
    const apply = mod.tools.find((t) => t.name === 'localize-apply')!;
    const { doc } = newProject({ name: 'T', width: 1000, height: 600, fps: 30, duration: 4 });
    doc.assets.talk = { type: 'video', src: 'assets/video/talk.mp4' };
    doc.assets['transcription-talk'] = { type: 'json', src: 'assets/transcripts/talk.json' };
    doc.compositions.main.layers.cap = { type: 'captions', props: { transcript: 'transcription-talk' } } as never;
    doc.compositions.main.order = ['cap'];
    const written = new Map<string, string>();
    const ctx = {
      doc, compId: 'main', registry: builtinRegistry(), time: 0, selection: [],
      transcript: async () => transcript,
      writeFile: async (p: string, d: string | Blob) => { written.set(p, typeof d === 'string' ? d : ''); return p; },
      assetUrl: () => '', fileUrl: () => '', readText: async () => null, files: async () => [], signal: new AbortController().signal,
    } as unknown as ToolContext;
    const out = await apply.run({ transcript: 'transcription-talk', lang: 'fr', lines: ['Un deux.', 'Trois, quatre !'] } as never, ctx);
    const next = JSON.parse(JSON.stringify(doc)) as TrammeDoc;
    for (const op of out.ops as never[]) applyOp(next, op);
    expect(next.assets['transcription-talk-fr']).toBeDefined();
    expect(next.compositions['main-fr']?.name).toContain('fr');
    expect(next.compositions['main-fr']?.layers.cap?.props?.transcript).toBe('transcription-talk-fr');
    expect(written.has('assets/transcripts/transcription-talk-fr.json')).toBe(true);
  });
});

// the few patch operations the tests need, applied in place (add and replace both set; '-' appends to an array)
function applyOp(doc: TrammeDoc, op: { op: string; path: string; value?: unknown }) {
  const parts = op.path.split('/').filter(Boolean);
  let container = doc as unknown as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) container = container[parts[i]] as Record<string, unknown>;
  const last = parts[parts.length - 1];
  if (last === '-' && op.op === 'add' && Array.isArray(container)) container.push(op.value);
  else container[last] = op.value;
}
