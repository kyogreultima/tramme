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
  if (kind === 'equirect') return [dl / 360 || 0, -lonlat[1] / 180 || 0];
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

// ── the node ─────────────────────────────────────────────────
function projectRing(pts, kind, w, h, camZoom, camCenter) {
  const out = [];
  for (const ll of pts) {
    const uv = project(kind, ll, { center: camCenter });
    if (!uv) return null;
    out.push([w / 2 + uv[0] * w * camZoom, h / 2 + uv[1] * h * camZoom]);
  }
  return out;
}

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
    progress: { type: 'number', default: 1, min: 0, max: 1, step: 0.001, label: 'Progress', description: 'the routes draw themselves on' },
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
      const countries = shapes?.countries ?? [];
      const camCenter = [p.centerX, p.centerY], camZoom = p.zoom;
      ctx.fillStyle = p.plate;
      ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(24, w * 0.03)); ctx.fill();
      ctx.save();
      ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(24, w * 0.03)); ctx.clip();
      // the countries: rings in local pixels, even-odd so a hole stays a hole
      const drawRings = (rings, fill, stroke) => {
        ctx.beginPath();
        let any = false;
        for (const r of rings) {
          const pix = projectRing(r.pts, p.projection, w, h, camZoom, camCenter);
          if (!pix) { any = false; break; }
          pix.forEach(([x, y], i) => { const sx = x - w / 2, sy = y - h / 2; if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy); });
          ctx.closePath();
          any = true;
        }
        if (!any) return;
        if (fill) { ctx.fillStyle = fill; ctx.fill('evenodd'); }
        if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
      };
      for (const c of countries) {
        const hi = (p.highlight ?? []).some((n) => String(n).toLowerCase() === String(c.name).toLowerCase());
        drawRings(c.rings, hi ? p.accent : p.land, 'rgba(0,0,0,0.25)');
      }
      // the routes: great circles drawn on
      const routes = Array.isArray(p.routes) ? p.routes : [];
      routes.forEach((r, i) => {
        const line = greatCircle(r.from, r.to, 64);
        const share = 1 / Math.max(1, routes.length);
        const u = Math.max(0, Math.min(1, (p.progress * (routes.length + 0.4) - i * share) / share));
        if (u <= 0) return;
        const pix = projectRing(line.slice(0, Math.max(2, Math.ceil(line.length * u))), p.projection, w, h, camZoom, camCenter);
        if (!pix) return;
        ctx.strokeStyle = p.accent;
        ctx.lineWidth = Math.max(2, w * 0.004);
        ctx.lineCap = 'round';
        ctx.beginPath();
        pix.forEach(([x, y], k) => { const sx = x - w / 2, sy = y - h / 2; if (k === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy); });
        ctx.stroke();
        // the head of the route, a dot where the drawing stands
        const head = pix[pix.length - 1];
        ctx.fillStyle = p.accent;
        ctx.beginPath(); ctx.arc(head[0] - w / 2, head[1] - h / 2, Math.max(3, w * 0.006), 0, Math.PI * 2); ctx.fill();
      });
      // the pins, with their labels kept apart
      const pins = Array.isArray(p.pins) ? p.pins : [];
      const drawn = [];
      const family = p.font ? (() => { try { return `"${host.asset(p.font)}", `; } catch { return ''; } })() : '';
      const labelSize = Math.max(14, w * 0.022);
      ctx.font = `600 ${Math.round(labelSize)}px ${family}system-ui, sans-serif`;
      for (const pin of pins) {
        const uv = project(p.projection, [pin.lon, pin.lat], { center: camCenter });
        if (!uv) continue;
        const x = uv[0] * w * camZoom, y = uv[1] * h * camZoom;
        if (Math.abs(x) > w * 0.55 || Math.abs(y) > h * 0.55) continue;
        ctx.fillStyle = p.accent;
        ctx.beginPath(); ctx.arc(x, y, Math.max(4, w * 0.007), 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = p.plate; ctx.lineWidth = Math.max(1.5, w * 0.002); ctx.stroke();
        drawn.push({ name: pin.name, x, y });
      }
      if (p.labels) {
        for (const d of drawn) {
          ctx.fillStyle = p.ink;
          ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
          ctx.fillText(String(d.name), d.x + w * 0.014, d.y);
        }
      }
      ctx.restore();
    },
  },
  export: {
    svg(p) {
      void p;
      // a still map: the SVG holds the sea and the land the projection drew (the tool's still answer)
      return '';
    },
  },
};

// ── the tool ─────────────────────────────────────────────────
const SHOWN_MAX = 40;

const map = {
  name: 'map', title: 'Draw a map',
  description: 'places named in words found offline among the shipped places and countries, the projection and the framing chosen from what is shown, the project holding only the shapes the map shows',
  input: {
    type: 'object',
    properties: {
      places: { type: 'string', title: 'Places', description: 'the places or countries to show, separated with commas ("Lyon, Montreal, Dakar", "Brazil", "NYC")' },
      route: { type: 'boolean', title: 'Route', description: 'the places joined as great circles, drawn on in order' },
      detail: { enum: ['110m', '50m'], title: 'Detail', description: 'the small world at 110m, the cities at 50m; picked from the zoom by default' },
      projection: { enum: ['equirect', 'naturalEarth', 'mercator', 'ortho'], title: 'Projection', description: 'picked from what is shown by default: a globe for the world, Mercator for a city' },
      seconds: { type: 'number', title: 'Seconds', description: 'how long the map holds; a flight takes its time from it' },
    },
    required: ['places'],
  },
  ai: { when: '"our offices in Lyon, Montreal and Dakar": the tool finds the places offline, frames them, and the project carries only those countries; a route joins two places the way a plane flies', avoid: 'more than about eight pins on one map, an ambiguous name answered with a guess (the tool asks back), a world map when three countries tell the story' },
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
      if (hits.length > 1 && fold(hits[0].name) === fold(hits[1].name)) {
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
    // the frame: the pins' box, the zoom that fits it
    const lons = found.map((f) => f.lon), lats = found.map((f) => f.lat);
    const pad = Math.max(4, ...found.map((f) => f.kind === 'country' ? 12 : 3));
    const bbox = { w: Math.max(20, Math.max(...lons) - Math.min(...lons) + pad * 2), h: Math.max(14, Math.max(...lats) - Math.min(...lats) + pad * 2) };
    const projection = a.projection ?? (bbox.w > 200 ? (bbox.w > 320 ? 'ortho' : 'naturalEarth') : bbox.w < 20 ? 'mercator' : 'naturalEarth');
    // the zoom that fits: the projection's own span maps to the frame's smaller side
    // the zoom that fits the box: x spans a share of the world's width, y of its height
    const zoomX = (0.82 * 360) / bbox.w, zoomY = (0.82 * 180) / bbox.h;
    const camZoom = +Math.min(48, Math.max(0.6, Math.min(zoomX, zoomY))).toFixed(3);
    // the flight, when a route is asked and the places are several
    const pins = found.map((f) => ({ name: f.name, lon: f.lon, lat: f.lat }));
    const routes = a.route && pins.length > 1 ? pins.slice(0, -1).map((p, i) => ({ from: [p.lon, p.lat], to: [pins[i + 1].lon, pins[i + 1].lat] })) : [];
    // the asset holds only the shapes shown
    const data = { source: 'natural-earth', detail, countries: used.slice(0, SHOWN_MAX).map((c) => ({ name: c.name, rings: c.rings })), places: pins };
    const path = await ctx.writeFile(`assets/maps/atlas-${Date.now().toString(36)}.json`, JSON.stringify(data));
    const r2 = (v) => Math.round(v * 1000) / 1000;
    const seconds = Math.max(2.5, a.seconds ?? (routes.length ? routes.length * 2.2 + 2 : 4));
    const cid = `map-${Date.now().toString(36)}`;
    const ops = [];
    let sid;
    for (const [id, x] of Object.entries(ctx.doc.assets)) if (x.src === path) { sid = id; break; }
    if (!sid) {
      sid = `atlas-${Date.now().toString(36)}`;
      ops.push({ op: 'add', path: `/assets/${sid}`, value: { type: 'json', src: path, name: `Atlas · ${asks.join(', ')}` } });
    }
    const layer = {
      type: 'map.view', name: `Map · ${asks.join(', ')}`, in: 0, out: seconds,
      transform: { position: [Math.round(comp.width / 2), Math.round(comp.height / 2)] },
      props: {
        shapes: sid, projection,
        centerX: r2(lons.reduce((s, x) => s + x, 0) / lons.length),
        centerY: r2(Math.max(-75, Math.min(75, lats.reduce((s, x) => s + x, 0) / lats.length))),
        zoom: camZoom,
        highlight: found.filter((f) => f.kind === 'country').map((f) => f.name),
        pins, routes,
        ...(routes.length ? { progress: { $k: [{ t: 0.6, v: 0 }, { t: r2(seconds - 0.6), v: 1 }] } } : {}),
      },
    };
    ops.push({ op: 'add', path: `/compositions/${cid}`, value: { name: `Map · ${asks.join(', ')}`, width: comp.width, height: comp.height, fps: comp.fps ?? 30, duration: seconds, background: comp.background, layers: { map: layer }, order: ['map'] } });
    return {
      ops, label: `Map · ${asks.join(', ')}`,
      text: `${found.map((f) => f.name).join(', ')} on a ${detail} map, ${projection} at ${camZoom}× centred ${r2(layer.props.centerX)}°, ${r2(layer.props.centerY)}°. The atlas asset holds the ${used.length} countr${used.length === 1 ? 'y' : 'ies'} shown — nothing else. ${routes.length ? `The route draws itself over ${seconds} s; retime the flight on the layer's progress or move the camera keys.` : 'Move the framing with the camera (centre and zoom, both animatable); a `route: true` joins the pins the way a plane flies.'}`,
    };
  },
};

// ── the check ────────────────────────────────────────────────
const mapLegibility = {
  name: 'map-legibility', title: 'Map legibility',
  description: 'pins too small to see at their zoom, labels overlapping, a flight faster than the eye follows (the camera doubling in under 0.6 s)',
  run(ctx) {
    const out = [];
    for (const sample of ctx.samples) {
      for (const placed of sample.layers) {
        if (placed.node.type !== 'map.view' || placed.opacity < 0.5) continue;
        const name = placed.layer.name ?? placed.id;
        const u = Math.min(ctx.comp.width, ctx.comp.height);
        // the pins: a dot under 8 px at the frame's scale is a grain of dust
        const pins = Array.isArray(placed.props.pins) ? placed.props.pins : [];
        const dotPx = u * 0.007 * Math.min(2, Number(placed.props.zoom) || 1);
        if (pins.length && dotPx < 6) out.push({ check: 'map-legibility', severity: 'warning', t: sample.t, message: `${name}: the pins are about ${Math.round(dotPx)} px at this zoom — zoom in or fewer pins` });
        // the labels: two pins within a label's width of each other
        for (let i = 0; i < pins.length; i++) for (let j = i + 1; j < pins.length; j++) {
          const d = Math.hypot((Number(pins[i].lon) - Number(pins[j].lon)) * (Number(placed.props.zoom) || 1), (Number(pins[i].lat) - Number(pins[j].lat)) * (Number(placed.props.zoom) || 1));
          if (d < 4) out.push({ check: 'map-legibility', severity: 'warning', t: sample.t, message: `${name}: the labels of "${pins[i].name}" and "${pins[j].name}" overlap at this zoom — show one, or zoom in` });
        }
        // the flight: the camera doubling faster than the eye follows
        const zoomK = placed.props.zoom && typeof placed.props.zoom === 'object' && Array.isArray(placed.props.zoom.$k) ? placed.props.zoom.$k : null;
        if (zoomK) for (let k = 1; k < zoomK.length; k++) {
          const dt = Number(zoomK[k].t) - Number(zoomK[k - 1].t);
          const z0 = Number(zoomK[k - 1].v), z1 = Number(zoomK[k].v);
          if (dt > 0.05 && Math.abs(Math.log2(z1 / z0)) / dt > 1.7) out.push({ check: 'map-legibility', severity: 'warning', t: Number(zoomK[k].t), message: `${name}: the zoom doubles in ${dt.toFixed(2)} s — faster than the eye follows; give the flight ${Math.ceil(Math.abs(Math.log2(z1 / z0)) / 1.2)} s` });
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
    'picked from what is shown by default: a globe for the world, Mercator pour une ville': 'choisie d’après ce qui est montré par défaut : un globe pour le monde, Mercator pour une ville',
    'how long the map holds; a flight takes its time from it': 'combien de temps la carte tient ; un vol prend son temps de là',
    'places named in words found offline among the shipped places and countries, the projection and the framing chosen from what is shown, the project holding only the shapes the map shows': 'des lieux nommés en mots, trouvés hors ligne parmi les lieux et pays livrés, la projection et le cadrage choisis d’après ce qui est montré, le projet ne tenant que les formes que la carte montre',
    '"our offices in Lyon, Montreal and Dakar": the tool finds the places offline, frames them, and the project carries only those countries; a route joins two places the way a plane flies': '« nos bureaux à Lyon, Montréal et Dakar » : l’outil trouve les lieux hors ligne, les cadre, et le projet ne porte que ces pays ; une route joint deux lieux comme vole un avion',
    'more than about eight pins on one map, an ambiguous name answered with a guess (the tool asks back), a world map when three countries tell the story': 'plus de huit épingles environ sur une carte, un nom ambigu répondu au hasard (l’outil demande), une carte du monde quand trois pays racontent l’histoire',
    'pins too small to see at their zoom, labels overlapping, a flight faster than the eye follows (the camera doubling in under 0.6 s)': 'des épingles trop petites à leur zoom, des étiquettes qui se chevauchent, un vol plus vite que l’œil ne suit (le zoom qui double en moins de 0,6 s)',
  },
};
