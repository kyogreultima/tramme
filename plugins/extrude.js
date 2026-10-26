// Logos in 3D: the path layers of a logo or an icon (an SVG through the
// svg-paths tool) extruded with a bevel, their faces triangulated by ear
// clipping (holes bridged in), written as a .glb asset that the built-in
// model.3d node draws with its lights, turntable and explode keys — no second
// 3D renderer. Authoring time only: the tool computes the mesh once.

// ── the outlines ─────────────────────────────────────────────
/** a PathValue as a polyline: its Béziers (in and out tangents, relative) cut in `steps` runs, closed without repeating its first point */
export function outline(path, steps = 12) {
  const v = Array.isArray(path?.v) ? path.v.map((p) => [Number(p[0]) || 0, Number(p[1]) || 0]) : [];
  const n = v.length;
  if (n < 2) return v;
  const zero = [0, 0], pts = [v[0]];
  const seg = (a, b) => {
    const o = path.o?.[a] ?? zero, i = path.i?.[b] ?? zero;
    if (!o[0] && !o[1] && !i[0] && !i[1]) { pts.push(v[b]); return; }
    const P1 = [v[a][0] + o[0], v[a][1] + o[1]], P2 = [v[b][0] + i[0], v[b][1] + i[1]];
    for (let k = 1; k <= steps; k++) {
      const u = k / steps, w = 1 - u;
      pts.push([w * w * w * v[a][0] + 3 * w * w * u * P1[0] + 3 * w * u * u * P2[0] + u * u * u * v[b][0], w * w * w * v[a][1] + 3 * w * w * u * P1[1] + 3 * w * u * u * P2[1] + u * u * u * v[b][1]]);
    }
  };
  for (let k = 0; k < n - 1; k++) seg(k, k + 1);
  seg(n - 1, 0);
  pts.pop(); // the closing point is the first one
  // points closer than a hundredth of a pixel are one
  return pts.filter((p, k) => { const q = pts[(k + pts.length - 1) % pts.length]; return k === 0 || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.01; });
}

/** the signed area of a closed polyline: positive counter-clockwise (y up) */
export function area(pts) {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]);
  return s / 2;
}

/** a point inside a closed polyline (even-odd) */
function inside(pt, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/**
 * Contours into shapes: each outline inside an odd number of others is a
 * hole of the smallest outline around it (the even-odd reading of a logo,
 * an O's counter included). Outlines turn counter-clockwise, holes clockwise.
 */
export function shapesOf(contours) {
  const list = contours.filter((c) => c.length >= 3 && Math.abs(area(c)) > 1e-6).map((pts) => ({ pts, a: Math.abs(area(pts)) }));
  const depth = list.map((c, i) => list.filter((o, j) => j !== i && o.a > c.a && inside(c.pts[0], o.pts)).length);
  const shapes = [];
  list.forEach((c, i) => { if (depth[i] % 2 === 0) shapes.push({ outer: area(c.pts) > 0 ? c.pts : [...c.pts].reverse(), holes: [], a: c.a }); });
  list.forEach((c, i) => {
    if (depth[i] % 2 === 0) return;
    const host = shapes.filter((s) => s.a > c.a && inside(c.pts[0], s.outer)).sort((x, y) => x.a - y.a)[0];
    if (host) host.holes.push(area(c.pts) < 0 ? c.pts : [...c.pts].reverse());
  });
  return shapes.map(({ outer, holes }) => ({ outer, holes }));
}

// ── ear clipping, holes bridged in ───────────────────────────
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const same = (a, b) => a[0] === b[0] && a[1] === b[1];
function inTriangle(a, b, c, p) {
  return cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
}

/**
 * A shape (a counter-clockwise outline and its clockwise holes) as
 * triangles: the holes bridged into the outline from their rightmost point
 * to a vertex it sees, then ears clipped. Returns the points (outline then
 * holes, in order) and the triangles as index triples into them.
 */
export function triangulate(outer, holes = []) {
  const points = [...outer, ...holes.flat()];
  // the ring: indices into points, the holes joined by bridges (their two ends repeated)
  let ring = outer.map((_, i) => i);
  const starts = [];
  let at = outer.length;
  for (const h of holes) { starts.push(at); at += h.length; }
  const order = holes.map((h, k) => ({ h, start: starts[k], maxX: Math.max(...h.map((p) => p[0])) })).sort((a, b) => b.maxX - a.maxX);
  for (const { h, start } of order) {
    // the hole's rightmost point, and the ring's nearest edge to its right
    let m = 0;
    h.forEach((p, k) => { if (p[0] > h[m][0]) m = k; });
    const M = h[m];
    let best = Infinity, bridge = -1;
    for (let k = 0; k < ring.length; k++) {
      const a = points[ring[k]], b = points[ring[(k + 1) % ring.length]];
      if ((a[1] > M[1]) === (b[1] > M[1]) && !(a[1] === M[1] && b[1] === M[1])) continue;
      if (a[1] === b[1]) continue;
      const x = a[0] + ((M[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
      if (x < M[0] - 1e-9 || x >= best) continue;
      best = x;
      bridge = a[0] > b[0] ? k : (k + 1) % ring.length;
    }
    if (bridge < 0) continue;
    // a ring vertex inside the triangle (M, the hit, the bridge's end) would block it: the one nearest the ray is taken instead
    const I = [best, M[1]], P = points[ring[bridge]];
    let chosen = bridge, bestAngle = Infinity;
    for (let k = 0; k < ring.length; k++) {
      const q = points[ring[k]];
      if (k === bridge || same(q, P)) continue;
      const tri = cross(M, I, P) >= 0 ? [M, I, P] : [M, P, I];
      if (q[0] >= M[0] && inTriangle(tri[0], tri[1], tri[2], q)) {
        const angle = Math.abs(Math.atan2(q[1] - M[1], q[0] - M[0]));
        if (angle < bestAngle) { bestAngle = angle; chosen = k; }
      }
    }
    const holeRing = h.map((_, k) => start + ((m + k) % h.length));
    ring = [...ring.slice(0, chosen + 1), ...holeRing, start + m, ring[chosen], ...ring.slice(chosen + 1)];
  }
  // the ears
  const tris = [];
  const left = [...ring];
  let guard = left.length * left.length + 10;
  let i = 0;
  while (left.length > 3 && guard-- > 0) {
    const n = left.length;
    const ia = left[(i + n - 1) % n], ib = left[i % n], ic = left[(i + 1) % n];
    const a = points[ia], b = points[ib], c = points[ic];
    let ear = cross(a, b, c) > 1e-12;
    if (ear) {
      for (const j of left) {
        if (j === ia || j === ib || j === ic) continue;
        const q = points[j];
        if (same(q, a) || same(q, b) || same(q, c)) continue;
        if (inTriangle(a, b, c, q)) { ear = false; break; }
      }
    }
    if (ear) { tris.push(ia, ib, ic); left.splice(i % n, 1); i = Math.max(0, (i % n) - 1); guard = left.length * left.length + 10; }
    else i = (i + 1) % n;
    // no ear left in a whole turn (a degenerate outline): the flattest corner is cut so the loop ends
    if (guard === 0 && left.length > 3) { tris.push(left[0], left[1], left[2]); left.splice(1, 1); guard = left.length * left.length + 10; }
  }
  if (left.length === 3 && cross(points[left[0]], points[left[1]], points[left[2]]) > 1e-12) tris.push(left[0], left[1], left[2]);
  return { points, triangles: tris };
}

// ── the solid ────────────────────────────────────────────────
/** an outline's vertices moved `d` into the solid, along their corner's bisector (mitred, capped at twice d) */
function inset(pts, d) {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
    const e1 = [p[0] - a[0], p[1] - a[1]], e2 = [b[0] - p[0], b[1] - p[1]];
    const l1 = Math.hypot(...e1) || 1, l2 = Math.hypot(...e2) || 1;
    // the left normals: into the solid for a counter-clockwise outline and a clockwise hole alike
    const n1 = [-e1[1] / l1, e1[0] / l1], n2 = [-e2[1] / l2, e2[0] / l2];
    let m = [n1[0] + n2[0], n1[1] + n2[1]];
    const ml = Math.hypot(...m);
    if (ml < 1e-9) m = n1; else m = [m[0] / ml, m[1] / ml];
    const cos = Math.max(0.5, m[0] * n1[0] + m[1] * n1[1]);
    return [p[0] + (m[0] * d) / cos, p[1] + (m[1] * d) / cos];
  });
}

/**
 * A shape extruded: its front and back faces (inset by the bevel), the
 * bevels and the walls between them, flat normals. `depth` and `bevel` in
 * the outline's units; y is taken as already pointing up. Returns flat
 * arrays of positions, normals and triangle indices.
 */
export function extrudeShape(shape, depth, bevel) {
  const pos = [], nor = [], idx = [];
  const b = Math.max(0, Math.min(bevel, depth / 2 - 1e-6));
  const contours = [shape.outer, ...shape.holes];
  const insets = contours.map((c) => (b > 0 ? inset(c, b) : c));
  const { triangles } = triangulate(shape.outer, shape.holes);
  const flat = insets.flat();
  const face = (z, nz) => {
    const base = pos.length / 3;
    for (const p of flat) { pos.push(p[0], p[1], z); nor.push(0, 0, nz); }
    for (let k = 0; k < triangles.length; k += 3) {
      if (nz > 0) idx.push(base + triangles[k], base + triangles[k + 1], base + triangles[k + 2]);
      else idx.push(base + triangles[k], base + triangles[k + 2], base + triangles[k + 1]);
    }
  };
  face(depth / 2, 1);
  face(-depth / 2, -1);
  // a quad of four corners facing `normal`, wound to face it
  const quad = (q, normal) => {
    const base = pos.length / 3;
    for (const p of q) { pos.push(...p); nor.push(...normal); }
    const u = [q[1][0] - q[0][0], q[1][1] - q[0][1], q[1][2] - q[0][2]], v = [q[2][0] - q[0][0], q[2][1] - q[0][1], q[2][2] - q[0][2]];
    const c = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (c[0] * normal[0] + c[1] * normal[1] + c[2] * normal[2] >= 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  const zf = depth / 2, zb = -depth / 2;
  contours.forEach((c, ci) => {
    const ins = insets[ci], n = c.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const e = [c[j][0] - c[i][0], c[j][1] - c[i][1]], l = Math.hypot(...e) || 1;
      // the outward normal of the edge: the right side, out of the solid
      const out = [e[1] / l, -e[0] / l];
      if (b > 0) {
        const s = Math.SQRT1_2;
        quad([[ins[i][0], ins[i][1], zf], [ins[j][0], ins[j][1], zf], [c[j][0], c[j][1], zf - b], [c[i][0], c[i][1], zf - b]], [out[0] * s, out[1] * s, s]);
        quad([[c[i][0], c[i][1], zb + b], [c[j][0], c[j][1], zb + b], [ins[j][0], ins[j][1], zb], [ins[i][0], ins[i][1], zb]], [out[0] * s, out[1] * s, -s]);
      }
      quad([[c[i][0], c[i][1], zf - b], [c[j][0], c[j][1], zf - b], [c[j][0], c[j][1], zb + b], [c[i][0], c[i][1], zb + b]], [out[0], out[1], 0]);
    }
  });
  return { positions: pos, normals: nor, indices: idx };
}

// ── the .glb ─────────────────────────────────────────────────
/**
 * Meshes as a binary glTF 2.0 file: one node, one mesh, a primitive per
 * colour with its own material (base colour, a little rough), positions with
 * their bounds as the format asks.
 */
export function writeGlb(parts, name = 'extrude') {
  const chunks = [], views = [], accessors = [], materials = [], primitives = [];
  let offset = 0;
  const push = (typed, target) => {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = (4 - (offset % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); offset += pad; }
    chunks.push(bytes);
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, target });
    offset += bytes.byteLength;
    return views.length - 1;
  };
  parts.forEach((part, k) => {
    const p = Float32Array.from(part.positions), n = Float32Array.from(part.normals), ix = Uint32Array.from(part.indices);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) for (let d = 0; d < 3; d++) { min[d] = Math.min(min[d], p[i + d]); max[d] = Math.max(max[d], p[i + d]); }
    accessors.push({ bufferView: push(p, 34962), componentType: 5126, count: p.length / 3, type: 'VEC3', min, max });
    accessors.push({ bufferView: push(n, 34962), componentType: 5126, count: n.length / 3, type: 'VEC3' });
    accessors.push({ bufferView: push(ix, 34963), componentType: 5125, count: ix.length, type: 'SCALAR' });
    materials.push({ name: `${name} ${k + 1}`, pbrMetallicRoughness: { baseColorFactor: part.color, metallicFactor: 0.1, roughnessFactor: 0.55 } });
    primitives.push({ attributes: { POSITION: k * 3, NORMAL: k * 3 + 1 }, indices: k * 3 + 2, material: k, mode: 4 });
  });
  const bin = new Uint8Array(offset + ((4 - (offset % 4)) % 4));
  let at = 0;
  for (const c of chunks) { bin.set(c, at); at += c.byteLength; }
  const json = { asset: { version: '2.0', generator: 'tramme extrude' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name, mesh: 0 }], meshes: [{ name, primitives }], materials, accessors, bufferViews: views, buffers: [{ byteLength: bin.byteLength }] };
  let text = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (text.byteLength % 4)) % 4;
  if (jsonPad) { const t = new Uint8Array(text.byteLength + jsonPad).fill(0x20); t.set(text); text = t; }
  const out = new Uint8Array(12 + 8 + text.byteLength + 8 + bin.byteLength);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.byteLength, true);
  dv.setUint32(12, text.byteLength, true); dv.setUint32(16, 0x4e4f534a, true); out.set(text, 20);
  const b0 = 20 + text.byteLength;
  dv.setUint32(b0, bin.byteLength, true); dv.setUint32(b0 + 4, 0x004e4942, true); out.set(bin, b0 + 8);
  return out;
}

// ── the tool ─────────────────────────────────────────────────
/** a colour of the document (a hex, or a token naming one) as linear RGBA, for the glTF material */
function colourOf(c, tokens, fallback) {
  let v = typeof c === 'string' ? c : null;
  for (let k = 0; v && v.startsWith('@') && k < 4; k++) v = tokens?.[v.slice(1)]?.type === 'color' ? String(tokens[v.slice(1)].value) : null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(v ?? '').trim());
  if (!m) return fallback;
  const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
  // glTF base colours are linear
  return [0, 2, 4].map((i) => ((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))(parseInt(h.slice(i, i + 2), 16) / 255)).concat(1);
}

/** a layer's static transform as a function of a point (position, anchor, scale and rotation; a keyed value read at its first key) */
function placeOf(layer) {
  const val = (p, d) => { const k = p?.$k; return Array.isArray(k) && k.length ? k[0].v : p ?? d; };
  const tr = layer.transform ?? {};
  const [px, py] = val(tr.position, [0, 0]), [ax, ay] = val(tr.anchor, [0, 0]), [sx, sy] = val(tr.scale, [1, 1]);
  const r = ((Number(val(tr.rotation, 0)) || 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return ([x, y]) => { const u = (x - ax) * sx, v = (y - ay) * sy; return [px + u * c - v * s, py + u * s + v * c]; };
}

const extrude = {
  name: 'extrude', title: 'Extrude a logo in 3D',
  description: 'the path layers of a logo or an icon (a group from the svg-paths tool, or one path) extruded with a bevel into a .glb model, drawn by the built-in 3D model layer turning on its turntable',
  input: {
    type: 'object',
    properties: {
      layer: { type: 'string', format: 'layer', layerType: ['group', 'shape.path'], title: 'Logo', description: 'a group of path layers (svg-paths makes one from an SVG) or a single path; the selected one, or the only one' },
      depth: { type: 'number', title: 'Depth', description: 'the thickness, as a share of the logo\'s width (0.18 by default)' },
      bevel: { type: 'number', title: 'Bevel', description: 'the rounded-off edge, as a share of the logo\'s width (0.025 by default; 0 for a sharp edge)' },
      spin: { type: 'number', title: 'Spin', description: 'the turntable, in degrees a second (30 by default; 0 to keep it still)' },
    },
  },
  ai: { when: 'a logo or an icon that turns in 3D for an opening or an end card: run svg-paths on its SVG first, then extrude the group; the model keeps the paths\' colours and the studio light', avoid: 'extruding text written as type (only paths: outline the text in the SVG first), a deep extrusion on a thin line icon (it reads as a fence), several turning logos at once, a spin faster than 60° a second' },
  async run(a, ctx) {
    const comp = ctx.doc.compositions[ctx.compId];
    const kinds = new Set(['group', 'shape.path']);
    const id = a.layer && comp.layers[a.layer] ? a.layer : ctx.selection.find((s) => kinds.has(comp.layers[s]?.type)) ?? Object.keys(comp.layers).find((k) => comp.layers[k].type === 'group') ?? null;
    if (!id) throw new Error('say which logo to extrude: a group of path layers (svg-paths makes one from an SVG) or a path');
    const top = comp.layers[id];
    // the paths, in the logo's own space (each child's transform applied), grouped by colour
    const paths = top.type === 'shape.path' ? [[id, top]] : (top.children ?? []).map((c) => [c, comp.layers[c]]).filter(([, l]) => l?.type === 'shape.path');
    const byColour = new Map();
    for (const [, l] of paths) {
      const fill = l.props?.fill;
      if (fill === null || (fill !== undefined && typeof fill !== 'string')) continue; // a stroke alone or a gradient has no face to extrude
      const colour = colourOf(fill ?? '#FFFFFF', ctx.doc.tokens, [0.8, 0.8, 0.8, 1]);
      const key = colour.join(',');
      if (!byColour.has(key)) byColour.set(key, { colour, contours: [] });
      const place = top.type === 'shape.path' ? (p) => p : placeOf(l);
      const pv = l.props?.path?.$k ? l.props.path.$k[0].v : l.props?.path;
      byColour.get(key).contours.push(outline(pv).map(place));
    }
    if (!byColour.size) throw new Error(`"${top.name ?? id}" has no filled path to extrude (a stroke alone has no face)`);
    // the logo's box, to size the depth and the bevel and to centre the model
    const all = [...byColour.values()].flatMap((g) => g.contours.flat());
    const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const width = Math.max(1, x1 - x0, y1 - y0), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const depth = Math.max(0.01, a.depth ?? 0.18) * width, bevel = Math.max(0, a.bevel ?? 0.025) * width;
    // y down in the composition, up in glTF; units of a hundred pixels
    const parts = [];
    let faces = 0;
    for (const { colour, contours } of byColour.values()) {
      const shapes = shapesOf(contours.map((c) => c.map(([x, y]) => [(x - cx) / 100, -(y - cy) / 100])));
      let mesh = { positions: [], normals: [], indices: [], color: colour };
      for (const s of shapes) {
        const m = extrudeShape(s, depth / 100, bevel / 100);
        const base = mesh.positions.length / 3;
        // concatenated, not spread: a detailed logo holds more numbers than a call takes arguments
        mesh = { ...mesh, positions: mesh.positions.concat(m.positions), normals: mesh.normals.concat(m.normals), indices: mesh.indices.concat(m.indices.map((i) => i + base)) };
        faces += m.indices.length / 3;
      }
      if (mesh.indices.length) parts.push(mesh);
    }
    const name = String(top.name ?? id).replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'logo';
    const path = await ctx.writeFile(`assets/models/${name}-3d.glb`, new Blob([writeGlb(parts, name)], { type: 'model/gltf-binary' }));
    const ops = [];
    let aid = Object.entries(ctx.doc.assets).find(([, x]) => x.src === path)?.[0];
    if (!aid) {
      aid = `${name}-3d`;
      for (let n = 2; ctx.doc.assets[aid]; n++) aid = `${name}-3d-${n}`;
      ops.push({ op: 'add', path: `/assets/${aid}`, value: { type: 'model', src: path, name: `${top.name ?? id} in 3D` } });
    }
    // the model where the logo stood, as tall as the frame lets it turn, the flat logo hidden (kept for editing)
    const place = placeOf(top), at = place([cx, cy]);
    const scale = Array.isArray(top.transform?.scale) ? Math.abs(top.transform.scale[0]) : 1;
    const height = Math.round(Math.min(Math.min(comp.width, comp.height) * 0.8, Math.max(160, width * scale * 1.3)));
    let lid = `${name}-3d`;
    for (let n = 2; comp.layers[lid]; n++) lid = `${name}-3d-${n}`;
    ops.push({ op: 'add', path: `/compositions/${ctx.compId}/layers/${lid}`, value: {
      type: 'model.3d', name: `${top.name ?? id} in 3D`, in: top.in ?? 0, ...(top.out !== undefined ? { out: top.out } : {}),
      transform: { position: [Math.round(at[0]), Math.round(at[1])] },
      props: { source: aid, height, spin: a.spin ?? 30, light: 'studio' },
    } });
    ops.push({ op: 'add', path: `/compositions/${ctx.compId}/order/-`, value: lid });
    ops.push({ op: top.visible === undefined ? 'add' : 'replace', path: `/compositions/${ctx.compId}/layers/${id}/visible`, value: false });
    return {
      ops, label: `${top.name ?? id} in 3D`,
      text: `"${top.name ?? id}" extruded: ${parts.length} colour(s), ${faces} triangles, ${Math.round(depth)} px deep with a ${Math.round(bevel)} px bevel, written to ${path}. The 3D model layer "${lid}" turns at ${a.spin ?? 30}° a second under the studio light (key its yaw, pitch or explode); the flat logo is hidden, kept to edit and extrude again.`,
    };
  },
};

export const meta = { id: 'tramme/extrude', name: 'extrude', version: '1.0.0', description: 'Logos in 3D: path layers extruded with a bevel into a .glb, drawn by the built-in 3D model layer on its turntable', api: 1 };
export const tools = [extrude];
export const messages = {
  fr: {
    'Extrude a logo in 3D': 'Extruder un logo en 3D',
    'Logo': 'Logo', 'Depth': 'Profondeur', 'Bevel': 'Biseau', 'Spin': 'Rotation',
    'the path layers of a logo or an icon (a group from the svg-paths tool, or one path) extruded with a bevel into a .glb model, drawn by the built-in 3D model layer turning on its turntable': 'les couches de tracé d’un logo ou d’une icône (un groupe de l’outil svg-paths, ou un seul tracé) extrudées avec un biseau en un modèle .glb, dessiné par la couche de modèle 3D intégrée qui tourne sur son plateau',
    'a group of path layers (svg-paths makes one from an SVG) or a single path; the selected one, or the only one': 'un groupe de couches de tracé (svg-paths en fait un depuis un SVG) ou un seul tracé ; la sélection, ou le seul',
    'the thickness, as a share of the logo\'s width (0.18 by default)': 'l’épaisseur, en part de la largeur du logo (0,18 par défaut)',
    'the rounded-off edge, as a share of the logo\'s width (0.025 by default; 0 for a sharp edge)': 'l’arête abattue, en part de la largeur du logo (0,025 par défaut ; 0 pour une arête vive)',
    'the turntable, in degrees a second (30 by default; 0 to keep it still)': 'le plateau tournant, en degrés par seconde (30 par défaut ; 0 pour le garder immobile)',
  },
};
