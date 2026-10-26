// Maps, offline: Natural Earth (public domain) shipped beside the pack, a
// projection written here, places found by name (accents folded, aliases
// known, an ambiguous name asked back), great circles for the routes and van
// Wijk and Nuij's smooth zoom for the flights between them. The tool writes
// into the project only the shapes the map shows; everything drawn comes
// from the tokens. A still map exports as SVG.

// ── projections ──────────────────────────────────────────────
const D = Math.PI / 180;

/**
 * A longitude-latitude pair to the unit square: x and y in [-0.5, 0.5], the
 * whole world at zoom 1. `null` when the projection has no answer (the far
 * side of an orthographic globe). `center` turns the globe and shifts the
 * others.
 */
export function project(kind, lonlat, opts = {}) {
  const [lon0, lat0] = opts.center ?? [0, 0];
  const dl = lonlat[0] - lon0;
  if (kind === 'equirect') return [dl / 360 || 0, -lonlat[1] / 360 || 0];
  if (kind === 'mercator') {
    const lat = Math.max(-85, Math.min(85, lonlat[1]));
    return [dl / 360 || 0, -(Math.log(Math.tan(Math.PI / 4 + (lat * D) / 2)) / (2 * Math.PI)) || 0];
  }
  if (kind === 'naturalEarth') {
    // Natural Earth I: the polynomial is in the latitude (d3-geo's coefficients)
    const phi = lonlat[1] * D, lam = dl * D;
    const p2 = phi * phi, p4 = p2 * p2;
    const x = lam * (0.8707 - 0.131979 * p2 + p4 * (p4 * (0.003971 * p2 - 0.001529 * p4) - 0.013791));
    const y = phi * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4)));
    return [x / 5.471, -y / 5.471];
  }
  if (kind === 'ortho') {
    const phi = lonlat[1] * D, lam = dl * D, phi0 = lat0 * D;
    const cosc = Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(lam);
    if (cosc < 0) return null;
    return [Math.cos(phi) * Math.sin(lam) / 2 || 0, -(Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(lam)) / 2 || 0];
  }
  return null;
}

// ── finding places ───────────────────────────────────────────
/** accents and case folded, so "sao paulo" finds São Paulo */
export const fold = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const ALIASES = { nyc: 'new york', bombay: 'mumbai', pekin: 'beijing', peking: 'beijing', saigon: 'ho chi minh city', kolkata: 'calcutta', calcutta: 'kolkata' };

/** a country's centre, from the middle of its biggest ring's box */
function centroidOf(rings) {
  let best = null, bestArea = 0;
  for (const r of rings ?? []) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [x, y] of r.pts ?? r) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const area = (x1 - x0) * (y1 - y0);
    if (area > bestArea) { bestArea = area; best = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }; }
  }
  return best;
}

/**
 * Places and countries by name: accents and case folded, the aliases known
 * ("NYC", "Bombay"), several answers when the name is not alone in the world
 * ("Paris"), the best first (exact name, then people, then size).
 */
export function findPlace(places, countries, query) {
  const q = ALIASES[fold(query)] ?? fold(query);
  if (!q) return [];
  const out = [];
  for (const p of places ?? []) {
    const names = [p.name, ...(p.alt ?? [])].map(fold);
    if (!names.includes(q)) continue;
    out.push({ name: p.name, country: p.country, lon: p.lon, lat: p.lat, pop: p.pop ?? 0, kind: 'place', exact: fold(p.name) === q });
  }
  for (const c of countries ?? []) {
    if (fold(c.name) !== q) continue;
    const at = centroidOf(c.rings) ?? { x: 0, y: 0 };
    out.push({ name: c.name, country: '', lon: at.x, lat: at.y, pop: 1e12, kind: 'country', exact: true });
  }
  return out.sort((a, b) => (b.exact ? 1 : 0) - (a.exact ? 1 : 0) || b.pop - a.pop);
}

// ── routes and flights ───────────────────────────────────────
/**
 * The great circle from a to b, n points: the shorter way round, unwrapped
 * so the line does not fold back across the antimeridian.
 */
export function greatCircle(a, b, n = 64) {
  const toV = ([lon, lat]) => {
    const phi = lat * D, lam = lon * D;
    return [Math.cos(phi) * Math.cos(lam), Math.cos(phi) * Math.sin(lam), Math.sin(phi)];
  };
  const A = toV(a), B = toV(b);
  const dot = Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2]));
  const omega = Math.acos(dot);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    let p;
    if (omega < 1e-9 || (1 - dot) < 1e-12) p = A;
    else {
      const s0 = Math.sin((1 - u) * omega) / Math.sin(omega), s1 = Math.sin(u * omega) / Math.sin(omega);
      p = [A[0] * s0 + B[0] * s1, A[1] * s0 + B[1] * s1, A[2] * s0 + B[2] * s1];
    }
    const lat = Math.asin(Math.max(-1, Math.min(1, p[2]))) / D;
    let lon = Math.atan2(p[1], p[0]) / D;
    out.push([lon, lat]);
  }
  // unwrapped: each step takes the shorter way (a route never folds back)
  for (let i = 1; i < out.length; i++) {
    while (out[i][0] - out[i - 1][0] > 180) out[i][0] -= 360;
    while (out[i][0] - out[i - 1][0] < -180) out[i][0] += 360;
  }
  return out;
}

/**
 * The camera's flight from one view to another, van Wijk and Nuij's smooth
 * zoom: it zooms out in the middle, travels, and lands exactly on `to`.
 * A view is { center: [lon, lat], zoom } (zoom 1 shows the whole world).
 */
export function zoomPath(from, to) {
  const w0 = 360 / (from.zoom || 1), w1 = 360 / (to.zoom || 1);
  const x0 = from.center[0], y0 = from.center[1], x1 = to.center[0], y1 = to.center[1];
  const dx = x1 - x0, dy = y1 - y0, d2 = dx * dx + dy * dy;
  const rho = Math.SQRT2;
  let fly;
  if (d2 < 1e-12) {
    const p = Math.log(w1 / w0) / rho;
    fly = (t) => [x0, y0, w0 * Math.exp(rho * t * p)];
  } else {
    const d1 = Math.sqrt(d2);
    const b0 = (w1 * w1 - w0 * w0 + 4 * d2) / (2 * w0 * 2 * d1);
    const b1 = (w1 * w1 - w0 * w0 - 4 * d2) / (2 * w1 * 2 * d1);
    const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
    const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
    const S = (r1 - r0) / rho;
    const cosh = (x) => { const e = Math.exp(x); return (e + 1 / e) / 2; };
    const sinh = (x) => { const e = Math.exp(x); return (e - 1 / e) / 2; };
    const tanh = (x) => { const e = Math.exp(2 * x); return (e - 1) / (e + 1); };
    fly = (t) => {
      const coshr0 = cosh(r0);
      const u = (w0 / (2 * d1)) * (coshr0 * tanh(rho * t * S + r0) - sinh(r0));
      return [x0 + u * dx, y0 + u * dy, w0 * coshr0 / cosh(rho * t * S + r0)];
    };
  }
  return (u) => {
    if (u >= 1) return { center: [...to.center], zoom: to.zoom };
    if (u <= 0) return { center: [...from.center], zoom: from.zoom };
    const [x, y, w] = fly(u);
    return { center: [x, y], zoom: 360 / w };
  };
}

// ── the frame ────────────────────────────────────────────────
/**
 * A place in the frame's pixels, around its centre: the projection turned or
 * shifted to the camera's centre (that point lands in the middle of the
 * frame), the whole world `w` pixels wide at zoom 1. null on the far side of
 * a globe.
 */
export function toFrame(kind, lonlat, center, zoom, w) {
  const uv = project(kind, lonlat, { center });
  if (!uv) return null;
  const c = kind === 'ortho' ? [0, 0] : (project(kind, center, { center }) ?? [0, 0]);
  return [(uv[0] - c[0]) * w * zoom, (uv[1] - c[1]) * w * zoom];
}

function ringToFrame(pts, kind, center, zoom, w) {
  const out = [];
  for (const ll of pts) {
    const p = toFrame(kind, ll, center, zoom, w);
    if (!p) return null;
    out.push(p);
  }
  return out;
}

/**
 * The pins' labels kept apart: each tries the right of its pin, then the
 * left, above and below, and takes the first place that meets no label
 * already set and no other pin; a label with no free place is left out.
 * `measure(name)` gives a label's width. Returns { x, y, align } or null per pin.
 */
export function placeLabels(points, measure, size) {
  const boxes = [], out = [];
  const dot = size * 0.5;
  const hit = (b) => boxes.some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y)
    || points.some((q) => q.x > b.x - dot && q.x < b.x + b.w + dot && q.y > b.y - dot && q.y < b.y + b.h + dot && !(q === b.of));
  for (const pt of points) {
    const lw = measure(pt.name), gap = size * 0.6;
    const tries = [
      { x: pt.x + gap, y: pt.y - size / 2, align: 'left' },
      { x: pt.x - gap - lw, y: pt.y - size / 2, align: 'right' },
      { x: pt.x - lw / 2, y: pt.y - gap - size, align: 'center' },
      { x: pt.x - lw / 2, y: pt.y + gap, align: 'center' },
    ];
    const free = tries.map((c) => ({ ...c, w: lw, h: size, of: pt })).find((b) => !hit(b));
    if (free) { boxes.push(free); out.push({ x: free.align === 'left' ? free.x : free.align === 'right' ? free.x + lw : free.x + lw / 2, y: free.y + size / 2, align: free.align }); }
    else out.push(null);
  }
  return out;
}

/** the share of the progress each route draws in: route i from i/n to (i+1)/n */
export const routeShare = (progress, i, n) => Math.max(0, Math.min(1, progress * Math.max(1, n) - i));

/** what a map draws at its props: the countries' rings, the routes so far with their heads, the pins and their labels, in frame pixels */
function sceneOf(p, shapes, w, measure, labelSize) {
  const center = [p.centerX, p.centerY], zoom = p.zoom;
  const countries = (shapes?.countries ?? []).map((c) => ({
    name: c.name,
    hi: (p.highlight ?? []).some((n) => String(n).toLowerCase() === String(c.name).toLowerCase()),
    rings: (c.rings ?? []).map((r) => ringToFrame(r.pts ?? r, p.projection, center, zoom, w)).filter(Boolean),
  }));
  const routes = (Array.isArray(p.routes) ? p.routes : []).map((r, i, all) => {
    const line = greatCircle(r.from, r.to, 64);
    const u = routeShare(p.progress ?? 1, i, all.length);
    if (u <= 0) return null;
    const pts = ringToFrame(line.slice(0, Math.max(2, Math.ceil(line.length * u))), p.projection, center, zoom, w);
    return pts && pts.length > 1 ? pts : null;
  }).filter(Boolean);
  const pins = (Array.isArray(p.pins) ? p.pins : []).map((pin) => {
    const at = toFrame(p.projection, [pin.lon, pin.lat], center, zoom, w);
    return at ? { name: String(pin.name ?? ''), x: at[0], y: at[1] } : null;
  }).filter(Boolean);
  const labels = p.labels ? placeLabels(pins, measure, labelSize) : pins.map(() => null);
  return { countries, routes, pins, labels };
}

// ── the node ─────────────────────────────────────────────────
const mapView = {
  type: 'map.view', title: 'Map', category: 'Maps',
  description: 'a map of the shapes the tool saved: countries filled from the tokens, the chosen ones in the accent, pins with their labels, routes as great circles drawn on',
  ai: { when: 'places in the world: offices on a map, a journey drawn as a great circle, one country highlighted; the tool saves the shapes the map shows, so the project stays small', avoid: 'a map nobody reads at a glance (too many pins), a flight faster than the eye follows (the check says so), labels on every pin' },
  props: {
    shapes: { type: 'asset', assetType: 'json', default: null, nullable: true, label: 'Shapes', animatable: false, description: 'the asset the tool writes: the countries this map shows' },
    projection: { type: 'enum', default: 'naturalEarth', options: ['equirect', 'naturalEarth', 'mercator', 'ortho'], label: 'Projection', animatable: false },
    centerX: { type: 'number', default: 0, min: -180, max: 180, unit: '°', label: 'Centre lon' },
    centerY: { type: 'number', default: 20, min: -90, max: 90, unit: '°', label: 'Centre lat' },
    zoom: { type: 'number', default: 1, min: 0.5, max: 64, step: 0.01, unit: 'x', label: 'Zoom', description: '1: the whole world fits the frame' },
    highlight: { type: 'array', default: [], items: { type: 'string' }, label: 'Highlight', animatable: false, description: 'the countries filled in the accent' },
    pins: { type: 'json', default: [], label: 'Pins', animatable: false, description: '[{ name, lon, lat }]' },
    routes: { type: 'json', default: [], label: 'Routes', animatable: false, description: '[{ from: [lon, lat], to: [lon, lat] }], drawn on with the progress' },
    progress: { type: 'number', default: 1, min: 0, max: 1, step: 0.001, label: 'Progress', description: 'the routes draw themselves on, one after the other' },
    land: { type: 'paint', default: '#2B3440', label: 'Land' },
    plate: { type: 'paint', default: '#0E1420', label: 'Sea' },
    accent: { type: 'paint', default: '@accent', label: 'Accent' },
    ink: { type: 'paint', default: '@text', label: 'Labels' },
    labels: { type: 'bool', default: true, label: 'Pin labels', animatable: false },
    font: { type: 'asset', assetType: 'font', default: null, nullable: true, label: 'Font', animatable: false },
  },
  bounds(p, host) { return { x: -host.width / 2, y: -host.height / 2, w: host.width, h: host.height }; },
  render: {
    canvas2d(ctx, p, host) {
      const w = host.width, h = host.height;
      let shapes = null;
      try { shapes = p.shapes ? host.asset(p.shapes) : null; } catch { shapes = null; }
      const family = p.font ? (() => { try { return `"${host.asset(p.font)}", `; } catch { return ''; } })() : '';
      const labelSize = Math.max(14, Math.min(w, h) * 0.034);
      ctx.font = `600 ${Math.round(labelSize)}px ${family}system-ui, sans-serif`;
      const scene = sceneOf(p, shapes, w, (s) => ctx.measureText(s).width, labelSize);
      const radius = Math.min(24, w * 0.03);
      ctx.fillStyle = p.plate;
      ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, radius); ctx.fill();
      ctx.save();
      ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, radius); ctx.clip();
      // the countries: their rings even-odd, so a hole stays a hole
      for (const c of scene.countries) {
        if (!c.rings.length) continue;
        ctx.beginPath();
        for (const r of c.rings) { r.forEach(([x, y], i) => { if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.closePath(); }
        ctx.fillStyle = c.hi ? p.accent : p.land; ctx.fill('evenodd');
        ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.stroke();
      }
      // the routes: great circles drawn on, a dot at their head
      ctx.strokeStyle = p.accent; ctx.fillStyle = p.accent;
      ctx.lineWidth = Math.max(2, w * 0.004); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const r of scene.routes) {
        ctx.beginPath(); r.forEach(([x, y], k) => { if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.stroke();
        const head = r[r.length - 1];
        ctx.beginPath(); ctx.arc(head[0], head[1], Math.max(3, w * 0.006), 0, Math.PI * 2); ctx.fill();
      }
      // the pins, and their labels where they find room
      for (const pin of scene.pins) {
        if (Math.abs(pin.x) > w * 0.55 || Math.abs(pin.y) > h * 0.55) continue;
        ctx.fillStyle = p.accent;
        ctx.beginPath(); ctx.arc(pin.x, pin.y, Math.max(4, w * 0.007), 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = p.plate; ctx.lineWidth = Math.max(1.5, w * 0.002); ctx.stroke();
      }
      ctx.fillStyle = p.ink; ctx.textBaseline = 'middle';
      scene.pins.forEach((pin, i) => {
        const l = scene.labels[i];
        if (!l) return;
        ctx.textAlign = l.align;
        ctx.fillText(pin.name, l.x, l.y);
      });
      ctx.restore();
    },
  },
  export: {
    svg(p, host) {
      // a still map: the sea, the countries the asset holds, the routes so far, the pins and their labels
      const w = host?.width ?? 1920, h = host?.height ?? 1080;
      const shapes = p.shapes ? host?.json?.(p.shapes) : null;
      const colour = (c, fallback) => (typeof c === 'string' ? c : fallback);
      const r1 = (v) => Math.round(v * 10) / 10;
      const labelSize = Math.max(14, Math.min(w, h) * 0.034);
      const scene = sceneOf(p, shapes, w, (s) => s.length * labelSize * 0.56, labelSize);
      const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const d = (pts, close) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${r1(x)},${r1(y)}`).join('') + (close ? 'Z' : '');
      const parts = [`<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="${r1(Math.min(24, w * 0.03))}" fill="${colour(p.plate, '#0E1420')}"/>`];
      for (const c of scene.countries) if (c.rings.length) parts.push(`<path d="${c.rings.map((r) => d(r, true)).join('')}" fill="${colour(c.hi ? p.accent : p.land, '#2B3440')}" fill-rule="evenodd" stroke="#000" stroke-opacity="0.25" stroke-width="1"/>`);
      for (const r of scene.routes) parts.push(`<path d="${d(r, false)}" fill="none" stroke="${colour(p.accent, '#2EC4B6')}" stroke-width="${r1(Math.max(2, w * 0.004))}" stroke-linecap="round" stroke-linejoin="round"/>`);
      scene.pins.forEach((pin, i) => {
        parts.push(`<circle cx="${r1(pin.x)}" cy="${r1(pin.y)}" r="${r1(Math.max(4, w * 0.007))}" fill="${colour(p.accent, '#2EC4B6')}"/>`);
        const l = scene.labels[i];
        if (l) parts.push(`<text x="${r1(l.x)}" y="${r1(l.y)}" font-family="system-ui, sans-serif" font-weight="600" font-size="${Math.round(labelSize)}" dominant-baseline="middle" text-anchor="${l.align === 'left' ? 'start' : l.align === 'right' ? 'end' : 'middle'}" fill="${colour(p.ink, '#F4F5F7')}">${esc(pin.name)}</text>`);
      });
      return parts.join('');
    },
  },
};

// ── the tool ─────────────────────────────────────────────────
const SHOWN_MAX = 40;

/** the zoom at which points (lon, lat) fill `share` of a w×h frame around their centre, for a projection */
export function fitZoom(kind, points, center, w, h, share = 0.8) {
  const px = points.map((ll) => toFrame(kind, ll, center, 1, w)).filter(Boolean);
  if (!px.length) return 1;
  const xs = px.map((q) => q[0]), ys = px.map((q) => q[1]);
  const spanX = Math.max(1e-6, 2 * Math.max(...xs.map(Math.abs))), spanY = Math.max(1e-6, 2 * Math.max(...ys.map(Math.abs)));
  return Math.min((share * w) / spanX, (share * h) / spanY);
}

/**
 * The camera's flight along a route: on each place in turn (`near` zoom),
 * riding the smooth zoom between them, then out to the whole map. Keys of
 * centre and zoom, the time of each leg long enough that the zoom never
 * changes faster than the check allows (1.5 doublings a second).
 */
export function flightKeys(places, near, overview, start = 0.6) {
  const keys = [];
  let t = start;
  const steps = 8;
  const at = (view) => keys.push({ t: +t.toFixed(3), x: +view.center[0].toFixed(3), y: +view.center[1].toFixed(3), z: +view.zoom.toFixed(3) });
  const views = places.map((p) => ({ center: [p.lon, p.lat], zoom: near }));
  at(views[0]);
  const legs = [];
  const fly = (from, to, hold) => {
    const path = zoomPath(from, to);
    const samples = Array.from({ length: steps + 1 }, (_, k) => path(k / steps));
    let worst = 0;
    for (let k = 1; k < samples.length; k++) worst = Math.max(worst, Math.abs(Math.log2(samples[k].zoom / samples[k - 1].zoom)));
    const dur = Math.max(1.8, (worst * steps) / 1.4);
    const t0 = t;
    for (let k = 1; k <= steps; k++) { t = t0 + (dur * k) / steps; at(samples[k]); }
    legs.push({ from: t0, to: t });
    t += hold;
    at(to);
  };
  for (let i = 1; i < views.length; i++) fly(views[i - 1], views[i], 0.5);
  fly(views[views.length - 1], overview, 0);
  return { keys, legs, end: t };
}

const map = {
  name: 'map', title: 'Draw a map',
  description: 'places named in words found offline among the shipped places and countries, the projection and the framing chosen from what is shown, the project holding only the shapes the map shows',
  input: {
    type: 'object',
    properties: {
      places: { type: 'string', title: 'Places', description: 'the places or countries to show, separated with commas ("Lyon, Montreal, Dakar", "Brazil", "NYC")' },
      route: { type: 'boolean', title: 'Route', description: 'the places joined as great circles, drawn on in order, the camera flying from one to the next' },
      detail: { enum: ['110m', '50m'], title: 'Detail', description: 'the small world at 110m, the cities at 50m; picked from the zoom by default' },
      projection: { enum: ['equirect', 'naturalEarth', 'mercator', 'ortho'], title: 'Projection', description: 'picked from what is shown by default: a globe for the world, Mercator for a city' },
      seconds: { type: 'number', title: 'Seconds', description: 'how long the map holds; a flight takes its time from it' },
    },
    required: ['places'],
  },
  ai: { when: '"our offices in Lyon, Montreal and Dakar": the tool finds the places offline, frames them, and the project carries only those countries; a route joins the places the way a plane flies, the camera travelling with it', avoid: 'more than about eight pins on one map, an ambiguous name answered with a guess (the tool asks back), a world map when three countries tell the story' },
  async run(a, ctx) {
    const comp = ctx.doc.compositions[ctx.compId];
    const asks = String(a.places ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!asks.length) throw new Error('name the places to show');
    const placesData = JSON.parse(await ctx.packFile('places.json'));
    const countries110 = JSON.parse(await ctx.packFile('countries-110m.json'));
    // an ambiguous name is a question, never a guess
    const found = [];
    for (const ask of asks) {
      const hits = findPlace(placesData.places, countries110.countries, ask);
      if (!hits.length) throw new Error(`"${ask}" is in no place or country of the atlas — check the spelling, or say the country after it`);
      if (hits.length > 1 && fold(hits[0].name) === fold(hits[1].name) && hits[0].kind === hits[1].kind) {
        return { ops: [], text: `"${ask}" is ambiguous: ${hits.slice(0, 4).map((x) => `${x.name}${x.country ? ` (${x.country})` : ''}`).join(', ')}. Say which one (a country after the name: "Paris, France").` };
      }
      found.push(hits[0]);
    }
    // the countries the map shows: those the pins stand in, the ones named, the neighbours nothing
    const detail = a.detail ?? (found.some((f) => f.kind === 'country') ? '110m' : '50m');
    const countriesData = detail === '50m' ? JSON.parse(await ctx.packFile('countries-50m.json')) : countries110;
    const keep = new Set();
    for (const f of found) if (f.kind === 'country') keep.add(fold(f.name)); else if (f.country) keep.add(fold(f.country));
    const used = countriesData.countries.filter((c) => keep.has(fold(c.name)));
    // the frame: what is shown (the pins, the whole of a country named), fitted in the projection chosen
    const lons = found.map((f) => f.lon), lats = found.map((f) => f.lat);
    const shown = [...found.map((f) => [f.lon, f.lat]), ...used.filter((c) => found.some((f) => f.kind === 'country' && fold(f.name) === fold(c.name))).flatMap((c) => c.rings.flatMap((r) => r.pts ?? r))];
    const spanLon = Math.max(...shown.map((q) => q[0])) - Math.min(...shown.map((q) => q[0]));
    const projection = a.projection ?? (spanLon > 200 ? (spanLon > 320 ? 'ortho' : 'naturalEarth') : spanLon < 12 ? 'mercator' : 'naturalEarth');
    const r2 = (v) => Math.round(v * 1000) / 1000;
    const center = [r2(lons.reduce((s, x) => s + x, 0) / lons.length), r2(Math.max(-75, Math.min(75, lats.reduce((s, x) => s + x, 0) / lats.length)))];
    const fit = fitZoom(projection, shown.length > 1 ? shown : [...shown, [center[0] + 10, center[1] + 6], [center[0] - 10, center[1] - 6]], center, comp.width, comp.height);
    const camZoom = +Math.min(48, Math.max(0.6, fit)).toFixed(3);
    const pins = found.map((f) => ({ name: f.name, lon: f.lon, lat: f.lat }));
    const routes = a.route && pins.length > 1 ? pins.slice(0, -1).map((p, i) => ({ from: [p.lon, p.lat], to: [pins[i + 1].lon, pins[i + 1].lat] })) : [];
    // the asset holds only the shapes shown
    const data = { source: 'natural-earth', detail, countries: used.slice(0, SHOWN_MAX).map((c) => ({ name: c.name, rings: c.rings })), places: pins };
    const path = await ctx.writeFile(`assets/maps/atlas-${Date.now().toString(36)}.json`, JSON.stringify(data));
    const cid = `map-${Date.now().toString(36)}`;
    const ops = [];
    let sid;
    for (const [id, x] of Object.entries(ctx.doc.assets)) if (x.src === path) { sid = id; break; }
    if (!sid) {
      sid = `atlas-${Date.now().toString(36)}`;
      ops.push({ op: 'add', path: `/assets/${sid}`, value: { type: 'json', src: path, name: `Atlas · ${asks.join(', ')}` } });
    }
    // the flight: the camera on each place in turn, the route drawing as it flies, then the whole map
    let camera = { centerX: center[0], centerY: center[1], zoom: camZoom }, progress = {}, seconds = Math.max(2.5, a.seconds ?? 4);
    if (routes.length) {
      const near = +Math.min(48, Math.max(camZoom * 2.5, 3)).toFixed(3);
      const flight = flightKeys(pins, near, { center, zoom: camZoom });
      camera = {
        centerX: { $k: flight.keys.map((k) => ({ t: k.t, v: k.x })) },
        centerY: { $k: flight.keys.map((k) => ({ t: k.t, v: k.y })) },
        zoom: { $k: flight.keys.map((k) => ({ t: k.t, v: k.z })) },
      };
      // route i draws over leg i of the flight
      progress = { progress: { $k: flight.legs.slice(0, routes.length).flatMap((l, i) => [{ t: +l.from.toFixed(3), v: r2(i / routes.length) }, { t: +l.to.toFixed(3), v: r2((i + 1) / routes.length) }]) } };
      seconds = Math.max(seconds, +(flight.end + 1.2).toFixed(2));
    }
    const layer = {
      type: 'map.view', name: `Map · ${asks.join(', ')}`, in: 0, out: seconds,
      transform: { position: [Math.round(comp.width / 2), Math.round(comp.height / 2)] },
      props: {
        shapes: sid, projection, ...camera,
        highlight: found.filter((f) => f.kind === 'country').map((f) => f.name),
        pins, routes, ...progress,
      },
    };
    ops.push({ op: 'add', path: `/compositions/${cid}`, value: { name: `Map · ${asks.join(', ')}`, width: comp.width, height: comp.height, fps: comp.fps ?? 30, duration: seconds, background: comp.background, layers: { map: layer }, order: ['map'] } });
    return {
      ops, label: `Map · ${asks.join(', ')}`,
      text: `${found.map((f) => f.name).join(', ')} on a ${detail} map, ${projection} at ${camZoom}× centred ${center[0]}°, ${center[1]}°. The atlas asset holds the ${used.length} countr${used.length === 1 ? 'y' : 'ies'} shown — nothing else. ${routes.length ? `The camera flies from one place to the next on a smooth zoom while the route draws itself, then pulls out to the whole map (${seconds} s); retime it on the layer's centre, zoom and progress keys.` : 'Move the framing with the camera (centre and zoom, both animatable); a `route: true` joins the pins the way a plane flies.'}`,
    };
  },
};

// ── the check ────────────────────────────────────────────────
const mapLegibility = {
  name: 'map-legibility', title: 'Map legibility',
  description: 'highlighted countries too small to see at their zoom, labels with no room to stand apart, a flight faster than the eye follows (the camera doubling in under 0.6 s)',
  run(ctx) {
    const out = [];
    const seen = new Set();
    const W = ctx.comp.width, H = ctx.comp.height;
    const labelSize = Math.max(14, Math.min(W, H) * 0.034);
    for (const sample of ctx.samples) {
      for (const placed of sample.layers) {
        if (placed.node.type !== 'map.view' || placed.opacity < 0.5) continue;
        const name = placed.layer.name ?? placed.id;
        const p = placed.props;
        let shapes = null;
        try { shapes = p.shapes ? ctx.data(p.shapes) : null; } catch { shapes = null; }
        const scene = sceneOf({ ...p, labels: true }, shapes, W, (s) => s.length * labelSize * 0.56, labelSize);
        // a highlighted country smaller than a pin at this zoom is not seen
        for (const c of scene.countries) {
          if (!c.hi || !c.rings.length || seen.has(`${placed.id}:small:${c.name}`)) continue;
          const xs = c.rings.flat().map((q) => q[0]), ys = c.rings.flat().map((q) => q[1]);
          if (Math.max(...xs) - Math.min(...xs) < 12 && Math.max(...ys) - Math.min(...ys) < 12) {
            seen.add(`${placed.id}:small:${c.name}`);
            out.push({ check: 'map-legibility', severity: 'warning', t: sample.t, message: `${name}: ${c.name} is a few pixels at this zoom — zoom in on it, or pin it instead` });
          }
        }
        // the labels that found no room
        const lost = scene.pins.filter((_, i) => !scene.labels[i]);
        if (lost.length && !seen.has(`${placed.id}:labels`)) {
          seen.add(`${placed.id}:labels`);
          out.push({ check: 'map-legibility', severity: 'warning', t: sample.t, message: `${name}: the labels of ${lost.map((x) => `"${x.name}"`).join(', ')} have no room beside their pins at this zoom — show fewer, or zoom in` });
        }
        // the flight: the camera doubling faster than the eye follows
        const zoomK = placed.layer.props?.zoom?.$k;
        if (Array.isArray(zoomK) && !seen.has(`${placed.id}:flight`)) {
          seen.add(`${placed.id}:flight`);
          for (let k = 1; k < zoomK.length; k++) {
            const dt = Number(zoomK[k].t) - Number(zoomK[k - 1].t);
            const z0 = Number(zoomK[k - 1].v), z1 = Number(zoomK[k].v);
            if (dt > 0.05 && z0 > 0 && z1 > 0 && Math.abs(Math.log2(z1 / z0)) / dt > 1.7) out.push({ check: 'map-legibility', severity: 'warning', t: Number(zoomK[k].t), message: `${name}: the zoom doubles in ${(dt / Math.abs(Math.log2(z1 / z0))).toFixed(2)} s — faster than the eye follows; give the flight ${Math.ceil(Math.abs(Math.log2(z1 / z0)) / 1.2)} s` });
          }
        }
      }
    }
    return out;
  },
};

export const meta = { id: 'tramme/maps', name: 'maps', version: '1.0.0', description: 'Maps, offline: Natural Earth shipped beside the pack, places found by name, great circles and a smooth zoom for the flights', api: 1 };
export const nodes = [mapView];
export const tools = [map];
export const checks = [mapLegibility];
export const messages = {
  fr: {
    "the routes draw themselves on, one after the other": "les routes se tracent seules, l’une après l’autre",
    "the places joined as great circles, drawn on in order, the camera flying from one to the next": "les lieux joints en arcs de grand cercle, tracés dans l’ordre, la caméra volant de l’un à l’autre",
    "highlighted countries too small to see at their zoom, labels with no room to stand apart, a flight faster than the eye follows (the camera doubling in under 0.6 s)": "des pays à l’accent trop petits à leur zoom, des étiquettes sans place pour se tenir à part, un vol plus vite que l’œil ne suit (le zoom qui double en moins de 0,6 s)",
    'Map': 'Carte', 'Draw a map': 'Dessiner une carte', 'Map legibility': 'Lisibilité d’une carte',
    'Shapes': 'Formes', 'Projection': 'Projection', 'Centre lon': 'Centre lon', 'Centre lat': 'Centre lat', 'Zoom': 'Zoom',
    'Highlight': 'À l’accent', 'Pins': 'Épingles', 'Routes': 'Routes', 'Progress': 'Progression', 'Land': 'Terre', 'Sea': 'Mer',
    'Accent': 'Accent', 'Labels': 'Étiquettes', 'Pin labels': 'Étiquettes des épingles', 'Font': 'Police', 'Places': 'Lieux',
    'Route': 'Route', 'Detail': 'Détail', 'Seconds': 'Secondes',
    'the asset the tool writes: the countries this map shows': 'l’asset que l’outil écrit : les pays que cette carte montre',
    '1: the whole world fits the frame': '1 : le monde entier tient dans le cadre',
    'the countries filled in the accent': 'les pays remplis à l’accent',
    '[{ name, lon, lat }]': '[{ name, lon, lat }]',
    '[{ from: [lon, lat], to: [lon, lat] }], drawn on with the progress': '[{ from: [lon, lat], to: [lon, lat] }], tracées avec la progression',
    'the routes draw themselves on': 'les routes se tracent seules',
    'a map of the shapes the tool saved: countries filled from the tokens, the chosen ones in the accent, pins with their labels, routes as great circles drawn on': 'une carte des formes que l’outil a sauvegardées : les pays remplis depuis les tokens, les choisis à l’accent, des épingles avec leurs étiquettes, des routes en arcs de grand cercle qui se tracent',
    'places in the world: offices on a map, a journey drawn as a great circle, one country highlighted; the tool saves the shapes the map shows, so the project stays small': 'des lieux dans le monde : des bureaux sur une carte, un voyage en arc de grand cercle, un pays à l’accent ; l’outil sauvegarde les formes montrées, le projet reste petit',
    'a map nobody reads at a glance (too many pins), a flight faster than the eye follows (the check says so), labels on every pin': 'une carte que personne ne lit d’un coup d’œil (trop d’épingles), un vol plus vite que l’œil ne suit (la vérification le dit), des étiquettes sur chaque épingle',
    'the places or countries to show, separated with commas ("Lyon, Montreal, Dakar", "Brazil", "NYC")': 'les lieux ou pays à montrer, séparés par des virgules (« Lyon, Montreal, Dakar », « Brazil », « NYC »)',
    'the places joined as great circles, drawn on in order': 'les lieux joints en arcs de grand cercle, tracés dans l’ordre',
    'the small world at 110m, the cities at 50m; picked from the zoom by default': 'le petit monde en 110m, les villes en 50m ; choisi d’après le zoom par défaut',
    'picked from what is shown by default: a globe for the world, Mercator for a city': 'choisie d’après ce qui est montré par défaut : un globe pour le monde, Mercator pour une ville',
    'how long the map holds; a flight takes its time from it': 'combien de temps la carte tient ; un vol prend son temps de là',
    'places named in words found offline among the shipped places and countries, the projection and the framing chosen from what is shown, the project holding only the shapes the map shows': 'des lieux nommés en mots, trouvés hors ligne parmi les lieux et pays livrés, la projection et le cadrage choisis d’après ce qui est montré, le projet ne tenant que les formes que la carte montre',
    '"our offices in Lyon, Montreal and Dakar": the tool finds the places offline, frames them, and the project carries only those countries; a route joins two places the way a plane flies': '« nos bureaux à Lyon, Montréal et Dakar » : l’outil trouve les lieux hors ligne, les cadre, et le projet ne porte que ces pays ; une route joint deux lieux comme vole un avion',
    'more than about eight pins on one map, an ambiguous name answered with a guess (the tool asks back), a world map when three countries tell the story': 'plus de huit épingles environ sur une carte, un nom ambigu répondu au hasard (l’outil demande), une carte du monde quand trois pays racontent l’histoire',
    'pins too small to see at their zoom, labels overlapping, a flight faster than the eye follows (the camera doubling in under 0.6 s)': 'des épingles trop petites à leur zoom, des étiquettes qui se chevauchent, un vol plus vite que l’œil ne suit (le zoom qui double en moins de 0,6 s)',
  },
};
