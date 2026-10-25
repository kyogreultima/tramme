// Diagrams: flows, architectures, cycles and trees, written as text and laid
// out by this pack. The text is a flowchart subset of Mermaid's syntax (or
// the same as JSON): the parser reads it, a layout — layered, ring or hub,
// pure and deterministic — places the boxes, and the diagram tool expands the
// whole into ordinary layers: boxes, labels, edges with their arrowheads that
// draw themselves with the trim, revealed in reading order. The
// diagram-legibility check says when a label does not fit, when an edge
// crosses a label, and when a diagram holds more boxes than the format can
// read at once.

// ── the text parser ──────────────────────────────────────────

const ARROW = /-{3,}>?|-\.+->|={2,}>|-->/;

/**
 * The diagram text: `flowchart`, or `flowchart LR` / `TB` / `RL` / `BT` to
 * fix the direction (left out, the format chooses it), node defs with their
 * labels (`A[label]`, `B(round)`), edges `A --> B`, `A --- B`, `A -.-> B`,
 * `A -->|label| B`, chains `A --> B --> C`, and subgraphs. Or the same as
 * JSON ({ direction?, nodes, edges, groups }). Errors name their line.
 *
 * @returns {{ direction: string | null, nodes: { id: string, label: string, shape: string }[], edges: { from: string, to: string, kind: string, label: string | null, line: number }[], groups: { id: string, title: string, nodeIds: string[] }[] }}
 */
export function parseDiagram(text) {
  if (typeof text === 'object' && text !== null) return parseJson(text);
  const out = { direction: null, nodes: [], edges: [], groups: [] };
  const ids = new Set();
  const node = (id, rest, line) => {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`line ${line}: "${id}" is not an id (letters, digits, _, -)`);
    const found = out.nodes.find((n) => n.id === id);
    const m = rest?.match(/^\[\s*([\s\S]*?)\s*\]$/);
    const r = rest?.match(/^[({]\s*([\s\S]*?)\s*[)}]$/);
    const label = (m || r) ? (m || r)[1].replace(/^"([\s\S]*)"$/, '$1') : null;
    const shape = r ? 'round' : 'rect';
    if (found) { if (label !== null) { found.label = label; found.shape = shape; } }
    else { ids.add(id); out.nodes.push({ id, label: label ?? id, shape }); }
    return id;
  };
  let group = null;
  String(text ?? '').split('\n').forEach((rawLine, k) => {
    const line = k + 1;
    let s = rawLine.trim();
    if (!s || s.startsWith('%%')) return;
    if (k === 0 && /^(flowchart|graph)\b/i.test(s)) {
      const m = s.match(/^(?:flowchart|graph)\s+(LR|RL|TB|BT)\s*$/i);
      if (m) out.direction = m[1].toUpperCase();
      else if (!/^(?:flowchart|graph)\s*$/i.test(s)) throw new Error(`line 1: the direction is LR, RL, TB or BT (got "${s}")`);
      return;
    }
    if (/^subgraph\b/i.test(s)) {
      const m = s.match(/^subgraph\s+([\w-]+)\s*(?:\[\s*([\s\S]*?)\s*\]|\(\s*([\s\S]*?)\s*\))?$/i);
      if (!m) throw new Error(`line ${line}: subgraph <id> [title]`);
      group = { id: m[1], title: m[2] ?? m[3] ?? m[1], nodeIds: [] };
      out.groups.push(group);
      return;
    }
    if (/^end$/i.test(s)) { group = null; return; }
    // walk the line: a node, then (arrow, node) pairs
    // an id takes hyphens only between word characters, so A-->B reads as A, -->, B
    const token = /(\w+(?:-\w+)*(?:\[[^\]]*\]|\([^)]*\)|\{[^}]*\})?)/g;
    const at = (re, from) => { re.lastIndex = from; return re.exec(s); };
    let first = at(token, 0);
    if (!first) throw new Error(`line ${line}: a node (A[label]), an edge (A --> B), subgraph or end`);
    let from = node(...splitNode(first[1]), line);
    if (group) group.nodeIds.push(from);
    let cursor = first.index + first[0].length;
    for (;;) {
      const gap = s.slice(cursor);
      const gm = gap.match(/^\s*(-{3,}>?|-\.+->|={2,}>|-->)(?:\|([^|]*)\|)?\s*/);
      if (!gm) break;
      const kind = gm[1].includes('.') ? 'dashed' : gm[1].endsWith('>') ? 'arrow' : 'line';
      const next = at(token, cursor + gm[0].length);
      if (!next) throw new Error(`line ${line}: the edge needs a node after "${gm[1].trim()}"`);
      const to = node(...splitNode(next[1]), line);
      if (group) group.nodeIds.push(to);
      out.edges.push({ from, to, kind, label: gm[2]?.trim() || null, line });
      from = to;
      cursor = next.index + next[0].length;
    }
    const rest = s.slice(cursor).trim();
    if (rest) throw new Error(`line ${line}: "${rest}" is not part of a node or an edge`);
  });
  for (const e of out.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) throw new Error(`line ${e.line}: "${!ids.has(e.from) ? e.from : e.to}" is not a node`);
  }
  if (!out.nodes.length) throw new Error('the diagram has no nodes');
  return out;
}

function parseJson(j) {
  const dir = j.direction == null || j.direction === '' ? null : String(j.direction).toUpperCase();
  if (dir !== null && !['LR', 'RL', 'TB', 'BT'].includes(dir)) throw new Error(`json: the direction is LR, RL, TB or BT (got "${j.direction}")`);
  const out = { direction: dir, nodes: [], edges: [], groups: [] };
  const ids = new Set();
  for (const n of j.nodes ?? []) {
    if (!n?.id) throw new Error('json: every node needs an id');
    if (ids.has(n.id)) throw new Error(`json: two nodes are named "${n.id}"`);
    ids.add(n.id);
    out.nodes.push({ id: String(n.id), label: String(n.label ?? n.id), shape: n.shape === 'round' ? 'round' : 'rect' });
  }
  for (const e of j.edges ?? []) {
    if (!ids.has(e.from) || !ids.has(e.to)) throw new Error(`json: the edge ${JSON.stringify(e)} names a node that does not exist`);
    out.edges.push({ from: String(e.from), to: String(e.to), kind: e.kind === 'dashed' ? 'dashed' : e.kind === 'line' ? 'line' : 'arrow', label: e.label ? String(e.label) : null, line: 0 });
  }
  for (const g of j.groups ?? []) out.groups.push({ id: String(g.id), title: String(g.title ?? g.id), nodeIds: (g.nodes ?? []).map(String) });
  if (!out.nodes.length) throw new Error('the diagram has no nodes');
  return out;
}

const splitNode = (a) => {
  const m = String(a).match(/^(\w+(?:-\w+)*)([\[{\(][\s\S]*[\]}\)])?$/);
  return m ? [m[1], m[2]] : [a, null];
};

// ── the layouts ──────────────────────────────────────────────

/** a label wraps to three lines at most; longer is the check's business */
export function wrapLabel(label, maxChars) {
  const words = String(label ?? '').split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length > maxChars && line) { lines.push(line); line = w; } else line = next;
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

/**
 * The diagram placed: every node's box (its label wrapped), every edge's
 * route, the groups' bounds — in a space from (0, 0) to (w, h). Pure and
 * deterministic. `wide` says the format: 16:9 lays left to right, 9:16 top
 * to bottom, unless the text's direction says otherwise.
 *
 * @returns {{ placed: Record<string, { id: string, label: string, shape: string, lines: string[], x: number, y: number, w: number, h: number, cx: number, cy: number }>, routes: { from: string, to: string, kind: string, pts: { x: number, y: number }[], mid: { x: number, y: number } }[], groups: { id: string, title: string, nodeIds: string[], x: number, y: number, w: number, h: number }[], order: string[], w: number, h: number, direction: string, kind: string }}
 */
export function layoutDiagram(dia, { wide = true, typeSize = 22 } = {}) {
  const dirs = { LR: 'h', RL: 'h', TB: 'v', BT: 'v' };
  // the text's direction when it says one; otherwise the format's
  const dirKey = dirs[dia.direction] ? dia.direction : wide ? 'LR' : 'TB';
  const horizontal = (dirs[dirKey] ?? 'h') === 'h';
  const forward = dirKey === 'LR' || dirKey === 'TB';
  const charW = typeSize * 0.6, lineH = typeSize * 1.25;
  const of = Object.fromEntries(dia.nodes.map((n) => {
    const lines = wrapLabel(n.label, 24);
    const longest = Math.max(...lines.map((l) => l.length), 4);
    const w = Math.round(longest * charW + typeSize * 1.8);
    const h = Math.round(lines.length * lineH + typeSize * 0.9);
    return [n.id, { ...n, lines, w, h }];
  }));
  const outs = {}, ins = {};
  for (const n of dia.nodes) { outs[n.id] = []; ins[n.id] = []; }
  const seen = new Set();
  for (const e of dia.edges) {
    if (seen.has(`${e.from}>${e.to}`)) continue;
    seen.add(`${e.from}>${e.to}`);
    outs[e.from]?.push(e.to);
    ins[e.to]?.push(e.from);
  }
  const ids = dia.nodes.map((n) => n.id);
  const kind = layoutKind(ids, outs, ins, dia.edges.length);
  const order = topoOrder(ids, outs);
  const placed = {};
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const put = (id, x, y) => {
    const n = of[id];
    placed[id] = { ...n, x: Math.round(x - n.w / 2), y: Math.round(y - n.h / 2), cx: Math.round(x), cy: Math.round(y) };
    x0 = Math.min(x0, placed[id].x); y0 = Math.min(y0, placed[id].y);
    x1 = Math.max(x1, placed[id].x + n.w); y1 = Math.max(y1, placed[id].y + n.h);
  };

  if (kind === 'ring' || kind === 'hub') {
    const centreId = kind === 'hub' ? ids.find((id) => outs[id].length + ins[id].length === dia.edges.length) : null;
    const ring = ids.filter((id) => id !== centreId);
    const maxW = Math.max(...ring.concat(centreId ? [centreId] : []).map((id) => of[id].w));
    const radius = Math.max(140, (maxW * ring.length) / (2 * Math.PI) + maxW * 0.7);
    if (centreId) put(centreId, 0, 0);
    ring.forEach((id, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / ring.length;
      put(id, Math.cos(a) * radius, Math.sin(a) * radius);
    });
  } else {
    // layered: ranks by the longest path, the order in a rank by the barycentre
    // of its neighbours (two sweeps), the columns along the direction
    const rank = {};
    const rankOf = (id, path) => {
      if (rank[id] !== undefined) return rank[id];
      if (path.has(id)) return 0;
      path.add(id);
      const parents = ins[id];
      rank[id] = parents.length ? Math.max(...parents.map((p) => rankOf(p, path) + 1)) : 0;
      path.delete(id);
      return rank[id];
    };
    for (const id of ids) rankOf(id, new Set());
    const ranks = [];
    for (const id of ids) (ranks[rank[id]] ??= []).push(id);
    for (let sweep = 0; sweep < 2; sweep++) {
      for (const list of ranks) {
        if (!list?.length) continue;
        const at = (id) => {
          const ns = sweep === 0 ? ins[id] : outs[id];
          const known = ns.filter((x) => list.includes(x));
          return known.length ? known.reduce((acc, x) => acc + list.indexOf(x), 0) / known.length : list.indexOf(id);
        };
        list.sort((a, b) => at(a) - at(b));
      }
    }
    const colGap = Math.max(...ids.map((id) => of[id].w)) * 0.7 + typeSize * 3;
    const rowGap = Math.max(...ids.map((id) => of[id].h)) * 0.45 + typeSize * 1.6;
    ranks.forEach((list, r) => {
      if (!list?.length) return;
      list.forEach((id, i) => {
        // RL and BT run the ranks the other way, so the edges leave by the side they face
        const along = (forward ? r : -r) * colGap, across = (i - (list.length - 1) / 2) * rowGap;
        put(id, horizontal ? along : across, horizontal ? across : along);
      });
    });
  }
  // normalise from (0, 0)
  for (const p of Object.values(placed)) {
    p.x -= x0; p.y -= y0; p.cx -= x0; p.cy -= y0;
  }
  const w = Math.max(1, Math.round(x1 - x0)), h = Math.max(1, Math.round(y1 - y0));
  // a ring or a hub has no reading direction: each edge leaves by the side facing its target
  const routes = dia.edges.map((e) => routeEdge(placed[e.from], placed[e.to], kind === 'ring' || kind === 'hub' ? 'free' : dirKey, e.kind));
  const groups = (dia.groups ?? []).map((g) => {
    const members = (g.nodeIds ?? []).filter((id) => placed[id]);
    if (!members.length) return null;
    const bx0 = Math.min(...members.map((id) => placed[id].x)), bx1 = Math.max(...members.map((id) => placed[id].x + placed[id].w));
    const by0 = Math.min(...members.map((id) => placed[id].y)), by1 = Math.max(...members.map((id) => placed[id].y + placed[id].h));
    const pad = typeSize * 0.8, head = g.title ? typeSize * 1.6 : 0;
    return { id: g.id, title: g.title, nodeIds: members, x: Math.round(bx0 - pad), y: Math.round(by0 - pad - head), w: Math.round(bx1 - bx0 + pad * 2), h: Math.round(by1 - by0 + pad * 2 + head) };
  }).filter(Boolean);
  return { placed, routes, groups, order, w, h, direction: dirKey, kind };
}

/** the shape a graph asks for: a cycle is a ring, a star is a hub, the rest is layered */
export function layoutKind(ids, outs, ins, edgeCount) {
  if (ids.length >= 3 && ids.every((id) => outs[id].length === 1 && ins[id].length >= 1)) {
    let at = ids[0];
    for (let k = 0; k < ids.length; k++) { at = outs[at]?.[0]; if (!at) return 'layered'; }
    if (at === ids[0]) return 'ring';
  }
  const centre = ids.find((id) => outs[id].length + ins[id].length === edgeCount && edgeCount >= 3 && ins[id].length === 0);
  return centre ? 'hub' : 'layered';
}

/** the topological order (a cycle follows the text's order): the reading order of the reveal */
export function topoOrder(ids, outs) {
  const out = [], state = new Map();
  const visit = (id) => {
    const st = state.get(id);
    if (st) return;
    state.set(id, 1);
    for (const to of outs[id] ?? []) visit(to);
    state.set(id, 2);
    out.push(id);
  };
  for (const id of ids) visit(id);
  out.reverse(); // the post-order lists the ends first: the sources lead the reading
  return out;
}

/**
 * An edge's path between two boxes, out of one side and into the other, with
 * its arrowhead. 'free' (rings and hubs) picks the sides facing each other
 * from where the boxes sit, and goes straight.
 */
export function routeEdge(a, b, dirKey, kind) {
  const free = dirKey === 'free';
  const dx = (b.x + b.w / 2) - (a.x + a.w / 2), dy = (b.y + b.h / 2) - (a.y + a.h / 2);
  // free: across the wider gap, measured against the boxes' sizes
  const horizontal = free ? Math.abs(dx) / Math.max(1, a.w + b.w) >= Math.abs(dy) / Math.max(1, a.h + b.h) : dirKey === 'LR' || dirKey === 'RL';
  const forward = free ? (horizontal ? dx >= 0 : dy >= 0) : dirKey === 'LR' || dirKey === 'TB';
  const sideA = horizontal ? (forward ? 'r' : 'l') : forward ? 'b' : 't';
  const sideB = horizontal ? (forward ? 'l' : 'r') : forward ? 't' : 'b';
  const at = (n, side) => ({ x: n.x + (side === 'l' ? 0 : side === 'r' ? n.w : n.w / 2), y: n.y + (side === 't' ? 0 : side === 'b' ? n.h : n.h / 2) });
  const p0 = at(a, sideA), p3 = at(b, sideB);
  const pts = [p0];
  if (free) {
    // straight from side to side
  } else if (horizontal) {
    if (Math.abs(p0.y - p3.y) > 2) { const midx = (p0.x + p3.x) / 2; pts.push({ x: midx, y: p0.y }, { x: midx, y: p3.y }); }
  } else {
    if (Math.abs(p0.x - p3.x) > 2) { const midy = (p0.y + p3.y) / 2; pts.push({ x: p0.x, y: midy }, { x: p3.x, y: midy }); }
  }
  pts.push(p3);
  if (kind === 'arrow' || kind === 'dashed') {
    const last = pts[pts.length - 1], prev = pts[pts.length - 2];
    const ang = Math.atan2(last.y - prev.y, last.x - prev.x);
    const head = 10, spread = 0.5;
    pts.push({ x: last.x - head * Math.cos(ang - spread), y: last.y - head * Math.sin(ang - spread) });
    pts.push({ x: last.x, y: last.y });
    pts.push({ x: last.x - head * Math.cos(ang + spread), y: last.y - head * Math.sin(ang + spread) });
  }
  return { from: a.id, to: b.id, kind, pts, mid: pts[Math.max(0, Math.floor((pts.length - 1) / 2))] };
}

// ── the tool ─────────────────────────────────────────────────
const r2 = (x) => Math.round(x * 100) / 100;
const low = (s) => String(s ?? '').trim().toLowerCase();
const JITTER = [1, 1.3, 0.85, 1.15, 0.9];
const easeOf = (tokens) => (tokens?.enter?.type === 'ease' ? '@enter' : [0.16, 1, 0.3, 1]);

const diagramTool = {
  name: 'diagram', title: 'Diagram',
  description: 'a flow, architecture, cycle or tree written as flowchart text (a Mermaid subset) or JSON, laid out layered, ring or hub, and built as editable boxes, labels and edges that draw themselves in reading order; one route can be highlighted',
  input: {
    type: 'object',
    properties: {
      text: { type: 'string', title: 'Text', description: '"flowchart\\nA[Build] --> B(Test)\\nB -->|ok| C[Ship]", or the same as JSON { nodes, edges, groups }; leave the direction out and the format picks it (left to right in 16:9, top to bottom in 9:16), write LR, TB, RL or BT only to force one' },
      highlight: { type: 'string', title: 'Highlight', description: 'a node id: the rest dims and one route through the graph lifts in the accent' },
      at: { type: 'number', minimum: 0, title: 'Start (s)' },
      fit: { type: 'number', minimum: 0.1, maximum: 1, title: 'Fit', description: 'the fraction of the frame the diagram spans (0.8 by default)' },
      typeSize: { type: 'number', minimum: 10, title: 'Type size (px)' },
    },
    required: ['text'],
  },
  ai: {
    when: 'a pipeline, an architecture, a lifecycle, a decision flow: the text is quick to write, the layout and the drawing are the tool\'s; six to twelve boxes stay readable',
    avoid: 'more than about 12 boxes in 16:9 or 8 in 9:16 (the check says so); labels longer than a line or two; crossing flows that a highlight could untangle',
    example: { text: 'flowchart\nA[Pull] --> B[Build] --> C{Tests}\nC -->|ok| D[Ship]\nC -->|fail| B', highlight: 'D' },
  },
  run(a, ctx) {
    const doc = ctx.doc, c = doc.compositions?.[ctx.compId] ?? { width: 1920, height: 1080 };
    const wide = c.width >= c.height;
    const dia = parseDiagram(a.text);
    const typeSize = a.typeSize > 0 ? a.typeSize : Math.round(Math.min(c.width, c.height) * 0.026);
    const layout = layoutDiagram(dia, { wide, typeSize });
    const at = a.at ?? ctx.time ?? 0;
    const fit = a.fit > 0 && a.fit <= 1 ? a.fit : 0.8;
    const k = Math.min((c.width * fit) / Math.max(1, layout.w), (c.height * fit) / Math.max(1, layout.h));
    // the type on screen: the layout was measured at typeSize, then scaled by k with the boxes
    const ts = typeSize * k;
    const tokens = doc.tokens ?? {};
    const colorOf = (name, fallback) => (tokens[name]?.type === 'color' ? `@${name}` : fallback);
    const ink = colorOf('ink', '#1c1917');
    const plate = colorOf('plate', '#f4f1ea');
    const accent = colorOf('accent', '#2EC4B6');
    const enter = easeOf(tokens);
    // the route the highlight lifts: the chain of edges from a source into the node
    let lift = new Set();
    if (a.highlight) {
      // the highlighted node: by id or by its label
      const want = low(a.highlight);
      const hit = dia.nodes.find((n) => n.id === a.highlight) ?? dia.nodes.find((n) => low(n.label) === want);
      if (!hit) throw new Error(`highlight: "${a.highlight}" names no node (${dia.nodes.map((n) => n.id).join(', ')})`);
      a = { ...a, highlight: hit.id };
      const into = new Map(); // node → the edge that reaches it on the way to the highlight
      const seen = new Set([a.highlight]);
      const queue = [a.highlight];
      while (queue.length) {
        const y = queue.shift();
        for (const e of dia.edges) {
          if (e.to !== y) continue;
          if (!into.has(y)) into.set(y, e);
          if (!seen.has(e.from)) { seen.add(e.from); queue.push(e.from); }
        }
      }
      const isSource = (id) => !dia.edges.some((e) => e.to === id);
      const chain = [];
      const walk = (id) => {
        const e = into.get(id);
        if (!e || chain.includes(e)) return;
        chain.push(e);
        if (!isSource(e.from)) walk(e.from);
      };
      walk(a.highlight);
      lift = new Set(chain.map((e) => `${e.from}>${e.to}`));
    }
    const dim = a.highlight && lift.size ? 0.35 : 1;
    const taken = new Set(Object.keys(doc.compositions?.[ctx.compId]?.layers ?? {}));
    const take = (base) => { let id = base, n = 1; while (taken.has(id)) { n++; id = `${base}-${n}`; } taken.add(id); return id; };
    const ox = (c.width - layout.w * k) / 2, oy = (c.height - layout.h * k) / 2;
    const world = (x, y) => [r2(ox + x * k), r2(oy + y * k)];
    const ops = [];
    const children = [];
    const layer = (id, value) => { ops.push({ op: 'add', path: `/compositions/${ctx.compId}/layers/${id}`, value }); children.push(id); return id; };
    // the groups behind, drawn on first
    for (const g of layout.groups) {
      layer(take(`dg-${g.id}`), {
        type: 'shape.rect', name: `group ${g.title}`, in: at,
        transform: { position: world(g.x + g.w / 2, g.y + g.h / 2), opacity: dim },
        props: { size: [r2(g.w * k), r2(g.h * k)], radius: Math.round(ts * 0.8), fill: plate, stroke: ink, strokeWidth: 1.5 },
      });
      if (g.title) layer(take(`dg-${g.id}-t`), {
        type: 'text', name: `group ${g.id} title`, in: at,
        transform: { position: world(g.x + typeSize * 0.8, g.y + typeSize * 0.5), opacity: dim },
        props: { text: g.title, size: Math.round(ts * 0.85), weight: 700, color: ink, baseline: 'top' },
      });
    }
    // the edges under the boxes, drawn on between their ends' arrivals
    const rankOf = Object.fromEntries(layout.order.map((id, i) => [id, i]));
    const nodeAt = (id) => 0.35 + (rankOf[id] ?? 0) * 0.3;
    dia.edges.forEach((e, i) => {
      const route = layout.routes[i];
      const lifted = lift.has(`${e.from}>${e.to}`);
      const v = route.pts.map((p) => world(p.x, p.y));
      const t0 = at + nodeAt(e.from) + 0.12, t1 = Math.max(t0 + 0.25, at + nodeAt(e.to));
      layer(take(`de-${i}`), {
        type: 'shape.path', name: `edge ${e.from} to ${e.to}${e.label ? ` (${e.label})` : ''}`, in: at,
        transform: { position: [0, 0], opacity: lifted || !lift.size ? 1 : dim },
        props: {
          path: { v, closed: false }, fill: null, stroke: lifted ? accent : ink,
          strokeWidth: r2(lifted ? Math.max(3, ts * 0.14) : e.kind === 'dashed' ? Math.max(1.5, ts * 0.06) : Math.max(2, ts * 0.09)),
          lineCap: 'round', lineJoin: 'round',
          trimStart: 0, trimEnd: { $k: [{ t: r2(t0), v: 0, ease: enter }, { t: r2(t1), v: 1 }] },
        },
      });
      if (e.label) layer(take(`dl-${i}`), {
        type: 'text', name: `edge ${e.from} to ${e.to} label`, in: at,
        transform: { position: world(route.mid.x, route.mid.y - typeSize * 0.75), opacity: lifted || !lift.size ? 1 : dim },
        props: { text: e.label, size: Math.round(ts * 0.8), align: 'center', color: ink },
      });
    });
    // the boxes and their labels, in reading order with an uneven stagger
    layout.order.forEach((id, i) => {
      const n = layout.placed[id];
      const t = at + 0.15 + JITTER[i % JITTER.length] * 0.09 * i;
      const onRoute = !lift.size || [...lift].some((key) => key.split('>')[0] === id || key.split('>')[1] === id);
      layer(take(`dn-${id}`), {
        type: 'shape.rect', name: `box ${n.label}`, in: at,
        transform: { position: world(n.cx, n.cy), scale: { $k: [{ t: r2(t), v: [0.85, 0.85], ease: enter }, { t: r2(t + 0.3), v: [1, 1] }] }, opacity: onRoute ? 1 : dim },
        props: {
          size: [r2(n.w * k), r2(n.h * k)], radius: n.shape === 'round' ? r2(Math.min(n.w, n.h) * k / 2) : Math.round(ts * 0.5),
          fill: plate, stroke: ink, strokeWidth: 2,
        },
      });
      layer(take(`dt-${id}`), {
        type: 'text', name: `label ${n.label}`, in: at,
        transform: { position: world(n.cx, n.cy), opacity: { $k: [{ t: r2(t + 0.05), v: 0 }, { t: r2(t + 0.25), v: onRoute ? 1 : dim }] } },
        props: { text: n.lines.join('\n'), size: Math.round(ts), weight: 600, align: 'center', color: ink },
      });
    });
    const gid = take('diagram');
    ops.push({ op: 'add', path: `/compositions/${ctx.compId}/layers/${gid}`, value: { type: 'group', name: a.highlight ? `diagram (${a.highlight})` : 'diagram', transform: { position: [0, 0] }, children } });
    ops.push({ op: 'add', path: `/compositions/${ctx.compId}/order/-`, value: gid });
    return {
      ops, label: 'Diagram',
      text: `A ${layout.kind} diagram of ${dia.nodes.length} boxes and ${dia.edges.length} edges, laid ${layout.direction} at ${Math.round(k * 100)} %${a.highlight && lift.size ? `, the route into "${a.highlight}" lifted in the accent` : ''}. It reveals in reading order from ${r2(at)} s; every box, label and edge is its own layer of the group "${gid}" — move one, rewrite a label, retime a trim.`,
    };
  },
};

// ── the check ────────────────────────────────────────────────
const diagramCheck = {
  name: 'diagram-legibility', title: 'Diagram legibility',
  description: 'a label overflowing its box or under its type size, an edge crossing a label, and more boxes than the format holds at once are a diagram nobody reads',
  texts: ['{name}: {n} boxes is a lot for this format'],
  run(ctx) {
    const out = [];
    const seen = new Set();
    const crosses = (pts, rect) => {
      for (let k = 1; k < pts.length; k++) {
        const [x0, y0] = pts[k - 1], [x1, y1] = pts[k];
        for (let s = 0; s <= 8; s++) {
          const x = x0 + ((x1 - x0) * s) / 8, y = y0 + ((y1 - y0) * s) / 8;
          if (x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1) return true;
        }
      }
      return false;
    };
    for (const sample of ctx.samples) {
      const byId = new Map(sample.layers.map((l) => [l.id, l]));
      for (const dia of sample.layers) {
        if (dia.node.type !== 'group' || !dia.layer.name?.startsWith('diagram') || seen.has(dia.id)) continue;
        seen.add(dia.id);
        const children = (dia.layer.children ?? []).map((id) => byId.get(id)).filter(Boolean);
        const boxes = children.filter((l) => l.node.type === 'shape.rect' && l.layer.name?.startsWith('box '));
        const texts = children.filter((l) => l.node.type === 'text' && l.layer.name?.startsWith('label '));
        const edges = children.filter((l) => l.node.type === 'shape.path' && l.layer.name?.startsWith('edge '));
        const cap = ctx.comp.width >= ctx.comp.height ? 12 : 8;
        if (boxes.length > cap) out.push({ check: 'diagram-legibility', severity: 'warning', message: `${dia.layer.name}: ${boxes.length} boxes is a lot for this format — split the diagram or highlight one route at a time`, layers: [dia.id] });
        const minType = ctx.comp.height * 0.02;
        for (const t of texts) {
          const size = t.props.size ?? 0;
          if (size > 0 && size < minType) out.push({ check: 'diagram-legibility', severity: 'warning', message: `${dia.layer.name}: "${String(t.props.text).slice(0, 24)}" is set at ${Math.round(size)} px — under ${Math.round(minType)} px nobody reads it on a phone`, layers: [t.id] });
          // the label against its own box, found by its centre
          const box = boxes.find((b) => Math.hypot((b.transform?.position?.[0] ?? 0) - (t.transform?.position?.[0] ?? 0), (b.transform?.position?.[1] ?? 0) - (t.transform?.position?.[1] ?? 0)) < 2);
          if (box) {
            const text = String(t.props.text ?? '');
            const w = Math.max(...text.split('\n').map((l) => l.length), 4) * size * 0.62;
            if (w > box.props.size[0] * 1.02) out.push({ check: 'diagram-legibility', severity: 'warning', message: `${dia.layer.name}: the label "${text.slice(0, 24)}" overflows its box — shorten it or widen the box`, layers: [t.id] });
          }
        }
        for (const e of edges) {
          if ((e.transform?.opacity ?? 1) < 0.5) continue;
          const pts = (e.props.path?.v ?? []).map((q) => q);
          for (const t of texts) {
            const size = t.props.size ?? 22, text = String(t.props.text ?? '');
            const w = Math.max(...text.split('\n').map((l) => l.length), 4) * size * 0.62;
            const lines = text.split('\n').length;
            const rect = { x0: t.transform.position[0] - w / 2, x1: t.transform.position[0] + w / 2, y0: t.transform.position[1] - (lines * size * 1.25) / 2, y1: t.transform.position[1] + (lines * size * 1.25) / 2 };
            if (crosses(pts, rect)) { out.push({ check: 'diagram-legibility', severity: 'info', message: `${dia.layer.name}: an edge crosses the label "${text.slice(0, 24)}" — route it off the boxes or move the label`, layers: [e.id, t.id] }); break; }
          }
        }
      }
    }
    return out;
  },
};

export const meta = { id: 'tramme/diagram', name: 'diagram', version: '1.0.0', description: 'Flows, architectures, cycles and trees from flowchart text, laid out layered, ring or hub, drawn as editable boxes and self-drawing edges', api: 1 };
export const tools = [diagramTool];
export const checks = [diagramCheck];
export const messages = {
  fr: {
    'Diagram': 'Diagramme',
    'a flow, architecture, cycle or tree written as flowchart text (a Mermaid subset) or JSON, laid out layered, ring or hub, and built as editable boxes, labels and edges that draw themselves in reading order; one route can be highlighted': 'un flux, une architecture, un cycle ou un arbre écrit en texte flowchart (un sous-ensemble de Mermaid) ou JSON, disposé en couches, anneau ou étoile, et construit en boîtes, libellés et arêtes éditables qui se tracent dans l\'ordre de lecture ; une route peut être mise en avant',
    'Diagram legibility': 'Lisibilité d\'un diagramme',
    'a label overflowing its box or under its type size, an edge crossing a label, and more boxes than the format holds at once are a diagram nobody reads': 'un libellé qui déborde de sa boîte ou trop petit, une arête qui coupe un libellé, et plus de boîtes que le format n\'en tient font un diagramme que personne ne lit',
  },
};
