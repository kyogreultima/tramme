// Screen recordings played as product films: the picture goes where things
// happen. The tool samples the recording (through the stills the page renders
// of the video layer, at times it chooses), measures where the picture
// changes on a small grid, tells the whole-screen change of a scroll or a
// page load from the local one, and from the regions of interest over time
// keys zooms on the video layer — in, held while the activity stays, out
// before each page change — and marks a found click with the walkthrough
// pack's cursor ripple. Everything is ordinary keys: editable, never applied
// without the user.

// ── where the picture changes ────────────────────────────────
/**
 * The bounding box of the grid cells (32 px by default) whose mean absolute
 * difference is over 12, and how much of the frame changed on average;
 * null when nothing moved. `a` and `b` are RGBA pixels of a w×h frame.
 */
export function activity(a, b, w, h, cell = 32) {
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, amount = 0, cells = 0;
  for (let cy = 0; cy < h; cy += cell) {
    for (let cx = 0; cx < w; cx += cell) {
      let sum = 0, count = 0;
      const yEnd = Math.min(cy + cell, h), xEnd = Math.min(cx + cell, w);
      for (let y = cy; y < yEnd; y++) {
        for (let x = cx; x < xEnd; x++) {
          const i = (y * w + x) * 4;
          sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
          count++;
        }
      }
      const mean = sum / (count * 3);
      if (mean > 12) {
        x0 = Math.min(x0, cx); y0 = Math.min(y0, cy);
        x1 = Math.max(x1, xEnd); y1 = Math.max(y1, yEnd);
      }
      amount += mean;
      cells++;
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, amount: amount / cells };
}

/** how many looks a recording takes: one every 500 ms, a 30-minute recording capped at one a second */
export function sampleTimes(duration, cap = 1800) {
  const step = Math.max(0.5, duration / cap);
  const times = [];
  for (let t = 0; t < duration - 1e-6 && times.length < cap; t += step) times.push(+t.toFixed(3));
  return times;
}

// ── the zooms ────────────────────────────────────────────────
const area = (b) => b.w * b.h;
const centre = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const PAGE = 0.6;

/** a zoom reads at 1.5× a second at most, held a beat, and never cuts its region off */
function scaleFor(box, frame, maxScale) {
  const s = Math.min(frame.w / Math.max(8, box.w), frame.h / Math.max(8, box.h)) * 0.86;
  return Math.min(maxScale, Math.max(1, s));
}

/** the zoom's pace: under the 1.5× a second the screencast-motion check holds, with room for the keys' rounding */
const ZOOM_RATE = 1.4;
/** how long a zoom from 1 to `scale` takes at that pace (half a second at least) */
const rampFor = (scale) => Math.max(0.5, (scale - 1) / ZOOM_RATE);

/**
 * The zoom keys of a recording, from its regions of interest over time: in
 * when a region appears (eased, at most 1.5× a second), held while the region
 * stays, out before a whole-screen change (a page change covers more than
 * 60 % of the frame), never over `maxScale`, never moving during a scroll,
 * and never overlapping the next zoom. The keys are { t, scale, x, y }: the
 * zoom, and the point of the picture (frame pixels) brought to the centre.
 */
export function zoomKeys(regions, frame, maxScale = 2.5) {
  const keys = [];
  const frameArea = frame.w * frame.h;
  // the holds: consecutive regions staying in one place, the page changes between them
  const holds = [];
  let run = null;
  for (const r of regions) {
    const page = !r.box || area(r.box) > PAGE * frameArea;
    if (page) {
      if (run) holds.push(run);
      run = null;
      continue;
    }
    const c = centre(r.box);
    if (run && Math.hypot(c.x - run.c.x, c.y - run.c.y) < 0.2 * Math.min(frame.w, frame.h)) {
      run.to = r.t;
      run.box = { x: Math.min(run.box.x, r.box.x), y: Math.min(run.box.y, r.box.y), w: Math.max(run.box.w, r.box.w), h: Math.max(run.box.h, r.box.h) };
    } else {
      if (run) holds.push(run);
      run = { from: r.t, to: r.t, box: { ...r.box }, c };
    }
  }
  if (run) holds.push(run);
  // the next page change after each hold: the zoom is out 0.4 s before it
  const changes = regions.filter((r) => !r.box || area(r.box) > PAGE * frameArea).map((r) => r.t);
  let free = -Infinity; // the zoom before is out by then
  for (const hold of holds) {
    const scale = scaleFor(hold.box, frame, maxScale);
    if (scale <= 1.02) continue;
    const c = centre(hold.box), x = Math.round(c.x), y = Math.round(c.y);
    const start = Math.max(hold.from, free);
    const next = changes.find((t) => t > hold.to);
    // the time until the page changes bounds the zoom: in and out at the pace allowed, a smaller zoom when the time is short
    const room = next !== undefined ? next - 0.4 - start : Infinity;
    const zoom = Math.min(scale, 1 + (ZOOM_RATE * room) / 2);
    if (zoom <= 1.02) continue;
    const ramp = Math.min(rampFor(zoom), room / 2);
    const outAt = Math.max(start + ramp, next !== undefined ? Math.min(hold.to + 0.4, next - 0.4 - ramp) : hold.to + 0.4);
    keys.push({ t: +start.toFixed(3), scale: 1, x, y });
    keys.push({ t: +(start + ramp).toFixed(3), scale: +zoom.toFixed(3), x, y });
    keys.push({ t: +outAt.toFixed(3), scale: +zoom.toFixed(3), x, y });
    keys.push({ t: +(outAt + ramp).toFixed(3), scale: 1, x, y });
    free = outAt + ramp;
  }
  return keys;
}

/** the zoom at t between its keys (linear: the ripple of a click needs where the picture stands, not the curve) */
export function zoomAt(keys, t) {
  if (!keys.length || t <= keys[0].t) return keys[0] ?? { scale: 1, x: 0, y: 0 };
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1], b = keys[i];
    if (t <= b.t) {
      const u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
      return { scale: a.scale + (b.scale - a.scale) * u, x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    }
  }
  return keys[keys.length - 1];
}

/**
 * The layer's position that brings a point of the picture to the frame's
 * centre at a zoom: the picture filling the frame at `base` (its position at
 * zoom 1), its edges never pulled inside the frame.
 */
export function positionFor(point, zoom, frame, base = [frame.w / 2, frame.h / 2]) {
  const cx = frame.w / 2, cy = frame.h / 2;
  const slackX = ((zoom - 1) * frame.w) / 2, slackY = ((zoom - 1) * frame.h) / 2;
  const px = cx - zoom * (point[0] - base[0]), py = cy - zoom * (point[1] - base[1]);
  return [Math.round(Math.min(cx + slackX, Math.max(cx - slackX, px))), Math.round(Math.min(cy + slackY, Math.max(cy - slackY, py)))];
}

/**
 * The clicks of a recording: a small region (under 3 % of the frame)
 * appearing after at least 0.3 s of stillness, with its point.
 */
export function clicksOf(regions, frame) {
  const out = [];
  let last = -1e9;
  for (const r of regions) {
    if (!r.box) continue;
    const small = area(r.box) < 0.03 * frame.w * frame.h;
    if (small && r.t - last >= 0.3) out.push({ t: +r.t.toFixed(3), x: Math.round(centre(r.box).x), y: Math.round(centre(r.box).y) });
    last = r.t;
  }
  return out;
}

// ── the tool ─────────────────────────────────────────────────
/** a JPEG still of the composition into pixels (the editor's page has the canvas; the tests hand theirs over) */
async function decodeStill(url) {
  if (typeof Image === 'undefined' || typeof document === 'undefined') throw new Error('reading the recording needs the editor\'s page');
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  return { data: g.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
}

const screencast = {
  name: 'screencast', title: 'Play a screen recording',
  description: 'a recording as a product film: the picture zooms where things happen and out before each page change, a click found is marked with the cursor\'s ripple',
  input: {
    type: 'object',
    properties: {
      layer: { type: 'string', format: 'layer', layerType: 'video', title: 'Recording', description: 'the video layer to key; the selected one, or the only one' },
      cell: { type: 'number', title: 'Grid', description: 'the grid cell of the change measure, in px (32 by default)' },
      maxScale: { type: 'number', title: 'Zoom at most', description: '2.5 by default: past it a recording reads as shake' },
      speedUp: { type: 'boolean', title: 'Mark the stills', description: 'the still stretches are said in the answer, for a speed-up or a cut — offered, never applied' },
    },
  },
  ai: { when: 'a product film from a screen recording: run it, look at the zooms it keys, cut or speed up the still stretches it names (with the user\'s word), and let the ripple say where the clicks land', avoid: 'a recording played flat at its recorded size; zooms over 2.5× (the pixels break up), a zoom during a scroll, keys placed over every little motion' },
  async run(a, ctx) {
    const doc = ctx.doc, comp = doc.compositions[ctx.compId];
    const videoLayers = Object.entries(comp.layers).filter(([, l]) => l.type === 'video');
    if (!videoLayers.length) throw new Error('screencast needs a video layer of the composition');
    const chosen = a.layer && comp.layers[a.layer] ? a.layer : ctx.selection.find((id) => comp.layers[id]?.type === 'video') ?? (videoLayers.length === 1 ? videoLayers[0][0] : null);
    if (!chosen) throw new Error('say which video layer to play, or select it');
    const layer = comp.layers[chosen], asset = layer.props?.video, media = doc.assets[asset];
    if (!media) throw new Error('the video layer plays no asset');
    const duration = Math.max(0.1, (layer.out ?? comp.duration) - (layer.in ?? 0));
    const w = comp.width, h = comp.height;
    const times = sampleTimes(duration);
    const capped = duration > 900;
    // the stills of the recording, rendered by the page at the times chosen
    const read = typeof ctx.readStill === 'function'
      ? (t) => ctx.readStill(t)
      : async (t) => decodeStill(await ctx.renderStill(+(t + (layer.in ?? 0)).toFixed(3)));
    // the regions of interest, from one still to the next: only the last still is kept (a long
    // recording would not fit in memory as pictures), its box brought to the composition's pixels
    const regions = [];
    let prev = null;
    for (let k = 0; k < times.length; k++) {
      if (ctx.signal.aborted) throw new Error('stopped');
      if (k % 8 === 0) ctx.progress?.(k, times.length);
      const px = await read(times[k]);
      if (!px || !px.data) { regions.push({ t: times[k], box: null }); prev = null; continue; }
      const pw = px.w ?? w, ph = px.h ?? h;
      const found = prev && prev.w === pw && prev.h === ph ? activity(prev.data, px.data, pw, ph, a.cell ?? 32) : null;
      const sx = w / pw, sy = h / ph;
      regions.push({ t: times[k], box: found ? { x: found.x * sx, y: found.y * sy, w: found.w * sx, h: found.h * sy, amount: found.amount } : null });
      prev = { data: px.data, w: pw, h: ph };
    }
    const data = { version: 1, kind: 'screencast', source: asset, width: w, height: h, regions: regions.map((r) => ({ t: r.t, box: r.box, kind: !r.box ? 'still' : area(r.box) > 0.6 * w * h ? 'page' : area(r.box) < 0.03 * w * h ? 'click' : 'activity' })) };
    const path = await ctx.writeFile(`assets/screencast/${asset}.json`, JSON.stringify(data));
    // the zooms on the layer: scale and position, as ordinary keys
    const keys = zoomKeys(regions, { w, h }, a.maxScale ?? 2.5);
    const clicks = clicksOf(regions, { w, h });
    const ops = [];
    let sid;
    for (const [id, x] of Object.entries(doc.assets)) if (x.src === path) { sid = id; break; }
    if (!sid) {
      sid = `screencast-${asset}`;
      ops.push({ op: 'add', path: `/assets/${sid}`, value: { type: 'json', src: path, name: `Screencast · ${media.name ?? asset}` } });
    }
    // the keys are on the composition's clock: the recording's times start at the layer's in point
    const t0 = layer.in ?? 0, at = (t) => +(t + t0).toFixed(3);
    if (keys.length) {
      // the zoom over the layer's own scale, the point of action brought to the centre by its position
      const s0 = Array.isArray(layer.transform?.scale) ? layer.transform.scale : [1, 1];
      const p0 = Array.isArray(layer.transform?.position) ? layer.transform.position : [w / 2, h / 2];
      const EASE = [0.42, 0, 0.58, 1];
      const scale = keys.map((k) => ({ t: at(k.t), v: [+(s0[0] * k.scale).toFixed(4), +(s0[1] * k.scale).toFixed(4)], ease: EASE }));
      const position = keys.map((k) => ({ t: at(k.t), v: k.scale === 1 ? [...p0] : positionFor([k.x, k.y], k.scale, { w, h }, p0), ease: EASE }));
      ops.push({ op: layer.transform?.scale === undefined ? 'add' : 'replace', path: `/compositions/${ctx.compId}/layers/${chosen}/transform/scale`, value: { $k: scale } });
      ops.push({ op: layer.transform?.position === undefined ? 'add' : 'replace', path: `/compositions/${ctx.compId}/layers/${chosen}/transform/position`, value: { $k: position } });
    }
    // a click found is marked with the walkthrough pack's cursor ripple, where the zoom shows its point at that moment
    const taken = new Set(Object.keys(comp.layers));
    const p0 = Array.isArray(layer.transform?.position) ? layer.transform.position : [w / 2, h / 2];
    const onScreen = (c) => {
      const z = zoomAt(keys, c.t);
      if (z.scale === 1) return [c.x, c.y];
      const P = positionFor([z.x, z.y], z.scale, { w, h }, p0);
      return [Math.round(P[0] + z.scale * (c.x - p0[0])), Math.round(P[1] + z.scale * (c.y - p0[1]))];
    };
    clicks.forEach((c, k) => {
      let id = `click-${k + 1}`;
      for (let n = 2; taken.has(id); n++) id = `click-${k + 1}-${n}`;
      taken.add(id);
      ops.push({ op: 'add', path: `/compositions/${ctx.compId}/layers/${id}`, value: {
        type: 'ui.cursor', name: `Click ${k + 1}`, in: Math.max(0, at(c.t) - 0.3), out: Math.min(comp.duration, at(c.t) + 0.6),
        transform: { position: onScreen(c) },
        props: { pos: [0, 0], click: { $k: [{ t: at(c.t), v: 0 }, { t: at(c.t + 0.16), v: 1 }, { t: at(c.t + 0.5), v: 0 }] } },
      } });
      ops.push({ op: 'add', path: `/compositions/${ctx.compId}/order/-`, value: id });
    });
    // the still stretches, said for the edit (a speed-up or a cut, never applied alone)
    const stills2 = [];
    for (const r of data.regions) {
      const last = stills2.at(-1);
      if (last?.kind === 'still' && r.kind === 'still') last.to = r.t;
      else stills2.push({ from: r.t, to: r.t, kind: r.kind });
    }
    const quiet = stills2.filter((s) => s.kind === 'still' && s.to - s.from >= 2);
    return {
      ops, label: `Screencast · ${media.name ?? asset}`,
      text: [
        `${regions.length} look(s) of the recording (one every ${duration > 900 ? 'second — the 30 minutes are capped at 1 800' : 'half second'}), saved as asset "${sid}".`,
        keys.length ? `${keys.filter((k) => k.scale > 1).length ? 'Zooms keyed' : 'No zoom worth keying'}: the layer's scale and position move where the action is, out again before each page change.` : 'Nothing moves locally: no zoom keyed.',
        clicks.length ? `${clicks.length} click(s) marked with the cursor's ripple, at ${clicks.map((c) => `${c.t.toFixed(1)} s`).join(', ')}.` : 'No click found.',
        quiet.length && a.speedUp !== false ? `Still stretches for the edit: ${quiet.slice(0, 8).map((s) => `${s.from.toFixed(1)}–${s.to.toFixed(1)} s`).join(', ')}${quiet.length > 8 ? ` and ${quiet.length - 8} more` : ''} — a speed-up or a cut, on your word.` : '',
        'The keys are ordinary: move a zoom on the layer\'s scale and position, delete a ripple, edit the regions in the asset.',
      ].filter(Boolean).join('\n'),
    };
  },
};

// ── the check ────────────────────────────────────────────────
const screencastMotion = {
  name: 'screencast-motion', title: 'Screencast motion',
  description: 'a zoom faster than the eye follows (over 1.5× a second), a region of interest off the frame, a zoom during a page change',
  run(ctx) {
    const out = [];
    for (const l of Object.values(ctx.comp.layers ?? {})) {
      if (l.type !== 'video') continue;
      const scale = l.transform?.scale;
      if (!scale || typeof scale !== 'object' || !Array.isArray(scale.$k)) continue;
      const name = l.name ?? 'the recording';
      for (let k = 1; k < scale.$k.length; k++) {
        const dt = Number(scale.$k[k].t) - Number(scale.$k[k - 1].t);
        const ds = Math.abs(Number(scale.$k[k].v?.[0] ?? scale.$k[k].v) - Number(scale.$k[k - 1].v?.[0] ?? scale.$k[k - 1].v));
        if (dt > 0.05 && ds / dt > 1.5) {
          out.push({ check: 'screencast-motion', severity: 'warning', t: Number(scale.$k[k].t), message: `${name}: the zoom moves ${(ds / dt).toFixed(1)}× a second — over 1.5 the eye loses the picture; stretch the key over ${Math.ceil(ds / 1.5 * 10) / 10} s` });
        }
      }
      // the zoomed focus: kept inside the picture, never over the edges
      const focus = l.props?.focus;
      if (focus && typeof focus === 'object' && Array.isArray(focus.$k)) {
        for (const key of focus.$k) {
          const [fx, fy] = Array.isArray(key.v) ? key.v : [0.5, 0.5];
          if (fx < 0 || fx > 1 || fy < 0 || fy > 1) {
            out.push({ check: 'screencast-motion', severity: 'warning', t: Number(key.t), message: `${name}: the focus leaves the picture at ${Number(key.t).toFixed(1)} s — keep it inside, or the zoom shows past the recording's edge` });
          }
        }
      }
      // the zoomed picture moved by its position: it keeps covering the frame (a recording filling it at zoom 1)
      const pos = l.transform?.position;
      if (pos && typeof pos === 'object' && Array.isArray(pos.$k)) {
        const W = ctx.comp.width, H = ctx.comp.height;
        const base = Number(scale.$k[0]?.v?.[0] ?? 1) || 1;
        for (const key of pos.$k) {
          const sk = scale.$k.find((s) => Math.abs(Number(s.t) - Number(key.t)) < 1e-3);
          if (!sk || !Array.isArray(key.v)) continue;
          const zoom = (Number(sk.v?.[0] ?? sk.v) || 1) / base;
          const dx = Math.abs(key.v[0] - W / 2) - ((zoom - 1) * W) / 2, dy = Math.abs(key.v[1] - H / 2) - ((zoom - 1) * H) / 2;
          if (zoom > 1.01 && (dx > 2 || dy > 2)) out.push({ check: 'screencast-motion', severity: 'warning', t: Number(key.t), message: `${name}: at ${Number(key.t).toFixed(1)} s the zoom shows past the recording's edge — bring its position back toward the centre` });
        }
      }
    }
    return out;
  },
};

export const meta = { id: 'tramme/screencast', name: 'screencast', version: '1.0.0', description: 'Screen recordings played as product films: the picture zooms where things happen, out before each page change, clicks marked with a ripple', api: 1 };
export const tools = [screencast];
export const checks = [screencastMotion];
export const messages = {
  fr: {
    'Play a screen recording': 'Jouer une capture d’écran', 'Screencast motion': 'Mouvement de la capture',
    'Recording': 'Capture', 'Grid': 'Grille', 'Zoom at most': 'Zoom au plus', 'Mark the stills': 'Signaler les temps morts',
    'the video layer to key; the selected one, or the only one': 'la couche vidéo à keyframer ; la sélection, ou la seule',
    'the grid cell of the change measure, in px (32 by default)': 'la cellule de la grille de mesure du changement, en px (32 par défaut)',
    '2.5 by default: past it a recording reads as shake': '2,5 par défaut : au-delà, une capture se lit comme un tremblement',
    'the still stretches are said in the answer, for a speed-up or a cut — offered, never applied': 'les temps morts sont dits dans la réponse, pour une accélération ou une coupe — proposés, jamais appliqués',
    'a recording as a product film: the picture zooms where things happen and out before each page change, a click found is marked with the cursor\'s ripple': 'une capture jouée comme un film produit : l’image zoome là où ça se passe et dézoome avant chaque changement de page, un clic repéré est marqué de l’onde du curseur',
    'a zoom faster than the eye follows (over 1.5× a second), a region of interest off the frame, a zoom during a page change': 'un zoom plus vite que l’œil ne suit (plus de 1,5× par seconde), une région d’intérêt hors du cadre, un zoom pendant un changement de page',
  },
};
