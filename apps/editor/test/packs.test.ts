// The shipped plugin packs: each module registers cleanly, every node
// validates with its default props, the simulations are deterministic, and
// the pure helpers (scales, layouts, contrast, retiming) answer as documented.

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Evaluator, layerMatrix, matMul, Registry, validate, type Op, type TrammeDoc, type ToolContext } from '@tramme/core';
import { builtinRegistry } from '@tramme/nodes';
import { newProject } from '@tramme/project';
import { niceMax, barSlots, linePoints, donutArcs, seriesOf, parseCsv, csvNumber, ranksOver, ticks, tableOf } from '../../../plugins/charts.js';
import { charState, bounce, lineStart, scrambleAt, flapAt, FLAPS } from '../../../plugins/kinetic.js';
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
import { needLine } from '../../../scripts/packs/entries.ts';
import * as localize from '../../../plugins/localize.js';
import { lex, tokenDiff, typingTimes, parseSession, maxLines, ansiRuns, readable, contrastOf } from '../../../plugins/codeview.js';
import * as codeview from '../../../plugins/codeview.js';
import { offBeat, evenShots, deltaE, paletteDrift, typeDrift } from '../../../plugins/rhythm.js';
import * as rhythm from '../../../plugins/rhythm.js';
import { activity, zoomKeys, clicksOf, sampleTimes, positionFor } from '../../../plugins/screencast.js';
import * as screencast from '../../../plugins/screencast.js';
import { held, jitter, roughPath, hachure, boilAt } from '../../../plugins/handmade.js';
import * as handmade from '../../../plugins/handmade.js';
import { parseScript, readingTime, scrollFor } from '../../../plugins/chat.js';
import * as chat from '../../../plugins/chat.js';
import { searchEmoji } from '../../../plugins/emoji.js';
import * as emoji from '../../../plugins/emoji.js';
import { project, findPlace, greatCircle, zoomPath, fold, toFrame, placeLabels, flightKeys, routeShare } from '../../../plugins/maps.js';
import * as maps from '../../../plugins/maps.js';
import { barsAt, meterAt, soundTime } from '../../../plugins/audiogram.js';
import * as audiogram from '../../../plugins/audiogram.js';
import { parseTex, layout, matchSymbols } from '../../../plugins/math.js';
import * as math from '../../../plugins/math.js';
import { resample, bestStart, marchingSquares, tornEdge, liquidField, pairContours, aligned, sheetOf } from '../../../plugins/matter.js';
import * as matter from '../../../plugins/matter.js';
import * as print from '../../../plugins/print.js';
import * as qr from '../../../plugins/qr.js';
import * as extrude from '../../../plugins/extrude.js';
import { parseGltf } from '../../../packages/nodes/src/gltf.ts';
import { stepWorld } from '../../../plugins/physics.js';

// the packs are JavaScript on purpose: their shape is checked at runtime by Registry.use, which these tests run
const PACKS = [charts, kinetic, a11y, physics, styk, icons, diagram, walkthrough, localize, codeview, rhythm, screencast, handmade, chat, emoji, maps, audiogram, math, matter, print, qr, extrude] as unknown as import('@tramme/core').PluginModule[];

/** the shipped index, as the script writes it: each entry's commands and their French */
const INDEX: { file: string; name: string; description?: string; commands?: { name: string; title: string; description: string }[]; fr?: Record<string, string> }[] =
  JSON.parse(readFileSync(new URL('../../../plugins/index.json', import.meta.url), 'utf8'));

// packs.ts pulls the i18n module, which reads the theme at import: the few DOM bits it touches are stubbed
vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) });
vi.stubGlobal('document', { hidden: true, hasFocus: () => false, documentElement: { dataset: {} }, querySelector: () => null });
vi.stubGlobal('addEventListener', () => {});

// ── the helpers every pack's tests share ─────────────────────

let sharedRegistry: Registry | null = null;
/** the built-in vocabulary with every shipped pack in it: the nodes' bounds, the tools' operations */
const registryOf = () => (sharedRegistry ??= PACKS.reduce((reg, mod) => reg.use(mod as never, mod.meta?.name ?? 'x'), builtinRegistry().clone()));

/** the last key time of a document: every layer holds its final state there */
function lastKeyOf(doc: TrammeDoc): number {
  let last = 0;
  for (const comp of Object.values(doc.compositions))
    for (const layer of Object.values(comp.layers))
      for (const v of Object.values(layer.props ?? {})) {
        const k = (v as { $k?: { t?: number }[] }).$k;
        if (Array.isArray(k)) for (const key of k) last = Math.max(last, key.t ?? 0);
      }
  return last;
}

/** the bounds of each top-level layer, at its last key */
function boxesOf(doc: TrammeDoc): { x: number; y: number; w: number; h: number }[] {
  const comp = doc.compositions[doc.root], t = lastKeyOf(doc);
  const frame = new Evaluator(doc, registryOf()).frame(t, doc.root);
  const host = {
    layerId: '', t, frame: Math.round(t * comp.fps), fps: comp.fps, width: comp.width, height: comp.height, duration: comp.duration,
    asset: () => null, assetInfo: (id: string) => doc.assets[id], assetUrl: (id: string) => doc.assets[id]?.src ?? '',
  };
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (const L of frame.layers) {
    if (!comp.order.includes(L.id)) continue;
    let r: { x: number; y: number; w: number; h: number } | null = null;
    try { r = L.node.bounds?.(L.props, host as never) ?? null; } catch { r = null; }
    if (!r) continue;
    const m = matMul([1, 0, 0, 1, 0, 0], layerMatrix(L.transform));
    const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    out.push({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
  }
  return out;
}

/** inside the frame (a pixel of slack for the rounding of the bounds) */
const inside = (b: { x: number; y: number; w: number; h: number }, w: number, h: number) =>
  b.x >= -1 && b.y >= -1 && b.x + b.w <= w + 1 && b.y + b.h <= h + 1;

/** a pack tool run on a document: its context reads a pack's data files from disk (plugins/<stem>/<path>), or the files given */
async function runTool(tool: { run: (input: never, ctx: ToolContext) => Promise<{ ops: unknown[]; text?: string }> }, doc: TrammeDoc, input: unknown, opts: { files?: Record<string, string>; extra?: Record<string, unknown> } = {}) {
  const stems = INDEX.map((e) => e.file.replace(/\.js$/i, ''));
  const ctx = {
    doc, compId: doc.root, time: 0, selection: [], registry: registryOf(),
    assetUrl: () => '', fileUrl: () => '', readText: async () => null,
    files: async () => [], signal: new AbortController().signal,
    writeFile: async (p: string) => p, renderStill: async () => '',
    packFile: async (path: string) => {
      if (opts.files?.[path] !== undefined) return opts.files[path];
      // the packs' folders first: the index of the packs (plugins/index.json) is no pack's data
      for (const c of [...stems.map((s) => `plugins/${s}/${path}`), `plugins/${path}`]) {
        try { return readFileSync(new URL(`../../../${c}`, import.meta.url), 'utf8'); } catch { /* next place */ }
      }
      throw new Error(`packFile: "${path}" not found beside the packs`);
    },
    ...opts.extra,
  } as unknown as ToolContext;
  const out = await (tool.run(input as never, ctx) as Promise<{ ops: Op[]; text?: string }>);
  // what a tool writes is a document the validator accepts (the assets it names written beside it)
  const next = applyOps(doc, out.ops as never).doc;
  const issues = validate(next, registryOf());
  expect(issues, `the tool's operations: ${JSON.stringify(issues.slice(0, 4))}`).toEqual([]);
  return out;
}

/** the document after the tool's operations (a copy: the ops apply on a clean sheet) */
function applyOps(doc: TrammeDoc, ops: { op: string; path: string; value?: unknown }[]): { doc: TrammeDoc } {
  const next = JSON.parse(JSON.stringify(doc)) as TrammeDoc;
  for (const op of ops) applyOp(next, op);
  return { doc: next };
}

/** a 2D context that only records what is drawn: the nodes' render code run headless (it throws where the code would) */
function recorder(): CanvasRenderingContext2D & { calls: string[] } {
  const calls: string[] = [];
  const state: Record<string, unknown> = { globalAlpha: 1, font: '10px sans-serif' };
  const target = {
    calls,
    measureText: (s: string) => ({ width: String(s).length * 10 }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  } as Record<string, unknown>;
  return new Proxy(target, {
    get: (t, k: string) => (k in t ? t[k] : k in state ? state[k] : (...args: unknown[]) => { calls.push(`${k}(${args.map((a) => (typeof a === 'number' ? Math.round(a) : typeof a)).join(',')})`); }),
    set: (_t, k: string, v) => { state[k] = v; return true; },
  }) as never;
}

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

  it('every preset sets only the properties its effects and layers declare', () => {
    const index: { file: string }[] = JSON.parse(readFileSync(new URL('../../../plugins/index.json', import.meta.url), 'utf8'));
    const modules = (import.meta as ImportMeta & { glob: (p: string, o: { eager: true }) => Record<string, unknown> }).glob('../../../plugins/*.js', { eager: true }) as Record<string, import('@tramme/core').PluginModule>;
    for (const entry of index) {
      const mod = modules[`../../../plugins/${entry.file}`];
      const reg = builtinRegistry().clone().use(mod as never, entry.file);
      for (const preset of (mod.presets ?? []) as { name: string; effects?: { type: string; props?: Record<string, unknown> }[]; layer?: { type: string; props?: Record<string, unknown> } }[]) {
        for (const fx of preset.effects ?? []) {
          const def = reg.listEffects().find((e) => e.type === fx.type);
          expect(def, `${entry.file} ${preset.name}: effect ${fx.type}`).toBeTruthy();
          for (const k of Object.keys(fx.props ?? {})) expect(def!.props, `${entry.file} ${preset.name}: ${fx.type} has no "${k}"`).toHaveProperty(k);
        }
        if (preset.layer) {
          const node = reg.node(preset.layer.type);
          for (const k of Object.keys(preset.layer.props ?? {})) expect(node?.props, `${entry.file} ${preset.name}: ${preset.layer.type} has no "${k}"`).toHaveProperty(k);
        }
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
    for (const t of mod.tools ?? []) {
      if (t.title) out.push(t.title);
      out.push(t.description);
      // the form of the / menu shows each field's title and description, translated
      for (const f of Object.values((t.input as { properties?: Record<string, { title?: string; description?: string }> } | undefined)?.properties ?? {})) {
        if (f.title) out.push(f.title);
        if (f.description) out.push(f.description);
      }
    }
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

describe('the packs index', () => {
  it('the index lists every tool of every pack', () => {
    for (const mod of PACKS) {
      const stem = (mod.meta as { id: string }).id.split('/')[1];
      const entry = INDEX.find((e) => e.file === `${stem}.js`);
      expect(entry, `${stem}.js: not in the index`).toBeTruthy();
      expect(entry!.commands?.map((c) => c.name), stem).toEqual((mod.tools ?? []).map((t) => t.name));
    }
  });

  it('the index carries the French of each command', () => {
    for (const entry of INDEX) for (const c of entry.commands ?? []) expect(entry.fr?.[c.title], `${entry.file}: ${c.title}`).toBeDefined();
  });

  it('packCommands offers them as tools of their pack', async () => {
    const { packCommands } = await import('../src/packs.ts');
    const cmds = packCommands([{ file: 'icons.js', name: 'Icons', commands: [{ name: 'icon', title: 'Icons', description: 'd' }] }]);
    expect(cmds[0]).toMatchObject({ kind: 'tool', name: 'icon', from: 'Icons' });
    expect(cmds[0].input).toBeUndefined();
  });

  it('a project\'s older copy of a pack is offered its update', async () => {
    const { packUpdates } = await import('../src/packs.ts');
    const { doc } = newProject({ name: 'T', width: 1000, height: 600, fps: 30, duration: 2 });
    doc.assets.charts = { type: 'module', src: 'plugins/charts.js', name: 'Charts' } as never;
    doc.assets.mine = { type: 'module', src: 'plugins/mine.js', name: 'Mine' } as never;
    const packs = [{ file: 'charts.js', name: 'Charts', version: '1.1.0' }, { file: 'icons.js', name: 'Icons', version: '1.0.0' }];
    expect(packUpdates(doc, packs, { 'plugins/charts.js': '1.0.0' })).toEqual([
      { assetId: 'charts', name: 'Charts', file: 'charts.js', src: 'plugins/charts.js', from: '1.0.0', to: '1.1.0' },
    ]);
    // the same version, a newer copy, and a file that is not a pack's: nothing offered
    expect(packUpdates(doc, packs, { 'plugins/charts.js': '1.1.0' })).toEqual([]);
    expect(packUpdates(doc, packs, { 'plugins/charts.js': '1.2.0' })).toEqual([]);
    expect(packUpdates(doc, packs, { 'plugins/mine.js': '0.0.1' })).toEqual([]);
  });
});

describe('codeview', () => {
  it('lexes the languages it says, nothing dropped', () => {
    expect(lex('const a = "x"; // c', 'js').map((t) => t.kind)).toEqual(['kw', 'ws', 'id', 'ws', 'op', 'ws', 'str', 'punct', 'ws', 'com']);
    const py = lex('def f(x):\n\treturn 1', 'py');
    expect(py[0]).toMatchObject({ text: 'def', kind: 'kw' });
    // the newline and its tab are one whitespace token
    expect(py.find((t) => t.text.includes('\t'))).toEqual({ text: '\n\t', kind: 'ws' });
    expect(lex('def f(x):\n\treturn 1', 'py').map((t) => t.text).join('')).toBe('def f(x):\n\treturn 1');
    expect(lex('s = "日本"', 'py').map((t) => t.text).join('')).toBe('s = "日本"');
    // a token colour the eye follows: the identifier called like a function is its own kind
    expect(lex('ship()', 'js')[0].kind).toBe('fn');
    expect(lex('{"a": 1}', 'json').map((t) => t.kind)).toContain('type');
    expect(lex('# head', 'sh')[0].kind).toBe('com');
  });

  it('diffs two versions by their shared tokens', () => {
    const d = tokenDiff(lex('a+b', 'js'), lex('a-b', 'js'));
    expect(d.kept).toEqual([[0, 0], [2, 2]]);
    expect(d.removed).toEqual([1]);
    expect(d.added).toEqual([1]);
    expect(tokenDiff(lex('a', 'js'), []).kept).toEqual([]);
    expect(tokenDiff([], lex('a', 'js')).added).toEqual([0]);
  });

  it('types at an uneven, seeded, readable rhythm', () => {
    const a = typingTimes('hello', 1), b = typingTimes('hello', 1), c = typingTimes('hello', 2);
    expect(a.every((t, i) => i === 0 || t > a[i - 1])).toBe(true);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    // a pause at the line's end
    const lines = typingTimes('ab\ncd', 3);
    expect(lines[3] - lines[1]).toBeGreaterThan(2 / 18);
  });

  it('reads the session script', () => {
    expect(parseSession('$ npm test\n...\n> 3 passed')).toEqual([
      { kind: 'cmd', text: 'npm test' },
      { kind: 'wait', text: '...', seconds: 1 },
      { kind: 'out', text: '3 passed', runs: [{ text: '3 passed', colour: null }] },
    ]);
    expect(parseSession('$ build\n... 2.5')).toContainEqual({ kind: 'wait', text: '... 2.5', seconds: 2.5 });
    // a progress bar filling over its seconds, its label kept
    expect(parseSession('[###] 2 installing')).toEqual([{ kind: 'bar', text: 'installing', seconds: 2 }]);
  });

  it('maps the ANSI colours of the output to the tokens, written either way', () => {
    const ESC = String.fromCharCode(27), B = String.fromCharCode(92);
    expect(ansiRuns(`${ESC}[32mok${ESC}[0m done`)).toEqual([{ text: 'ok', colour: 'accent' }, { text: ' done', colour: null }]);
    expect(ansiRuns(`${B}e[31mfail${B}e[0m`)).toEqual([{ text: 'fail', colour: 'accent2' }]);
    expect(ansiRuns(`${B}x1b[2mdim`)).toEqual([{ text: 'dim', colour: 'dim' }]);
    // the plain text of a line drops the codes
    expect(parseSession(`> ${ESC}[32m3 passed${ESC}[0m`)[0].text).toBe('3 passed');
  });

  it('lexes YAML and SQL', () => {
    const yaml = lex('name: tramme\nport: 8080 # dev', 'yaml').filter((t) => t.kind !== 'ws');
    expect(yaml.map((t) => t.kind)).toEqual(['type', 'punct', 'id', 'type', 'punct', 'num', 'com']);
    const sql = lex("SELECT name FROM users WHERE id = 'a';", 'sql').filter((t) => t.kind !== 'ws');
    expect(sql.slice(0, 4).map((t) => t.kind)).toEqual(['kw', 'id', 'kw', 'id']);
    expect(sql.find((t) => t.text === "'a'")?.kind).toBe('str');
  });

  it('reads its colours at 4.5:1 against the panel', () => {
    expect(contrastOf(readable('#2a2f36', '#0D1117'), '#0D1117')).toBeGreaterThanOrEqual(4.5);
    expect(contrastOf(readable('#e0e0e0', '#ffffff'), '#ffffff')).toBeGreaterThanOrEqual(4.5);
    // already readable: unchanged; a token not resolved to hex: unchanged
    expect(readable('#ffffff', '#0D1117')).toBe('#ffffff');
    expect(readable('@accent', '#0D1117')).toBe('@accent');
  });

  it('the tool cuts a long file to what fits and says so, in both formats', async () => {
    const big = Array.from({ length: 2000 }, (_, i) => `const v${i} = ${i};`).join('\n');
    for (const [w, h] of [[1920, 1080], [1080, 1920]] as [number, number][]) {
      const { doc } = newProject({ name: 'T', width: w, height: h, fps: 30, duration: 8 });
      const out = await runTool(codeview.tools[0], doc, { code: big, lang: 'js', size: 24, title: 'big.js' });
      const next = applyOps(doc, out.ops).doc;
      const cid = Object.keys(next.compositions).find((k) => k.startsWith('code-'))!;
      const layer = Object.values(next.compositions[cid].layers).find((l) => l.type === 'codeview.code')!;
      const panel = layer.props!.panel as [number, number];
      expect((layer.props!.code as string).split('\n').length).toBeLessThanOrEqual(maxLines(panel[1], 24));
      if (w === 1920) expect(out.text).toMatch(/left out/);
    }
  });

  it('the legibility check flags small type in either format', () => {
    const placed = (props: object, name: string) => ({ id: name.toLowerCase(), layer: { name, type: 'codeview.code' }, node: { type: 'codeview.code' }, props, opacity: 1, box: null });
    const run = (width: number, height: number, size: number) => codeview.checks[0].run({
      doc: {}, compId: 'main', comp: { width, height }, registry: null, evaluator: null, step: 0.25,
      samples: [{ t: 0, layers: [placed({ code: 'const a = 1', size, panel: [900, 500] }, 'Code')] }],
    } as never) as { message: string }[];
    expect(run(1920, 1080, 20).length).toBeGreaterThan(0);
    expect(run(1080, 1920, 26).length).toBeGreaterThan(0);
    expect(run(1920, 1080, 26)).toEqual([]);
  });

  it('falls back without a kit', async () => {
    const doc = newProject({ name: 'T', width: 1920, height: 1080, fps: 30, duration: 6 }).doc;
    const r = await runTool(codeview.tools[0], doc, { code: 'const a = 1;' });
    expect(r.ops.length).toBeGreaterThan(0);
  });

  it('fits 9:16', async () => {
    const doc = newProject({ name: 'T', width: 1080, height: 1920, fps: 30, duration: 6 }).doc;
    const r = await runTool(codeview.tools[0], doc, { code: 'function ship(x) {\n  return x + 1;\n}', title: 'ship.js' });
    for (const b of boxesOf(applyOps(doc, r.ops).doc)) expect(inside(b, 1080, 1920)).toBe(true);
  });
});

describe('rhythm', () => {
  const analysis = { kind: 'audio-analysis', beats: [1.0, 2.5], downbeats: [1.0], sections: [], duration: 6, rate: 50, envelope: { rms: [], low: [], mid: [], high: [] } };
  const build = (cutAt: [number, number]) => {
    const { doc } = newProject({ name: 'T', width: 1920, height: 1080, fps: 30, duration: 6 });
    doc.assets['analysis-music'] = { type: 'json', src: 'assets/analyses/music.json' } as never;
    doc.compositions.main.layers.a = { type: 'video', in: 0, out: cutAt[0], props: { video: 'v' } } as never;
    doc.compositions.main.layers.b = { type: 'video', in: cutAt[1], out: 6, props: { video: 'v' } } as never;
    const ctx = { doc, compId: 'main', comp: doc.compositions.main, registry: null, evaluator: null, step: 0.25, samples: [], data: (id: string) => (id === 'analysis-music' ? analysis : undefined) };
    return ctx as never;
  };
  const runOne = (ctx: never, name: string) => (rhythm.checks.find((c) => c.name === name)!.run(ctx) as unknown[]).length;

  it('hears the cuts that miss the beats', () => {
    expect(offBeat([1.0, 2.04], [1.0, 2.5], 30)).toEqual([2.04]);
    expect(offBeat([1.0, 2.5], [1.0, 2.5], 30)).toEqual([]);
  });

  it('hears a film that plods', () => {
    expect(evenShots([2, 2.1, 1.95, 2.05])).toBe(true);
    expect(evenShots([1, 3, 2, 5])).toBe(false);
    expect(evenShots([2, 2, 2])).toBe(false);
  });

  it('reads the distance of two colours as the eye does', () => {
    expect(deltaE('#ffffff', '#ffffff')).toBe(0);
    expect(deltaE('#ff0000', '#fe0101')).toBeLessThan(10);
    expect(deltaE('#ff0000', '#00ff00')).toBeGreaterThan(10);
    expect(paletteDrift(['#ff0000'], ['#fe0101']).far).toEqual([]);
    expect(paletteDrift(['#ff0000'], ['#00ff00']).far).toEqual(['#ff0000']);
    expect(paletteDrift(['#ff0000'], []).tooMany).toBe(false);
  });

  it('flags the type a scale would not', () => {
    expect(typeDrift(['A', 'B', 'C'], [40, 42])).toEqual({ faces: true, sizes: [[40, 42]] });
    expect(typeDrift(['A'], [40, 43.5])).toEqual({ faces: false, sizes: [[40, 43.5]] });
    expect(typeDrift(['A'], [40, 44.5])).toEqual({ faces: false, sizes: [] });
    expect(typeDrift(['A', 'B'], [40, 60, 90])).toEqual({ faces: false, sizes: [] });
    expect(typeDrift(['A', 'B'], [40, 40])).toEqual({ faces: false, sizes: [] });
  });

  it('the four checks flag the off-beat film alone, and stay silent on the one that lands', () => {
    const off = build([1.0, 2.04]), on = build([1.0, 2.5]);
    expect(runOne(off, 'off-beat')).toBe(1);
    expect(runOne(on, 'off-beat')).toBe(0);
    for (const name of ['even-shots', 'palette-drift', 'type-drift']) {
      expect(runOne(off, name)).toBe(0);
      expect(runOne(on, name)).toBe(0);
    }
  });
});

describe('screencast', () => {
  const W = 256, H = 192;
  /** a frame: white, with a filled square at x, y (and an optional shade elsewhere) */
  const frame = (squares: [number, number][]): Uint8ClampedArray => {
    const px = new Uint8ClampedArray(W * H * 4).fill(240);
    for (const [x, y] of squares) for (let dy = 0; dy < 20; dy++) for (let dx = 0; dx < 20; dx++) {
      const i = ((y + dy) * W + (x + dx)) * 4;
      px[i] = 20; px[i + 1] = 20; px[i + 2] = 20;
    }
    return px;
  };

  it('finds where the picture changed, and only there', () => {
    const a = frame([[10, 10]]), b = frame([[40, 40]]);
    const box = activity(a, b, W, H)!;
    expect(box).not.toBeNull();
    // both squares inside, the page around them left out
    expect(box.x).toBeLessThanOrEqual(10);
    expect(box.y).toBeLessThanOrEqual(10);
    expect(box.x + box.w).toBeGreaterThanOrEqual(60);
    expect(box.y + box.h).toBeGreaterThanOrEqual(60);
    expect(box.w).toBeLessThan(W * 0.7);
    expect(activity(a, a, W, H)).toBeNull();
  });

  it('keys the zoom in, held, and out before a page change, never over 2.5', () => {
    const regions = [
      { t: 0, box: null },
      { t: 1, box: { x: 40, y: 40, w: 40, h: 40 } },
      { t: 2, box: { x: 42, y: 42, w: 40, h: 40 } },
      { t: 3, box: { x: 0, y: 0, w: W, h: H } }, // the page change: a full-frame change
      { t: 4, box: null },
    ];
    const keys = zoomKeys(regions, { w: W, h: H });
    expect(keys.every((k) => k.scale <= 2.5)).toBe(true);
    // never faster than the check allows (1.5× a second)
    for (let i = 1; i < keys.length; i++) if (keys[i].t > keys[i - 1].t) expect(Math.abs(keys[i].scale - keys[i - 1].scale) / (keys[i].t - keys[i - 1].t)).toBeLessThanOrEqual(1.5 + 1e-6);
    const zoomed = keys.filter((k) => k.scale > 1);
    expect(zoomed.length).toBeGreaterThan(0);
    // out again before the page change (its keys back at 1 by 2.6)
    const last = keys.at(-1)!;
    expect(last.scale).toBe(1);
    expect(last.t).toBeLessThanOrEqual(2.6);
    // nothing anywhere when the whole frame changes each time
    expect(zoomKeys([{ t: 0, box: { x: 0, y: 0, w: W, h: H } }, { t: 1, box: { x: 0, y: 0, w: W, h: H } }], { w: W, h: H })).toEqual([]);
  });

  it('marks the clicks, after a still stretch', () => {
    const clicks = clicksOf([
      { t: 0, box: null },
      { t: 2, box: { x: 100, y: 100, w: 20, h: 20 } },
    ], { w: W, h: H });
    expect(clicks).toEqual([{ t: 2, x: 110, y: 110 }]);
    // one right after activity is not a click
    expect(clicksOf([
      { t: 1, box: { x: 0, y: 0, w: 60, h: 60 } },
      { t: 1.1, box: { x: 100, y: 100, w: 20, h: 20 } },
    ], { w: W, h: H })).toEqual([]);
  });

  it('samples a 30-minute recording one look a second, and says so', async () => {
    expect(sampleTimes(1800)).toHaveLength(1800);
    expect(sampleTimes(1800)[1]).toBeCloseTo(1);
    expect(sampleTimes(60).length).toBeGreaterThan(60);
    const { doc } = newProject({ name: 'T', width: 1280, height: 720, fps: 30, duration: 1800 });
    doc.assets.rec = { type: 'video', src: 'assets/video/rec.mp4', name: 'Rec' } as never;
    doc.compositions.main.layers.rec = { type: 'video', in: 0, out: 1800, props: { video: 'rec' } } as never;
    doc.compositions.main.order = ['rec'];
    const px = { data: frame([]), w: W, h: H };
    const out = await runTool(screencast.tools[0], doc, {}, { extra: { readStill: async () => px } });
    expect(out.text).toMatch(/1 800|a second/);
    expect(out.ops.length).toBeGreaterThan(0);
  });

  it('keys the zooms on the layer, ordinary keys, in both formats', async () => {
    for (const [w, h] of [[1920, 1080], [1080, 1920]] as [number, number][]) {
      const doc = newProject({ name: 'T', width: w, height: h, fps: 30, duration: 8 }).doc;
      doc.assets.rec = { type: 'video', src: 'assets/video/rec.mp4', name: 'Rec' } as never;
      doc.compositions.main.layers.rec = { type: 'video', in: 0, out: 8, transform: { position: [w / 2, h / 2] }, props: { video: 'rec', size: [w, h] } } as never;
      doc.compositions.main.order = ['rec'];
      // a still page, a click, activity: the same regions whatever the format
      const regions = (t: number) => (t < 2 ? { t, box: null } : t < 4 ? { t, box: { x: Math.round(w * 0.4), y: Math.round(h * 0.4), w: Math.round(w * 0.12), h: Math.round(w * 0.12) } } : { t, box: null });
      const px = frame([[40, 40]]);
      const out = await runTool(screencast.tools[0], doc, {}, { extra: { readStill: async (t: number) => ({ data: px, w, h, ...(t < 0 ? {} : {}) }), ...{} } });
      void regions;
      expect(out.ops.length).toBeGreaterThan(0);
      for (const b of boxesOf(applyOps(doc, out.ops).doc)) expect(inside(b, w, h), `${w}x${h} ${JSON.stringify(b)} ${JSON.stringify(out.ops.map((o) => o.path))}`).toBe(true);
    }
  });
});

describe('handmade', () => {
  it('holds a value on its block of frames, whichever instant of it asks', () => {
    expect(held(0.1, 30, 2)).toBe(held(0.066, 30, 2));
    expect(held(5 / 30, 30, 2)).toBe(held(4 / 30, 30, 2));
    expect(held(7 / 30, 30, 2)).not.toBe(held(4 / 30, 30, 2));
  });

  it('nudges by the seed and the step, the same every time', () => {
    expect(jitter(7, 3, 0.6)).toEqual(jitter(7, 3, 0.6));
    expect(jitter(7, 3, 0.6)).not.toEqual(jitter(8, 3, 0.6));
    expect(jitter(7, 4, 0.6)).not.toEqual(jitter(7, 3, 0.6));
    expect(Math.abs(jitter(7, 3, 0.6)[0])).toBeLessThanOrEqual(0.6);
  });

  it('draws the same hand for the same seed, another for another', () => {
    const b = { x: 0, y: 0, w: 300, h: 160 };
    expect(roughPath('rect', b, 7)).toEqual(roughPath('rect', b, 7));
    expect(JSON.stringify(roughPath('rect', b, 7))).not.toBe(JSON.stringify(roughPath('rect', b, 8)));
    for (const kind of ['line', 'arrow', 'rect', 'ellipse', 'bracket'] as const) {
      const paths = roughPath(kind, b, 3);
      expect(paths.length).toBeGreaterThanOrEqual(2);
      for (const p of paths) {
        expect(p.v.length).toBeGreaterThan(1);
        expect(p.closed).toBe(false);
      }
    }
    const hatch = hachure(b, -41, 10, 5);
    expect(hatch.length).toBeGreaterThan(3);
    for (const p of hatch) expect(p.v).toHaveLength(2);
    expect(hachure(b, -41, 10, 5)).toEqual(hatch);
  });

  it('the twos hold a linear key across its block, and boil answers any frame in any order', () => {
    const linear = (t: number) => t * 30;
    const ctxAt = (t: number) => ({ t, fps: 30, base: linear, keys: null, keyValues: null, index: 0, count: 1, seed: 3 });
    const mod = handmade.modifiers[0];
    expect(mod.type).toBe('twos');
    expect(mod.apply(linear(4 / 30), { n: 2, jitter: 0 }, ctxAt(4 / 30))).toBe(mod.apply(linear(5 / 30), { n: 2, jitter: 0 }, ctxAt(5 / 30)));
    expect(mod.apply(linear(6 / 30), { n: 2, jitter: 0 }, ctxAt(6 / 30))).not.toBe(mod.apply(linear(4 / 30), { n: 2, jitter: 0 }, ctxAt(4 / 30)));
    // any frame in any order: the boil offset at 37 is the one reached after 0 to 36
    const alone = boilAt(37, 1, 1.5, 2);
    let reached: number[] | null = null;
    for (let f = 0; f <= 37; f++) reached = boilAt(f, 1, 1.5, 2);
    expect(reached).toEqual(alone);
  });

  it('the annotation follows a moving layer, its keys one offset away', async () => {
    const { doc } = newProject({ name: 'T', width: 1920, height: 1080, fps: 30, duration: 6 });
    doc.compositions.main.layers.t = {
      type: 'text', name: 'Key line', in: 0, out: 6,
      transform: { position: { $k: [{ t: 0, v: [400, 300] }, { t: 2, v: [900, 500] }] } },
      props: { text: 'the number that matters', size: 64 },
    } as never;
    doc.compositions.main.order = ['t'];
    const out = await runTool(handmade.tools[0], doc, { kind: 'circle', layer: 't' });
    const next = applyOps(doc, out.ops).doc;
    const mark = Object.values(next.compositions.main.layers).find((l) => l.type === 'sketch.shape')!;
    const keys = (mark.transform!.position as { $k: { t: number; v: number[] }[] }).$k;
    expect(keys.map((k) => k.t)).toEqual([0, 2]);
    // the same offset at both keys: the mark rides the layer
    expect(keys[0].v[0] - 400).toBeCloseTo(keys[1].v[0] - 900, 0);
    expect(keys[0].v[1] - 300).toBeCloseTo(keys[1].v[1] - 500, 0);
    expect(validate(next, registryOf())).toEqual([]);
  });

  it('falls back without a kit', async () => {
    const doc = newProject({ name: 'T', width: 1920, height: 1080, fps: 30, duration: 6 }).doc;
    doc.compositions.main.layers.t = { type: 'text', name: 'Line', props: { text: 'hold this', size: 64 } } as never;
    doc.compositions.main.order = ['t'];
    const r = await runTool(handmade.tools[0], doc, { kind: 'underline' });
    expect(r.ops.length).toBeGreaterThan(0);
  });

  it('fits 9:16', async () => {
    const doc = newProject({ name: 'T', width: 1080, height: 1920, fps: 30, duration: 6 }).doc;
    doc.compositions.main.layers.t = { type: 'text', name: 'Line', props: { text: 'the point', size: 72, align: 'center' }, transform: { position: [540, 900] } } as never;
    doc.compositions.main.order = ['t'];
    const r = await runTool(handmade.tools[0], doc, { kind: 'circle', layer: 't' });
    for (const b of boxesOf(applyOps(doc, r.ops).doc)) expect(inside(b, 1080, 1920)).toBe(true);
  });
});

describe('chat', () => {
  it('reads the script, accents and emoji whole', () => {
    const lines = parseScript('A: hi 👋\nB: [2s] yo');
    expect(lines).toEqual([{ who: 'A', text: 'hi 👋' }, { who: 'B', text: 'yo', at: 2 }]);
    const accented = parseScript('Zoé: ça va ?');
    expect(accented).toEqual([{ who: 'Zoé', text: 'ça va ?' }]);
  });

  it('times the lines by reading', () => {
    expect(readingTime('one two three')).toBeCloseTo(1.21, 1);
    expect(readingTime('')).toBeCloseTo(0.9, 2);
    // a reply that takes thought pauses longer before it types
    const tl = chat.timeline('A: hello there\nB: ok\nA: a much longer answer that takes thought');
    expect(tl.items[2].typing).toBeGreaterThan(tl.items[0].typing);
    expect(tl.items[0].read).toBeCloseTo(readingTime('hello there'), 2);
    // the owner of the phone (the second voice) sends: no typing indicator before their lines
    expect(tl.items[1].typing).toBe(0);
  });

  it('keeps each sender on their side, however many lines they send in a row', () => {
    expect(chat.sidesOf(parseScript('A: hi\nA: you there?\nB: yes\nB: why\nA: look'))).toEqual([false, false, true, true, false]);
  });

  it('drops the notifications one after the other over the progress', () => {
    const wins = [0, 1, 2].map((i) => chat.noticeWindow(i, 3));
    for (const w of wins) expect(w.from + w.span).toBeLessThanOrEqual(1);
    expect(wins[1].from).toBeGreaterThan(wins[0].from);
    expect(wins[2].from).toBeGreaterThan(wins[1].from);
  });

  it('cuts a line into text and the pack\'s emoji pictures', () => {
    expect(chat.runsOf('so 👀 now', { '👀': 'emoji-eyes' })).toEqual([{ text: 'so ' }, { emoji: 'emoji-eyes', ch: '👀' }, { text: ' now' }]);
    expect(chat.runsOf('plain', {})).toEqual([{ text: 'plain' }]);
  });

  it('keeps the last message in view', () => {
    expect(scrollFor([100, 100, 100], 250)[2]).toBe(50);
    expect(scrollFor([100, 100], 400)).toEqual([0, 0]);
  });

  it('the reading check flags a message pushed away too fast', () => {
    const placed = (script: string, span: number) => ({ id: 'thread', layer: { name: 'Thread', type: 'chat.thread' }, node: { type: 'chat.thread' }, props: { script, size: 30, progress: { $k: [{ t: 0, v: 0 }, { t: span, v: 1 }] } }, opacity: 1, box: null });
    const comp = { width: 1080, height: 1920, fps: 30, duration: 10 };
    const run = (script: string, span: number) => chat.checks[0].run({ doc: {}, compId: 'main', comp, registry: null, evaluator: null, step: 0.25, samples: [{ t: 0, layers: [placed(script, span)] }] } as never) as { severity: string }[];
    const script = 'A: hello there\nB: a longer answer\nC: final line';
    expect(run(script, 12).filter((i) => i.severity === 'warning').length).toBe(0);
    expect(run(script, 4).some((i) => i.severity === 'warning')).toBe(true);
  });

  it('the tool times a thread, full frame in 9:16 and in the phone in 16:9', async () => {
    const script = 'A: are you seeing this?\nB: just landed 👀\nA: no way';
    for (const [w, h] of [[1080, 1920], [1920, 1080]] as [number, number][]) {
      const { doc } = newProject({ name: 'T', width: w, height: h, fps: 30, duration: 12 });
      const out = await runTool(chat.tools[0], doc, { script });
      expect(out.ops.length).toBeGreaterThan(0);
      for (const b of boxesOf(applyOps(doc, out.ops).doc)) expect(inside(b, w, h)).toBe(true);
      expect(out.text).toMatch(/timed by reading/);
    }
  });
});

describe('emoji', () => {
  const index = {
    emoji: [
      { name: 'partying face', file: 'partying-face.svg', codepoint: '1F389', keywords: ['partying', 'face'] },
      { name: 'fire', file: 'fire.svg', codepoint: '1F525', keywords: ['fire'] },
      { name: 'sparkles', file: 'sparkles.svg', codepoint: '2728', keywords: ['sparkles'] },
    ],
  };

  it('finds by name, keyword and character', () => {
    expect(searchEmoji(index, 'party')).toContain('partying face');
    expect(searchEmoji(index, 'fire')[0]).toBe('fire');
    expect(searchEmoji(index, '🔥')[0]).toBe('fire');
    expect(searchEmoji(index, 'zzzq')).toEqual([]);
  });

  it('places the emoji as picture layers, only the files used copied', async () => {
    const data = readFileSync(new URL('../../../plugins/emoji/index.json', import.meta.url), 'utf8');
    const { doc } = newProject({ name: 'T', width: 1080, height: 1920, fps: 30, duration: 6 });
    const written = new Map<string, string>();
    const out = await runTool(emoji.tools[0], doc, { emoji: 'fire, sparkles', layout: 'row', size: 240 }, {
      files: { 'index.json': data },
      extra: { writeFile: async (path: string, text: string) => { written.set(path, text as string); return path; } },
    });
    const next = applyOps(doc, out.ops).doc;
    const images = Object.values(next.assets).filter((x) => x.type === 'image');
    expect(images).toHaveLength(2);
    expect(written.size).toBe(2);
    const layers = Object.values(next.compositions.main.layers).filter((l) => l.type === 'image');
    expect(layers).toHaveLength(2);
    for (const b of boxesOf(next)) expect(inside(b, 1080, 1920)).toBe(true);
  });
});

describe('maps', () => {
  const places = JSON.parse(readFileSync(new URL('../../../plugins/maps/places.json', import.meta.url), 'utf8')).places;
  const countries = JSON.parse(readFileSync(new URL('../../../plugins/maps/countries-110m.json', import.meta.url), 'utf8')).countries;

  it('projects the world it says, the globe refusing its far side', () => {
    expect(project('equirect', [0, 0])).toEqual([0, 0]);
    // the plate carrée is twice as wide as it is tall: a degree is a degree each way
    expect(project('equirect', [90, 45])).toEqual([0.25, -0.125]);
    expect(project('ortho', [180, 0], { center: [0, 0] })).toBeNull();
    expect(project('ortho', [0, 0], { center: [0, 0] })).toEqual([0, 0]);
    expect(project('naturalEarth', [180, 0])![0]).toBeCloseTo(0.5, 3);
  });

  it('finds places with accents folded, aliases known, ambiguity a question', () => {
    expect(findPlace(places, countries, 'sao paulo')[0].name).toBe('São Paulo');
    expect(findPlace(places, countries, 'Zurich')[0].name).toBe('Zürich');
    // an ambiguous name: several answers, the biggest first
    const springfield = findPlace(places, countries, 'springfield');
    expect(springfield.length).toBeGreaterThan(1);
    expect(springfield[0].pop).toBeGreaterThanOrEqual(springfield[1].pop);
    expect(findPlace(places, countries, 'Paris')[0].country).toBe('France');
    expect(findPlace(places, countries, 'NYC')[0].name).toContain('New York');
    expect(findPlace(places, countries, 'zzzq')).toEqual([]);
  });

  it('flies the great circle the short way, and lands the zoom exactly', () => {
    const gc = greatCircle([0, 0], [90, 0], 8);
    expect(gc[4]).toEqual([45, 0]);
    expect(gc[0]).toEqual([0, 0]);
    expect(gc[8]).toEqual([90, 0]);
    // the antimeridian: Los Angeles to Tokyo crosses the Pacific, not Europe
    const pacific = greatCircle([-118, 34], [139.7, 35.7], 16);
    const lons = pacific.map((p) => p[0]);
    expect(Math.max(...lons)).toBeLessThan(180);
    const path = zoomPath({ center: [0, 0], zoom: 1 }, { center: [10, 20], zoom: 4 });
    expect(path(0)).toEqual({ center: [0, 0], zoom: 1 });
    expect(path(1)).toEqual({ center: [10, 20], zoom: 4 });
    // it zooms out on the way: the middle sees more world than either end
    expect(path(0.5).zoom).toBeLessThan(2);
  });

  it('the tool writes only the shapes the map shows', async () => {
    const { doc } = newProject({ name: 'T', width: 1920, height: 1080, fps: 30, duration: 6 });
    const written = new Map<string, string>();
    const out = await runTool(maps.tools[0], doc, { places: 'Lyon, Dakar', route: true }, { extra: { writeFile: async (p: string, d: string) => { written.set(p, d); return p; } } });
    expect(out.ops.length).toBeGreaterThan(0);
    const atlas = written.get([...written.keys()][0])!;
    expect(atlas).toBeDefined();
    const data = JSON.parse(atlas);
    expect(data.countries.map((c: { name: string }) => c.name).sort()).toEqual(['France', 'Senegal']);
    const full = readFileSync(new URL('../../../plugins/maps/countries-50m.json', import.meta.url), 'utf8');
    expect(atlas.length).toBeLessThan(full.length * 0.05);
    for (const b of boxesOf(applyOps(doc, out.ops).doc)) expect(inside(b, 1920, 1080)).toBe(true);
  });
});

describe('audiogram', () => {
  it('the bars read the bands, linear between the frames', () => {
    // one band, four frames: 0.2, 0.3, 0.4, 0.5 — the bars walk it
    const bands = [[0.2, 0.3, 0.4, 0.5]];
    expect(barsAt(bands, 10, 0.05, 1)).toEqual([0.25]); // exactly between two frames: the mean
    expect(barsAt(bands, 10, 0.0, 1)).toEqual([0.2]);
    expect(barsAt(bands, 10, 0.3, 1)).toEqual([0.5]);
    // two bands, both read; an empty analysis stays silent
    expect(barsAt([[0.2, 0.6], [0.4, 0.8]], 10, 0.05, 2).map((v) => +v.toFixed(6))).toEqual([0.4, 0.6]);
    expect(barsAt([], 10, 0, 4)).toEqual([0, 0, 0, 0]);
  });

  it('the tool builds the clip from an analysis with bands, and refuses one without', async () => {
    const analysis = JSON.stringify({ version: 1, kind: 'audio-analysis', duration: 60, rate: 50, envelope: { rms: [], low: [], mid: [], high: [] }, onsets: [], tempo: null, beats: [], downbeats: [], sections: [], bands: Array.from({ length: 32 }, () => [0.2, 0.5]) });
    for (const [w, h] of [[1080, 1920], [1920, 1080]] as [number, number][]) {
      const { doc } = newProject({ name: 'T', width: w, height: h, fps: 30, duration: 30 });
      doc.assets.talk = { type: 'audio', src: 'assets/audio/talk.mp3', name: 'Talk' } as never;
      doc.assets['analysis-talk'] = { type: 'json', src: 'assets/analyses/talk.json' } as never;
      const out = await runTool(audiogram.tools[0], doc, { asset: 'talk', name: 'The Show' }, { extra: { readText: async () => analysis } });
      const next = applyOps(doc, out.ops).doc;
      const cid = Object.keys(next.compositions).find((k) => k.startsWith('audiogram-'))!;
      const wave = Object.values(next.compositions[cid].layers).find((l) => l.type === 'audiogram.wave')!;
      expect(wave.props!.analysis).toBe('analysis-talk');
      expect(out.text).toMatch(/bands/);
      for (const b of boxesOf(next)) expect(inside(b, w, h)).toBe(true);
    }
    const { doc } = newProject({ name: 'T', width: 1080, height: 1920, fps: 30, duration: 30 });
    doc.assets.talk = { type: 'audio', src: 'assets/audio/talk.mp3' } as never;
    doc.assets['analysis-talk'] = { type: 'json', src: 'assets/analyses/talk.json' } as never;
    await expect(runTool(audiogram.tools[0], doc, { asset: 'talk' }, { extra: { readText: async () => '{"kind":"audio-analysis"}' } })).rejects.toThrow(/bands/);
  });

  it('the analysis asset stays bounded: 30 minutes under 6 MB', () => {
    // the bands are saved at 12.5 Hz, two decimals: 32 bands x 22 500 frames for half an hour
    const frame = JSON.stringify({ bands: Array.from({ length: 32 }, () => [0.42]) });
    const perFrame = frame.length - '[]'.length;
    expect(perFrame * 12.5 * 1800).toBeLessThan(6e6);
  });
});

describe('math', () => {
  const glyphs = JSON.parse(readFileSync(new URL('../../../plugins/math/glyphs.json', import.meta.url), 'utf8'));
  const B = String.fromCharCode(92);

  it('parses the subset it says, and names its errors', () => {
    const f = parseTex(B + 'frac{a}{b}');
    expect(f.t).toBe('frac');
    expect((f as { a: { ch: string } }).a.ch).toBe('a');
    expect((f as { b: { ch: string } }).b.ch).toBe('b');
    expect(() => parseTex(B + 'foo')).toThrow(/position 0/);
    expect(parseTex('x^2')).toMatchObject({ t: 'script', base: { ch: 'x' }, sup: { ch: '2' } });
    expect(parseTex(B + 'alpha')).toEqual({ t: 'sym', ch: 'α' });
    expect((parseTex(B + 'begin{pmatrix} a & b ' + B + B + ' c & d ' + B + 'end{pmatrix}') as { rows: unknown[][] }).rows).toHaveLength(2);
    expect(parseTex(B + 'sum_{i=1}^{n}')).toMatchObject({ t: 'big', ch: '∑' });
  });

  it('lays x^2 with the 2 smaller and higher, the same every time', () => {
    const L = layout(parseTex('x^2'), 48, glyphs);
    // the variable in the font's math italic, the figure upright
    const x = L.placed.find((p) => p.id === 'x#1')!;
    const two = L.placed.find((p) => p.id === '2#1')!;
    expect(x.glyph).toBe('𝑥');
    expect(two.glyph).toBe('2');
    expect(two.scale).toBeLessThan(x.scale);
    expect(two.y).toBeLessThan(x.y);
    expect(JSON.stringify(L)).toBe(JSON.stringify(layout(parseTex('x^2'), 48, glyphs)));
  });

  it('matches the symbols two formulas share, the a with the a', () => {
    const A = layout(parseTex('a+b'), 48, glyphs), Bm = layout(parseTex('b+a'), 48, glyphs);
    const pairs = matchSymbols(A, Bm);
    const sym = (id: string) => id.split('#')[0];
    const ofA = (i: number) => sym(A.placed[i].id), ofB = (j: number) => sym(Bm.placed[j].id);
    expect(pairs.map(([i, j]) => [ofA(i), ofB(j)])).toContainEqual(['a', 'a']);
    expect(pairs.map(([i, j]) => [ofA(i), ofB(j)])).toContainEqual(['b', 'b']);
    expect(pairs).toHaveLength(3);
  });

  it('the tool lays the formula and copies the glyphs, in both formats', async () => {
    for (const [w, h] of [[1920, 1080], [1080, 1920]] as [number, number][]) {
      const { doc } = newProject({ name: 'T', width: w, height: h, fps: 30, duration: 8 });
      const out = await runTool(math.tools[0], doc, { tex: 'a^2 + b^2 = c^2' });
      const next = applyOps(doc, out.ops).doc;
      expect(Object.values(next.assets).some((x) => x.name === 'Math glyphs')).toBe(true);
      expect(out.text).toMatch(/STIX Two Math/);
      for (const b of boxesOf(next)) expect(inside(b, w, h)).toBe(true);
    }
  });
});

describe('matter', () => {
  const square = { v: [[0, 0], [100, 0], [100, 100], [0, 100]], closed: true };

  it('walks a path at equal speed, its starts matched without a twist', () => {
    // nine points on a 100-square: the samples land on its corners, so the chords are the arcs
    const pts = resample(square, 9);
    expect(pts).toHaveLength(9);
    for (let i = 1; i < pts.length; i++) {
      const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      expect(Math.abs(seg - 50)).toBeLessThan(1e-6);
    }
    const eight = resample(square, 8);
    expect(eight).toHaveLength(8);
    // an asymmetric shape's list rotated by 2: the answer is 2 (a square is its own every quarter turn)
    const blob = { v: [[0, 0], [120, -30], [200, 40], [160, 140], [40, 180], [-60, 120], [-80, 10]], closed: true };
    const shape = resample(blob, 24);
    const shift = shape.slice(-2).concat(shape.slice(0, -2)); // its vertex 0 stands where a's vertex 2 was
    expect(bestStart(shape, shift)).toBe(2);
    expect(bestStart(shape, shape)).toBe(0);
  });

  it('traces a circle the marching squares find whole, within a cell', () => {
    const R = 60, cx = 100, cy = 100;
    const loops = marchingSquares((x: number, y: number) => Math.hypot(x - cx, y - cy) < R ? 1 : 0, 200, 200, 10, 0.5);
    // the field is a step: take a smoother one for the interpolation
    const soft = marchingSquares((x: number, y: number) => 1 - Math.hypot(x - cx, y - cy) / R, 200, 200, 10, 0.001);
    expect(loops.length).toBeGreaterThanOrEqual(1);
    expect(soft).toHaveLength(1);
    const loop = soft[0];
    const dists = loop.map((pt: number[]) => Math.hypot(pt[0] - cx, pt[1] - cy));
    expect(Math.max(...dists)).toBeLessThan(R + 10);
    expect(Math.min(...dists)).toBeGreaterThan(R - 10);
    // closed: the loop comes back to its start
    expect(loop[0]).toEqual(loop[loop.length - 1]);
  });

  it('the liquid answers any frame in any order, the paper torn by its seed', () => {
    const alone = JSON.stringify(liquidField(3, 50 / 30, 6));
    let reached = '';
    for (let f = 0; f <= 50; f++) reached = JSON.stringify(liquidField(3, f / 30, 6));
    expect(reached).toBe(alone);
    expect(JSON.stringify(liquidField(3, 50 / 30, 6))).toBe(JSON.stringify(liquidField(3, 50 / 30, 6)));
    expect(JSON.stringify(liquidField(4, 50 / 30, 6))).not.toBe(alone);
    const e = tornEdge(400, 7, 16);
    expect(e.length).toBeGreaterThan(8);
    expect(tornEdge(400, 7, 16)).toEqual(e);
    expect(JSON.stringify(tornEdge(400, 8, 16))).not.toBe(JSON.stringify(e));
  });

  it('the nodes draw from the tokens, any frame in any order', async () => {
    for (const [w, h] of [[1920, 1080], [1080, 1920]] as [number, number][]) {
      const { doc } = newProject({ name: 'T', width: w, height: h, fps: 30, duration: 4 });
      doc.tokens.accent = { type: 'color', value: '#2EC4B6' } as never;
      doc.compositions.main.layers.m = { type: 'matter.morph', props: { progress: { $k: [{ t: 0, v: 0 }, { t: 1.2, v: 1 }] } } } as never;
      doc.compositions.main.layers.l = { type: 'matter.liquid', in: 1, out: 4, props: { progress: 1 } } as never;
      doc.compositions.main.order = ['m', 'l'];
      expect(validate(doc, registryOf())).toEqual([]);
    }
  });
});

describe('rigid bodies', () => {
  const ground = (y = -300) => ({
    gravity: [0, 900],
    bodies: [
      { id: 'b', kind: 'box', x: 0, y, w: 120, h: 120, mass: 1, inertia: 2400, restitution: 0.2, friction: 0.5 },
      { id: 'floor', kind: 'box', x: 0, y: 60, w: 3000, h: 80, static: true, mass: 0, inertia: 0, restitution: 0.2, friction: 0.5 },
    ],
  });
  const stack = () => ({
    gravity: [0, 900],
    bodies: [
      { id: 'a', kind: 'box', x: 0, y: -52, w: 100, h: 100, mass: 1, inertia: 1700, restitution: 0.1, friction: 0.6 },
      { id: 'b2', kind: 'box', x: 0, y: -154, w: 100, h: 100, mass: 1, inertia: 1700, restitution: 0.1, friction: 0.6 },
      { id: 'c', kind: 'box', x: 0, y: -256, w: 100, h: 100, mass: 1, inertia: 1700, restitution: 0.1, friction: 0.6 },
      { id: 'floor', kind: 'box', x: 0, y: 40, w: 3000, h: 80, static: true, mass: 0, inertia: 0, restitution: 0.1, friction: 0.6 },
    ],
  });

  it('a box resting on the ground stays still, and sleeps', () => {
    let w = ground();
    for (let k = 0; k < 240; k++) w = stepWorld(w, 1 / 30);
    const at = w.bodies[0].y;
    for (let k = 0; k < 60; k++) w = stepWorld(w, 1 / 30);
    expect(Math.abs(w.bodies[0].y - at)).toBeLessThan(0.5);
    expect((w.bodies[0] as unknown as { asleep: boolean }).asleep).toBe(true);
  });

  it('a stack of three holds', () => {
    let w = stack();
    for (let k = 0; k < 300; k++) w = stepWorld(w, 1 / 30);
    // the boxes stay level and roughly a hundred apart
    for (const b of w.bodies.slice(0, 3)) expect(Math.abs((b as unknown as { angle: number }).angle)).toBeLessThan(0.1);
    expect(w.bodies[1].y - w.bodies[0].y).toBeLessThan(-60);
    expect(w.bodies[2].y - w.bodies[1].y).toBeLessThan(-60);
  });

  it('any frame in any order: frame 90 reached directly equals frame 90 frame by frame', () => {
    const run = (steps: number) => { let w = stack() as never; for (let k = 0; k < steps; k++) w = stepWorld(w, 1 / 30) as never; return w; };
    const direct = run(90);
    let resumed = run(45);
    for (let k = 0; k < 45; k++) resumed = stepWorld(resumed, 1 / 30) as never;
    expect(JSON.stringify(resumed)).toBe(JSON.stringify(direct));
  });

  it('the bodies node validates and its letters pile up', async () => {
    const { doc } = newProject({ name: 'T', width: 1920, height: 1080, fps: 30, duration: 4 });
    doc.compositions.main.layers.p = { type: 'phys.bodies', props: {} } as never;
    doc.compositions.main.order = ['p'];
    expect(validate(doc, registryOf())).toEqual([]);
    // the drop's letters are bodies now: the state carries a world
    const node = physics.nodes.find((n) => n.type === 'phys.text-drop')!;
    const state = node.simulate!.init({ text: 'HEY', size: 100, per: 0.05, height: 1, bounciness: 0.3 } as never, { width: 1920, height: 1080 } as never) as { world: { bodies: { id: string; static?: boolean }[] }; t: number };
    expect(state.world.bodies.filter((b: { static?: boolean }) => !b.static)).toHaveLength(3);
    let s: { world: { bodies: { id: string; static?: boolean; asleep?: boolean }[] }; t: number } = state;
    for (let k = 0; k < 150; k++) s = node.simulate!.step(s, { text: 'HEY', size: 100, per: 0.05, height: 1, bounciness: 0.3 } as never, 1 / 30) as typeof s;
    const settled = s.world.bodies.filter((b: { static?: boolean }) => !b.static);
    expect(settled.every((b: { asleep?: boolean }) => b.asleep)).toBe(true);
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

  it('1.1: reads a CSV the way spreadsheets write them', () => {
    expect(parseCsv('a;b\n"x;y";1,5')).toEqual([['a', 'b'], ['x;y', '1,5']]);
    expect(parseCsv('a,b,c\n1,"x, y",3')).toEqual([['a', 'b', 'c'], ['1', 'x, y', '3']]);
    expect(parseCsv('a\tb\n1\t"say ""hi"""')).toEqual([['a', 'b'], ['1', 'say "hi"']]);
    expect(csvNumber('1,5')).toBe(1.5);
    expect(csvNumber('2.5')).toBe(2.5);
    // the ranks over time, ties by name, entries arriving and leaving
    const ranks = ranksOver([{ period: '2000', values: { b: 2, a: 2, c: 1 } }, { period: '2001', values: { a: 5, d: 3 } }]);
    expect(ranks[0].rank).toEqual({ a: 1, b: 2, c: 3 });
    expect(ranks[1].rank).toEqual({ a: 1, d: 2 });
    expect(ticks(0, 97)).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it('1.1: the race tool reads a 200-entry CSV, keeps the leaders, says the cut', async () => {
    const names = Array.from({ length: 200 }, (_, i) => `entry-${String(i + 1).padStart(3, '0')}`);
    const header = ['period', ...names].join(';');
    const rows = [0, 1, 2, 3].map((p) => ['20' + p, ...names.map((n, i) => String(i + p).replace('.', ','))].join(';'));
    const csv = [header, ...rows].join('\n');
    for (const [w, h, cap] of [[1080, 1920, 12], [1920, 1080, 20]] as [number, number, number][]) {
      const { doc } = newProject({ name: 'T', width: w, height: h, fps: 30, duration: 10 });
      doc.assets.race = { type: 'json', src: 'assets/data/race.csv', name: 'Race' } as never;
      const out = await runTool(charts.tools[0], doc, { data: 'race', kind: 'race' }, { extra: { readText: async () => csv } });
      const next = applyOps(doc, out.ops).doc;
      const layer = Object.values(Object.values(next.compositions).find((c) => Object.values(c.layers).some((l) => l.type === 'chart.race'))!.layers).find((l) => l.type === 'chart.race')!;
      expect(layer.props!.entries).toBe(cap);
      expect((layer.props!.table as { values: Record<string, number> }[])[0].values && Object.keys((layer.props!.table as { values: Record<string, number> }[])[0].values)).toHaveLength(cap);
      expect(out.text).toMatch(/left out/);
      for (const b of boxesOf(next)) expect(inside(b, w, h)).toBe(true);
    }
  });

  it('1.1: the race tool reads a decimal comma as a number', () => {
    const csv = 'period;Alpha;Beta\n2000;"1,5";2\n2001;3;"0,5"';
    const table = tableOf(csv);
    expect(table[0].values).toEqual({ Alpha: 1.5, Beta: 2 });
    expect(table[1].values).toEqual({ Alpha: 3, Beta: 0.5 });
  });

  it('1.1: the readability check flags 13 entries racing in 9:16 and colliding labels', () => {
    const placed = (type: string, props: object, name: string) => ({ id: name.toLowerCase(), layer: { name, type }, node: { type }, props, opacity: 1, box: null });
    const run = (width: number, height: number, layers: object[]) => charts.checks[0].run({
      doc: {}, compId: 'main', comp: { width, height }, registry: null, evaluator: null, step: 0.25,
      samples: [{ t: 0, layers }],
    } as never) as { message: string }[];
    const race = (entries: number) => placed('chart.race', { table: [{ period: 'p', values: {} }], entries }, 'Race');
    expect(run(1080, 1920, [race(13)]).length).toBeGreaterThan(0);
    expect(run(1080, 1920, [race(12)]).every((i) => !i.message.includes('racing'))).toBe(true);
    const scatter = placed('chart.scatter', { labels: true, values: [{ name: 'A', x: 10, y: 10 }, { name: 'B', x: 12, y: 12 }] }, 'Scatter');
    expect(run(1920, 1080, [scatter]).some((i) => i.message.includes('collide'))).toBe(true);
  });
});

describe('kinetic type', () => {
  it('scramble settles on the text, left to right, the same for a seed', () => {
    const text = 'NOVA 7';
    const at = (t: number, seed = 1) => [...text].map((ch, i) => scrambleAt(ch, i, t, 0, i * 0.07 + 0.5, seed) ?? '').join('');
    expect(at(10)).toBe(text);
    expect(at(0.3)).toBe(at(0.3));
    expect(at(0.3)).not.toBe(text);
    expect(at(0.3, 2)).not.toBe(at(0.3, 1));
    // the first letter settles before the last one; a space never scrambles
    expect(scrambleAt('N', 0, 0.55, 0, 0.5, 1)).toBe('N');
    expect(scrambleAt('7', 5, 0.55, 0, 0.85, 1)).not.toBe('7');
    expect(scrambleAt(' ', 4, 0.1, 0, 0.78, 1)).toBe(' ');
    expect(scrambleAt('N', 0, -0.1, 0, 0.5, 1)).toBeNull();
  });

  it('flap goes through the drum in order and rests on its character', () => {
    const seen: string[] = [];
    for (let t = 0.001; t < 3; t += 1 / 60) { const s = flapAt('D', t, 0); if (seen.at(-1) !== s.from) seen.push(s.from); }
    expect(seen).toEqual([' ', 'A', 'B', 'C', 'D']);
    expect(flapAt('D', 3, 0)).toEqual({ from: 'D', to: 'D', phase: 0 });
    // a character off the drum goes round once, then shows itself
    const off = flapAt('é', 10, 0);
    expect(off).toEqual({ from: 'é', to: 'é', phase: 0 });
    expect(FLAPS.length * (1 / 15)).toBeLessThan(10);
    // the same moment, the same flap
    expect(flapAt('Z', 0.42, 0.1)).toEqual(flapAt('Z', 0.42, 0.1));
  });

  it('draws both modes, the flap board within its bounds', () => {
    const node = kinetic.nodes[0];
    const host = (t: number) => ({ layerId: 'k', t, frame: Math.round(t * 30), fps: 30, width: 1080, height: 1920, duration: 4, asset: () => null, assetInfo: () => ({}), assetUrl: () => '' }) as never;
    for (const mode of ['scramble', 'flap']) {
      for (const t of [0.05, 0.3, 2]) {
        const ctx = recorder();
        node.render.canvas2d!(ctx, { text: 'GATE 12', mode, size: 100, weight: 800, color: '#ffffff', align: 'center', tracking: 0, lineHeight: 1.15, stagger: 0.06, duration: 0.4, font: null, seed: 1, plate: '#15181d' } as never, host(t));
        expect(ctx.calls.some((c) => c.startsWith('fillText('))).toBe(true);
      }
    }
    const b = node.bounds!({ text: 'GATE 12', mode: 'flap', size: 100, lineHeight: 1.15 } as never)!;
    expect(b.w).toBeCloseTo(7 * 100 * 0.84 - 8, 6);
  });

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

describe('the fixes of the packs', () => {
  const host = (extra: Record<string, unknown> = {}) => ({ layerId: 'a', t: 1, frame: 30, fps: 30, width: 1920, height: 1080, duration: 6, asset: () => null, assetInfo: () => ({}), assetUrl: () => '', ...extra }) as never;

  it('screencast: the zoom brings the action to the centre without showing past the picture\'s edge', () => {
    const frame = { w: 1920, h: 1080 };
    // a point right of centre at 2x: the picture moves left, its right edge stays on the frame's
    const P = positionFor([1500, 540], 2, frame);
    expect(P[0]).toBeLessThan(960);
    expect(P[0]).toBeGreaterThanOrEqual(960 - 960);
    // a corner asks too much: clamped so the picture still covers the frame
    const C = positionFor([1920, 1080], 2, frame);
    expect(C).toEqual([0, 0]);
    expect(positionFor([200, 200], 1, frame)).toEqual([960, 540]);
  });

  it('screencast: the tool keys scale and position on the composition\'s clock, from the layer\'s start', async () => {
    const W = 320, H = 180;
    const page = (dot: boolean) => { const px = new Uint8ClampedArray(W * H * 4).fill(240); if (dot) for (let y = 60; y < 90; y++) for (let x = 200; x < 230; x++) { const i = (y * W + x) * 4; px[i] = px[i + 1] = px[i + 2] = 20; } return px; };
    const { doc } = newProject({ name: 'T', width: W, height: H, fps: 30, duration: 10 });
    doc.assets.rec = { type: 'video', src: 'assets/video/rec.mp4', name: 'Rec' } as never;
    doc.compositions.main.layers.rec = { type: 'video', in: 1, out: 9, transform: { position: [W / 2, H / 2] }, props: { video: 'rec', size: [W, H] } } as never;
    doc.compositions.main.order = ['rec'];
    // a mark blinks on the page from 2 s to 5 s of the recording: activity at each look
    const out = await runTool(screencast.tools[0], doc, { layer: 'rec' }, { extra: { readStill: async (t: number) => ({ data: page(t >= 2 && t < 5 && Math.round(t * 2) % 2 === 0), w: W, h: H }) } });
    const scale = out.ops.find((o) => o.path.endsWith('/transform/scale')) as { value: { $k: { t: number; v: number[] }[] } } | undefined;
    const position = out.ops.find((o) => o.path.endsWith('/transform/position')) as { value: { $k: { t: number; v: number[] }[] } } | undefined;
    expect(scale && position).toBeTruthy();
    // the recording's 2 s are the composition's 3 s
    expect(scale!.value.$k[0].t).toBeGreaterThanOrEqual(3 - 1e-6);
    expect(position!.value.$k.map((k) => k.t)).toEqual(scale!.value.$k.map((k) => k.t));
    // the zoomed keys move the picture toward the mark (right and up of centre: the layer goes left and down)
    const zoomed = position!.value.$k.find((_, i) => scale!.value.$k[i].v[0] > 1.05)!;
    expect(zoomed.v[0]).toBeLessThan(W / 2);
    // its own check stays silent on what it keyed
    const next = applyOps(doc, out.ops as never).doc;
    const issues = screencast.checks[0].run({ doc: next, compId: 'main', comp: next.compositions.main, samples: [], data: () => null } as never) as unknown[];
    expect(issues).toEqual([]);
  });

  it('audiogram: the wave shows the extract, not the whole sound, and its meter falls back slowly', () => {
    expect(soundTime({ from: 30, span: 10, progress: 0.5 }, 120)).toBeCloseTo(35, 6);
    expect(soundTime({ progress: 1 }, 60)).toBeCloseTo(59.99, 2);
    // a band loud at 1 s then silent: just after, the meter still shows it, fading
    const bands = [[0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]];
    const now = barsAt(bands, 4, 1.25, 1)[0], meter = meterAt(bands, 4, 1.25, 1)[0];
    expect(now).toBe(0);
    expect(meter).toBeGreaterThan(0.2);
    expect(meterAt(bands, 4, 2, 1)[0]).toBe(0);
  });

  it('audiogram: the bars stay in their box, every style drawn without error', () => {
    const analysis = { duration: 4, rate: 50, bandsRate: 12.5, bands: Array.from({ length: 32 }, () => Array(50).fill(1)) };
    for (const style of ['bars', 'mirror', 'line', 'ring']) {
      const ctx = recorder();
      audiogram.nodes[0].render.canvas2d!(ctx, { analysis: 'a', style, count: 16, fill: '#fff', ink: '#fff', from: 0, span: 4, progress: 0.5, size: [400, 100] } as never, host({ asset: () => analysis }));
      for (const c of ctx.calls.filter((x) => x.startsWith('roundRect('))) {
        const [, y, , h] = c.slice(10, -1).split(',').map(Number);
        expect(y).toBeGreaterThanOrEqual(-51);
        expect(y + h).toBeLessThanOrEqual(51);
      }
    }
  });

  it('audiogram: a video\'s sound plays from the video itself, the tool\'s operations valid', async () => {
    const analysis = JSON.stringify({ version: 1, kind: 'audio-analysis', duration: 60, rate: 50, envelope: { rms: [], low: [], mid: [], high: [] }, onsets: [], tempo: null, beats: [], downbeats: [], sections: [], bands: Array.from({ length: 32 }, () => [0.2, 0.5]) });
    const { doc } = newProject({ name: 'T', width: 1080, height: 1920, fps: 30, duration: 30 });
    doc.assets.talk = { type: 'video', src: 'assets/video/talk.mp4', name: 'Talk' } as never;
    doc.assets['analysis-talk'] = { type: 'json', src: 'assets/analyses/talk.json' } as never;
    doc.assets['transcription-talk'] = { type: 'json', src: 'assets/transcripts/talk.json' } as never;
    const out = await runTool(audiogram.tools[0], doc, { asset: 'talk', at: 12, duration: 20 }, { extra: { readText: async () => analysis } });
    const comp = Object.values(applyOps(doc, out.ops).doc.compositions).find((c) => c.name.startsWith('Audiogram'))!;
    const layers = Object.values(comp.layers);
    expect(layers.find((l) => l.type === 'video')?.props).toMatchObject({ video: 'talk', start: 12 });
    expect(layers.find((l) => l.type === 'audiogram.wave')?.props).toMatchObject({ from: 12, span: 20 });
    expect(layers.find((l) => l.type === 'captions')?.props).toMatchObject({ transcript: 'transcription-talk', start: 12 });
  });

  it('codeview: a highlighted line keeps its place when the file is cut to what fits', async () => {
    const big = Array.from({ length: 400 }, (_, i) => `const v${i + 1} = ${i + 1};`).join('\n');
    const { doc } = newProject({ name: 'T', width: 1920, height: 1080, fps: 30, duration: 10 });
    const out = await runTool(codeview.tools[0], doc, { code: big, lines: [300] });
    const comp = Object.values(applyOps(doc, out.ops).doc.compositions).find((c) => c.name.startsWith('Code'))!;
    const screen = Object.values(comp.layers).find((l) => l.type === 'codeview.code')!;
    const code = String(screen.props!.code).split('\n'), hl = screen.props!.highlight as number[];
    expect(hl).toHaveLength(1);
    expect(code[hl[0] - 1]).toBe('const v300 = 300;');
  });

  it('codeview: the typing reveals the text in order, line breaks counted', () => {
    const code = 'ab\ncd\nef';
    const at = (progress: number) => {
      const ctx = recorder();
      codeview.nodes[0].render.canvas2d!(ctx, { code, lang: 'js', from: '', progress, highlight: [], size: 20, panel: [600, 400], ink: '#ffffff', accent: '#2ec4b6', accent2: '#2ec4b6', plate: '#0d1117', font: null } as never, host());
      return ctx.calls.filter((c) => c.startsWith('fillText(string')).length;
    };
    // more text drawn as the typing goes on, all of it at the end
    expect(at(0.3)).toBeLessThanOrEqual(at(0.7));
    expect(at(0.998)).toBeGreaterThanOrEqual(at(0.7));
  });

  it('math: a change between two formulas draws, centred on the layer', () => {
    const glyphs = JSON.parse(readFileSync(new URL('../../../plugins/math/glyphs.json', import.meta.url), 'utf8'));
    for (const progress of [0, 0.5, 1]) {
      const ctx = recorder();
      expect(() => math.nodes[0].render.canvas2d!(ctx, { tex: 'a^2 + b^2 = c^2', to: 'c = \\sqrt{a^2 + b^2}', glyphs: 'g', progress, size: 48, colours: {}, fill: '#fff', accent: '#2ec4b6', accent2: '#2ec4b6' } as never, host({ asset: () => glyphs }))).not.toThrow();
      // the first move is the centring: half the formula's width to the left
      const first = ctx.calls.find((c) => c.startsWith('translate('))!;
      expect(Number(first.slice(10).split(',')[0])).toBeLessThan(0);
    }
    // \text and \color read; a symbol the font lacks is refused by the tool before anything is written
    expect(() => parseTex('\\color{accent}{x} + \\text{area}')).not.toThrow();
  });

  it('math: the tool reuses the glyph table a project already holds', async () => {
    const { doc } = newProject({ name: 'T', width: 1920, height: 1080, fps: 30, duration: 6 });
    const first = await runTool(math.tools[0], doc, { tex: 'a + b' });
    const after = applyOps(doc, first.ops).doc;
    const second = await runTool(math.tools[0], after, { tex: 'x^2' });
    expect(second.ops.filter((o) => o.path.startsWith('/assets/'))).toEqual([]);
    await expect(runTool(math.tools[0], doc, { tex: 'a ⊕ b' })).rejects.toThrow(/no glyph/);
  });

  it('matter: contours paired by size, wound alike, the extra one growing from a point', () => {
    const sq = (x: number, y: number, s: number) => ({ v: [[x, y], [x + s, y], [x + s, y + s], [x, y + s]], closed: true });
    const pairs = pairContours([sq(0, 0, 100)], [sq(0, 0, 100), sq(300, 0, 20)], 16);
    expect(pairs).toHaveLength(2);
    // the small square of the second shape grows from its centre
    const grow = pairs[1];
    expect(new Set(grow[0].map((p: number[]) => p.join(','))).size).toBe(1);
    // a shape walked the other way is turned round before the morph
    const A = resample(sq(0, 0, 100), 9).slice(0, 8), B = [...A].reverse();
    expect(aligned(A, B)).toEqual(A);
  });

  it('matter: the morph reads the Béziers, not only the vertices', () => {
    // a circle of four vertices and their tangents: its outline is round, not a diamond
    const k = 55.2;
    const circle = { v: [[100, 0], [0, 100], [-100, 0], [0, -100]], i: [[0, -k], [k, 0], [0, k], [-k, 0]], o: [[0, k], [-k, 0], [0, -k], [k, 0]], closed: true };
    const pts = resample(circle, 33);
    for (const [x, y] of pts) expect(Math.hypot(x, y)).toBeGreaterThan(97);
  });

  it('matter: the flood covers the frame at 1 and leaves it dry at 0; the paper covers it at the cut', () => {
    const draw = (progress: number) => {
      const ctx = recorder();
      matter.nodes[1].render.canvas2d!(ctx, { seed: 1, blobs: 6, mode: 'flood', progress, speed: 1, cell: 20, fill: '#fff', size: [400, 240] } as never, host());
      return ctx.calls.filter((c) => c.startsWith('lineTo(')).length;
    };
    expect(draw(0)).toBe(0);
    expect(draw(1)).toBeGreaterThan(0);
    const { outline } = sheetOf(1920, 1080, 0.5, 1, 16);
    const xs = outline.map((p: number[]) => p[0]), ys = outline.map((p: number[]) => p[1]);
    expect(Math.min(...xs)).toBeLessThan(-960);
    expect(Math.max(...xs)).toBeGreaterThan(960);
    expect(Math.min(...ys)).toBeLessThan(-540);
    expect(Math.max(...ys)).toBeGreaterThan(540);
  });

  it('maps: the camera\'s centre lands in the middle, the world one aspect in any format', () => {
    for (const kind of ['equirect', 'naturalEarth', 'mercator', 'ortho']) {
      const c = toFrame(kind, [4.83, 45.76], [4.83, 45.76], 6, 1080)!;
      expect(Math.abs(c[0])).toBeLessThan(1e-6);
      expect(Math.abs(c[1])).toBeLessThan(1e-6);
    }
    // a degree east and a degree north cover the same pixels at the equator (equirect)
    const e = toFrame('equirect', [1, 0], [0, 0], 1, 1000)!, n = toFrame('equirect', [0, 1], [0, 0], 1, 1000)!;
    expect(Math.abs(e[0])).toBeCloseTo(Math.abs(n[1]), 6);
  });

  it('maps: labels kept apart, a flight never faster than the eye, the routes drawn in turn', () => {
    const pins = [{ name: 'Lyon', x: 0, y: 0 }, { name: 'Grenoble', x: 30, y: 4 }, { name: 'Dakar', x: 400, y: 300 }];
    const labels = placeLabels(pins, (s: string) => s.length * 12, 20);
    const boxes = labels.map((l, i) => l && { x: l.align === 'left' ? l.x : l.align === 'right' ? l.x - pins[i].name.length * 12 : l.x - (pins[i].name.length * 12) / 2, y: l.y - 10, w: pins[i].name.length * 12, h: 20 });
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a && b) expect(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y).toBe(false);
    }
    const f = flightKeys([{ lon: 4.8, lat: 45.7 }, { lon: -17.4, lat: 14.7 }], 12, { center: [-6, 30], zoom: 3 });
    for (let k = 1; k < f.keys.length; k++) {
      const dt = f.keys[k].t - f.keys[k - 1].t;
      if (dt > 0.05) expect(Math.abs(Math.log2(f.keys[k].z / f.keys[k - 1].z)) / dt).toBeLessThanOrEqual(1.7);
    }
    expect(f.keys.at(-1)).toMatchObject({ x: -6, y: 30, z: 3 });
    expect(routeShare(0.5, 0, 2)).toBe(1);
    expect(routeShare(0.5, 1, 2)).toBe(0);
  });

  it('maps: a still map exports its countries, routes and pins as SVG', () => {
    const shapes = { countries: [{ name: 'France', rings: [{ pts: [[-4, 48], [8, 49], [7, 43], [-1, 43]] }] }] };
    const svg = maps.nodes[0].export!.svg!({ shapes: 'atlas', projection: 'mercator', centerX: 2, centerY: 46, zoom: 8, highlight: ['France'], pins: [{ name: 'Lyon', lon: 4.8, lat: 45.7 }], routes: [], progress: 1, land: '#2b3440', plate: '#0e1420', accent: '#2ec4b6', ink: '#f4f5f7', labels: true, font: null } as never, { width: 1920, height: 1080, json: () => shapes });
    expect(svg).toMatch(/<path d="M/);
    expect(svg).toMatch(/fill="#2ec4b6"/);
    expect(svg).toMatch(/>Lyon</);
  });

  it('charts: a function needs no data set, a scatter reads its points, a race runs over the composition', async () => {
    const { doc } = newProject({ name: 'T', width: 1080, height: 1920, fps: 30, duration: 12 });
    const fn = await runTool(charts.tools[0], doc, { kind: 'function', points: [[0, 0], [0.5, 0.25], [1, 1]] });
    expect(fn.ops.length).toBeGreaterThan(0);
    doc.assets.pts = { type: 'json', src: 'assets/data/pts.json' } as never;
    const sc = await runTool(charts.tools[0], doc, { data: 'pts', kind: 'scatter' }, { extra: { readText: async () => JSON.stringify([{ name: 'A', x: 1, y: 2 }, { name: 'B', x: 3, y: 1 }]) } });
    const scatter = sc.ops.find((o) => (o as { value?: { type?: string } }).value?.type === 'chart.scatter') as { value: { props: { values: unknown[] } } };
    expect(scatter.value.props.values).toHaveLength(2);
    doc.assets.race = { type: 'json', src: 'assets/data/race.csv' } as never;
    const csv = 'year,A,B\n2000,1,2\n2001,3,1\n2002,4,5';
    const rc = await runTool(charts.tools[0], doc, { data: 'race', kind: 'race' }, { extra: { readText: async () => csv } });
    const race = rc.ops.find((o) => (o as { value?: { type?: string } }).value?.type === 'chart.race') as { value: { props: { progress: { $k: { t: number }[] } } } };
    expect(race.value.props.progress.$k.at(-1)!.t).toBeGreaterThan(2);
  });

  it('chat: the thread lives in the phone\'s screen, inside the frame in 16:9', async () => {
    const { doc } = newProject({ name: 'T', width: 1920, height: 1080, fps: 30, duration: 12 });
    const out = await runTool(chat.tools[0], doc, { script: 'A: hi\nB: hello 👀\nA: so?' });
    const comp = Object.values(applyOps(doc, out.ops).doc.compositions).find((c) => c.name === 'Chat')!;
    const thread = comp.layers.thread, phone = comp.layers.phone;
    const [sw, sh] = thread.props!.screen as number[], [pw, ph] = phone.props!.size as number[];
    expect(sw).toBeLessThan(pw);
    expect(sh).toBeLessThan(ph);
    expect(ph).toBeLessThanOrEqual(1080);
    expect(out.text).toMatch(/emoji tool/);
  });

  it('emoji: a chat thread\'s emoji become the pack\'s pictures', async () => {
    const { doc } = newProject({ name: 'T', width: 1080, height: 1920, fps: 30, duration: 6 });
    doc.compositions.main.layers.thread = { type: 'chat.thread', props: { script: 'A: look 🔥\nB: wow 👍🏽' } } as never;
    doc.compositions.main.order = ['thread'];
    const out = await runTool(emoji.tools[0], doc, { layer: 'thread' }, { extra: { writeFile: async (p: string) => p } });
    const map = (out.ops.find((o) => o.path.endsWith('/props/emoji')) as { value: Record<string, string> }).value;
    expect(Object.keys(map)).toContain('🔥');
    expect(Object.keys(map)).toContain('👍🏽');
  });

  it('handmade: twos jitter a position by pixels, a factor by a hundredth of that', () => {
    const at = (v: unknown) => handmade.modifiers[0].apply(v, { n: 2, jitter: 4 }, { t: 0.5, fps: 30, base: () => v, seed: 3 } as never);
    const moved = at([500, 300]) as number[];
    expect(Math.abs(moved[0] - 500) + Math.abs(moved[1] - 300)).toBeGreaterThan(0.01);
    const scale = at([1, 1]) as number[];
    expect(Math.abs(scale[0] - 1)).toBeLessThanOrEqual(0.04);
  });

  it('print: the risograph preset sets the inks the riso pass reads', () => {
    const riso = print.presets.find((p) => p.name === 'risograph')!;
    expect(Object.keys(riso.effects![0].props!)).toEqual(expect.arrayContaining(['inkA', 'inkB']));
  });
});

describe('qr', () => {
  // reference symbols from another encoder (segno, its byte-mode padding brought to the spec's): rows as hex, the top left module the highest bit
  const VECTORS = [
    { text: "tramme", level: 'L', version: 1, mask: 0, rows: ["1fc57f","104141","17545d","17415d","174b5d","104e41","1fd57f","1400","1df5c4","f1ea9","45ae3","18a3b2","f7ee3","1469","1fd11f","105043","175973","1742b6","1752fd","105382","1fd2e3"] },
    { text: "https://example.com", level: 'M', version: 2, mask: 1, rows: ["1fd547f","104dd41","175c95d","1749c5d","174a45d","105b441","1fd557f","9700","1467d25","1b9faeb","12ee29d","99f928","3f5b61","d1d363","1dd1fcd","2b5b8","1968df2","10d11","1fd6151","1040b13","174bbf3","1749096","1759fbb","104b7f0","1fdcd49"] },
    { text: 'x'.repeat(120), level: 'M', version: 7, mask: 2, rows: ["1fc10aeac97f","104820bf9a41","175d75153a5d","17582f40635d","17517bfac75d","105b091f9041","1fd55555557f","1d01153c00","17c0a9f06a7c","3f5eac3a3","86000bf95f6","1c8e04153c5c","184fbc406a09","706f9eac3a3","1569e3bf95f6","b636153c5c","1b6bdc406a09","1aa6e9eac3a3","e4903bf95f6","1e9646153c5c","ff9fdf06bf9","1716791ac313","b56855f9756","b14df153d1c","1ffa37f069f9","623bf4ac103","b7580ef96a6","b08d4b53efc","1edc13106959","41bbb4ac103","1640cef96a6","171944b53efc","bdc07106959","c1f8b4ac103","1647cef96a6","f19b4b53efc","137cc7f069f9","1c2b1ac113","1fc2675f9556","105a13153d1c","175649f06bf9","1752241ac253","1751614f9706","104f13e53dac","1fd54ab068fa"] },
  ];
  const rowsOf = (m: boolean[][]) => m.map((row) => BigInt('0b' + row.map((v) => (v ? '1' : '0')).join('')).toString(16));

  it('encodes the reference symbols module for module, the mask chosen by its penalty', () => {
    for (const v of VECTORS) {
      const code = qr.encodeQr(v.text, v.level);
      expect([code.version, code.mask], v.text.slice(0, 20)).toEqual([v.version, v.mask]);
      expect(rowsOf(code.matrix!)).toEqual(v.rows);
    }
  });

  it('computes the Reed-Solomon codewords, the format and version bits of the standard', () => {
    // HELLO WORLD at 1-M: its 16 data codewords and their 10 of correction
    expect(qr.rsRemainder([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
    expect(qr.formatBits('L', 0).toString(2).padStart(15, '0')).toBe('111011111000100');
    expect(qr.formatBits('M', 5).toString(2).padStart(15, '0')).toBe('100000011001110');
    expect(qr.versionBits(7)).toBe(0x07c94);
    expect(qr.versionBits(8)).toBe(0x085bc);
    expect(qr.alignmentPositions(7)).toEqual([6, 22, 38]);
    expect(qr.alignmentPositions(20)).toEqual([6, 34, 62, 90]);
    // the byte capacities of the standard's table
    expect(['L', 'M', 'Q', 'H'].map((l) => qr.byteCapacity(1, l))).toEqual([17, 14, 11, 7]);
    expect(['L', 'M', 'Q', 'H'].map((l) => qr.byteCapacity(10, l))).toEqual([271, 213, 151, 119]);
    expect(['L', 'M', 'Q', 'H'].map((l) => qr.byteCapacity(20, l))).toEqual([858, 666, 482, 382]);
  });

  it('scores the masks as the standard does', () => {
    const blank = Array.from({ length: 21 }, () => new Array(21).fill(false));
    // 21 runs of 21 each way (3 + 16 each), 400 blocks, no finder-like pattern, all light (10 x 10)
    expect(qr.penalty(blank)).toBe(21 * 2 * 19 + 400 * 3 + 100);
    const checker = Array.from({ length: 21 }, (_, y) => Array.from({ length: 21 }, (_, x) => (x + y) % 2 === 0));
    expect(qr.penalty(checker)).toBe(0);
  });

  it('grows the version with the text, the level, and refuses past version 20', () => {
    expect(qr.encodeQr('a', 'L').version).toBe(1);
    expect(qr.encodeQr('a'.repeat(18), 'L').version).toBe(2);
    expect(qr.encodeQr('a'.repeat(858), 'L').version).toBe(20);
    expect(() => qr.encodeQr('a'.repeat(859), 'L')).toThrow(/too long/);
    // UTF-8: an accent or an emoji takes its bytes
    expect(qr.encodeQr('é'.repeat(9), 'L').version).toBe(2);
  });

  it("leaves the picture's hole at level H, the reveal deterministic, any frame alone", () => {
    const hole = qr.pictureHole(41);
    expect(hole.to - hole.from).toBeLessThanOrEqual(Math.ceil(41 * 0.25));
    const draw = (progress: number) => {
      const ctx = recorder();
      qr.nodes[0].render.canvas2d!(ctx, { text: 'https://example.com', level: 'M', style: 'square', size: 400, quiet: 4, picture: null, progress, reveal: 'random', ink: '#111111', plate: '#ffffff' } as never, { layerId: 'q', t: 0, frame: 0, fps: 30, width: 1920, height: 1080, duration: 4, asset: () => null, assetInfo: () => ({}), assetUrl: () => '' } as never);
      return ctx.calls.filter((c) => c.startsWith('fillRect(')).length;
    };
    expect(draw(0.5)).toBe(draw(0.5));
    expect(draw(0.2)).toBeLessThan(draw(0.8));
    expect(draw(0)).toBe(1); // the plate alone
  });

  it('exports a still code to SVG and Lottie', () => {
    const p = { text: 'tramme', level: 'L', style: 'square', size: 210, quiet: 4, picture: null, progress: 1, reveal: 'scan', ink: '#111111', plate: '#ffffff' };
    const svg = qr.nodes[0].export!.svg!(p as never);
    expect(svg).toMatch(/^<rect/);
    expect(svg).toMatch(/<path d="M/);
    const lottie = qr.nodes[0].export!.lottie!(p as never) as { ty: string; it: { ty: string }[] }[];
    expect(lottie.map((g) => g.ty)).toEqual(['gr', 'gr']);
    expect(lottie[0].it.filter((i) => i.ty === 'rc').length).toBeGreaterThan(20);
  });

  it('the check flags small modules, a thin quiet zone, an inverted or faint code, and a short stay', () => {
    const placed = (props: Record<string, unknown>, layer: Record<string, unknown> = {}) => ({ id: 'q', layer: { name: 'Code', type: 'qr.code', in: 0, out: 6, ...layer }, node: { type: 'qr.code' }, props: { text: 'https://example.com', level: 'M', style: 'square', size: 520, quiet: 4, picture: null, progress: 1, reveal: 'scan', ink: '#111111', plate: '#ffffff', ...props }, opacity: 1, box: null });
    const run = (pl: ReturnType<typeof placed>) => (qr.checks[0].run({ doc: {}, compId: 'main', comp: { width: 1080, height: 1920, fps: 30, duration: 10 }, samples: [{ t: 1, layers: [pl] }], data: () => null } as never) as { message: string }[]).map((i) => i.message);
    expect(run(placed({}))).toEqual([]);
    expect(run(placed({ size: 90 })).join()).toMatch(/under 5/);
    expect(run(placed({ quiet: 1 })).join()).toMatch(/quiet zone/);
    expect(run(placed({ ink: '#ffffff', plate: '#111111' })).join()).toMatch(/light modules on a dark plate/);
    expect(run(placed({ ink: '#9a9a9a' })).join()).toMatch(/under 4:1/);
    expect(run(placed({}, { out: 2 })).join()).toMatch(/3 s/);
  });
});

describe('extrude', () => {
  const sq = (x: number, y: number, w: number) => [[x, y], [x + w, y], [x + w, y + w], [x, y + w]] as [number, number][];
  const triArea = (pts: number[][], t: number[]) => {
    let s = 0;
    for (let k = 0; k < t.length; k += 3) { const [a, b, c] = [pts[t[k]], pts[t[k + 1]], pts[t[k + 2]]]; s += ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2; }
    return s;
  };

  it('triangulates a shape with holes: every triangle facing up, the holes left empty', () => {
    const shapes = extrude.shapesOf([sq(0, 0, 10), sq(2, 2, 2), sq(6, 6, 2)]);
    expect(shapes).toHaveLength(1);
    expect(shapes[0].holes).toHaveLength(2);
    const { points, triangles } = extrude.triangulate(shapes[0].outer, shapes[0].holes);
    // n + 2h - 2 triangles, their areas summing to the outline less its holes
    expect(triangles.length / 3).toBe(12 + 2 * 2 - 2);
    expect(triArea(points, triangles)).toBeCloseTo(100 - 4 - 4, 6);
    for (let k = 0; k < triangles.length; k += 3) expect(triArea(points, triangles.slice(k, k + 3))).toBeGreaterThan(0);
  });

  it('triangulates a concave outline, and an island inside a hole stays solid', () => {
    const L = [[0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6]] as [number, number][];
    const { points, triangles } = extrude.triangulate(L);
    expect(triArea(points, triangles)).toBeCloseTo(6 * 2 + 2 * 4, 6);
    // a target: a disc, its hole, a dot inside the hole
    const shapes = extrude.shapesOf([sq(0, 0, 12), sq(3, 3, 6), sq(5, 5, 2)]);
    expect(shapes).toHaveLength(2);
    expect(shapes.map((x: { holes: unknown[] }) => x.holes.length).sort()).toEqual([0, 1]);
  });

  it('writes a .glb the 3D model node reads back, a primitive per colour', () => {
    const shape = extrude.shapesOf([sq(-1, -1, 2), sq(-0.4, -0.4, 0.8)])[0];
    const mesh = extrude.extrudeShape(shape, 0.5, 0.05);
    const glb = extrude.writeGlb([{ ...mesh, color: [1, 0, 0, 1] }, { ...extrude.extrudeShape(extrude.shapesOf([sq(2, 2, 1)])[0], 0.5, 0), color: [0, 0, 1, 1] }]);
    const model = parseGltf(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength));
    expect(model.roots[0].prims).toHaveLength(2);
    expect(model.roots[0].prims[0].color).toEqual([1, 0, 0, 1]);
    expect(model.roots[0].prims[0].positions.length).toBe(mesh.positions.length);
    expect(Array.from(model.roots[0].prims[0].indices)).toEqual(mesh.indices);
    // the solid is closed: as deep as asked, front and back faces facing out
    const zs = mesh.positions.filter((_: number, i: number) => i % 3 === 2);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(0.5, 6);
    expect(model.radius).toBeGreaterThan(1);
  });

  it('the tool extrudes a group of paths into a turning model, the flat logo hidden', async () => {
    const { doc } = newProject({ name: 'T', width: 1920, height: 1080, fps: 30, duration: 6 });
    const pv = (pts: [number, number][]) => ({ v: pts, closed: true });
    doc.compositions.main.layers.outer = { type: 'shape.path', props: { path: pv(sq(0, 0, 200)), fill: '@accent' } } as never;
    doc.compositions.main.layers.hole = { type: 'shape.path', props: { path: pv(sq(60, 60, 80)), fill: '@accent' } } as never;
    doc.compositions.main.layers.logo = { type: 'group', name: 'Logo', transform: { anchor: [100, 100], position: [960, 540], scale: [2, 2] }, children: ['outer', 'hole'] } as never;
    doc.compositions.main.order = ['logo'];
    const written: Record<string, Blob> = {};
    const out = await runTool(extrude.tools[0], doc, { layer: 'logo' }, { extra: { writeFile: async (p: string, d: Blob) => { written[p] = d; return p; } } });
    const next = applyOps(doc, out.ops as never).doc;
    const model = Object.values(next.compositions.main.layers).find((l) => l.type === 'model.3d')!;
    expect(model.props).toMatchObject({ spin: 30, light: 'studio' });
    expect(model.transform!.position).toEqual([960, 540]);
    expect(next.compositions.main.layers.logo.visible).toBe(false);
    const file = Object.values(written)[0];
    const glb = parseGltf(await file.arrayBuffer());
    expect(glb.roots[0].prims).toHaveLength(1);
    // the accent, as a linear colour
    expect(glb.roots[0].prims[0].color[1]).toBeGreaterThan(glb.roots[0].prims[0].color[0]);
    await expect(runTool(extrude.tools[0], doc, { layer: 'hole', bevel: 0 })).resolves.toBeTruthy();
  });
});

describe('the device frame around built layers', () => {
  const device = walkthrough.nodes[0];
  const props = (extra: Record<string, unknown> = {}) => ({ screen: null, device: 'phone', scroll: 0, url: '', bezel: '#12171D', shadow: true, size: [560, 1120], font: null, fill: '#FFFFFF', part: 'whole', ...extra });
  const host = { asset: () => { throw new Error('no asset'); } } as never;

  it('gives the screen\'s rectangle of the frame, the numbers the drawing uses', () => {
    expect(walkthrough.screenOf({ size: [560, 1120], device: 'phone' })).toMatchObject({ x: -260.4, y: -540.4, w: 520.8, h: 1080.8 });
    expect(walkthrough.screenOf({ size: [560, 1120], device: 'phone' }).radius).toBeCloseTo(560 * 0.09 * 0.72, 6);
    // a browser keeps room for its bar under the top edge
    expect(walkthrough.screenOf({ size: [1100, 720], device: 'browser' })).toMatchObject({ x: -550, y: -360 + 720 * 0.075, w: 1100, h: 720 - 720 * 0.075 });
  });

  it('draws the frame without a screenshot, and each part apart', () => {
    const draw = (extra: Record<string, unknown>) => { const ctx = recorder(); device.render.canvas2d!(ctx, props(extra) as never, host); return ctx.calls; };
    expect(draw({}).filter((c) => c.startsWith('fill(')).length).toBeGreaterThan(1);
    const under = draw({ part: 'under' }), over = draw({ part: 'over' }), whole = draw({});
    // the notch (a rounded rect after the screen) belongs to the over part only
    expect(under.filter((c) => c.startsWith('roundRect(')).length).toBeLessThan(whole.filter((c) => c.startsWith('roundRect(')).length);
    expect(over.filter((c) => c.startsWith('roundRect(')).length).toBe(1);
    expect(over.some((c) => c.startsWith('clip('))).toBe(false);
  });

  it('device-screen lays the frame around a content group the screen clips', async () => {
    const { doc } = newProject({ name: 'T', width: 1920, height: 1080, fps: 30, duration: 6 });
    const out = await runTool(walkthrough.tools[1], doc, { device: 'phone', name: 'Phone' });
    const comp = applyOps(doc, out.ops as never).doc.compositions[doc.root];
    const group = Object.values(comp.layers).find((l) => l.name === 'Phone')!;
    expect(group.type).toBe('group');
    const kids = (group.children ?? []).map((id) => ({ id, ...comp.layers[id] }));
    expect(kids.map((k) => k.type)).toEqual(['ui.device', 'shape.rect', 'group', 'ui.device']);
    expect(kids[1].name).toBe('Phone · screen');
    expect(kids[2].name).toBe('Phone · content');
    expect(kids[0].props).toMatchObject({ part: 'under' });
    expect(kids[3].props).toMatchObject({ part: 'over' });
    expect(kids[1].visible).toBe(false);
    expect(kids[2].clip).toBe(kids[1].id);
    // 86 % of the composition's height by default
    expect((kids[0].props!.size as number[])[1]).toBe(Math.round(1080 * 0.86));
    const s = walkthrough.screenOf({ size: kids[0].props!.size as [number, number], device: 'phone' });
    expect(kids[1].props).toMatchObject({ size: [s.w, s.h], radius: s.radius });
    expect(out.text).toContain(`${Math.round(s.w)} x ${Math.round(s.h)} px`);
    expect(out.text).toContain('Phone · content');
    expect(out.text).toMatch(/centre/);
    expect(comp.order).toContain(Object.entries(comp.layers).find(([, l]) => l === group)![0]);
  });
});

describe('the packs\' entries by need', () => {
  it('reads a line from the notes: the first sentence, one line, at most 110 characters', () => {
    expect(needLine({ ai: { when: 'a phone or browser frame for an interface. Then more detail' } })).toBe('a phone or browser frame for an interface');
    const long = needLine({ ai: { when: `${'word '.repeat(40)}end` } });
    expect(long.length).toBeLessThanOrEqual(110);
    expect(long.endsWith('…')).toBe(true);
    expect(needLine({ ai: { when: 'a "quoted"\n  thing; and more' } })).toBe('a "quoted" thing');
    expect(needLine({ description: 'what it does', title: 'Title' })).toBe('what it does');
    expect(needLine({ title: 'Only a title' })).toBe('Only a title');
  });

  const index = INDEX as unknown as { file: string; entries?: { name: string; kind: string; line: string }[] }[];
  it('the shipped index carries a short line for each node, tool and effect of every pack', () => {
    const modules = (import.meta as ImportMeta & { glob: (p: string, o: { eager: true }) => Record<string, unknown> }).glob('../../../plugins/*.js', { eager: true }) as Record<string, import('@tramme/core').PluginModule>;
    let total = 0;
    for (const { file, entries = [] } of index) {
      const mod = modules[`../../../plugins/${file}`];
      const made = [...(mod.nodes ?? []), ...(mod.effects ?? []), ...(mod.tools ?? [])];
      expect(entries.length, file).toBe(made.length);
      for (const e of entries) {
        expect(e.line.length, `${file} ${e.name}`).toBeGreaterThan(0);
        expect(e.line.length, `${file} ${e.name}`).toBeLessThanOrEqual(110);
        total += e.line.length;
      }
    }
    expect(total).toBeLessThanOrEqual(6000);
    const walk = index.find((e) => e.file === 'walkthrough.js')!.entries!;
    expect(walk.find((e) => e.name === 'ui.device')?.kind).toBe('node');
    expect(walk.find((e) => e.name === 'device-screen')?.kind).toBe('tool');
  });
  it('lists the entries as prompt lines: the name, its pack, what it is for', async () => {
    const { packLines } = await import('../src/packs.ts');
    const lines = packLines(INDEX as never);
    expect(lines.length).toBe(index.reduce((n, e) => n + (e.entries?.length ?? 0), 0));
    expect(lines.some((l) => l.startsWith('ui.device (UI walkthrough): '))).toBe(true);
    expect(lines.every((l) => !l.includes(String.fromCharCode(10)))).toBe(true);
  });
});
