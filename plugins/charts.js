// Charts: bar, line and donut, drawn from a JSON data set of the project or
// from inline values, animated with a staggered reveal. A chart is a pure
// function of t: the same data and time always draw the same picture. The
// `chart` tool lays one out in the composition, in its colours; the
// chart-readability check says when a chart is too dense to read.

const FONT = (p, host, size, weight = 600) => {
  let family = '';
  if (p.font) { try { family = `"${host.asset(p.font)}", `; } catch { family = ''; } }
  return `${weight} ${size}px ${family}system-ui, sans-serif`;
};

/** the data as [{ label, value }]: the json `data` asset when there is one, the inline values otherwise */
export function seriesOf(p, host) {
  let raw = p.values;
  if (p.data) { try { raw = host.asset(p.data); } catch { raw = p.values; } }
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.series) ? raw.series : [];
  return list
    .map((d) => (Array.isArray(d) ? { label: String(d[0] ?? ''), value: Number(d[1]) } : { label: String(d?.label ?? ''), value: Number(d?.value) }))
    .filter((d) => Number.isFinite(d.value));
}

/** the scale's top: v rounded up to a readable grid (370 -> 400) */
export function niceMax(v) {
  if (!(v > 0)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * pow >= v) return m * pow;
  return 10 * pow;
}

/** the x of each of n bars, their slot and width, in a w-wide plot */
export function barSlots(w, n, fill = 0.62) {
  const slot = w / Math.max(1, n);
  return { slot, barW: slot * fill, x: (i) => i * slot + (slot - slot * fill) / 2 };
}

/** the points of a line across a w×h plot, top at max */
export function linePoints(w, h, values, max) {
  const n = values.length;
  if (!n) return [];
  const span = Math.max(1, max);
  return values.map((v, i) => [n === 1 ? w / 2 : (i * w) / (n - 1), h - (Math.max(0, v) / span) * h]);
}

/** each slice's angles of a donut, from -90°, in radians, biggest shares first kept in order */
export function donutArcs(values) {
  const total = values.reduce((a, b) => a + Math.max(0, b), 0) || 1;
  let a = -Math.PI / 2;
  return values.map((v) => {
    const sweep = (Math.max(0, v) / total) * Math.PI * 2;
    const arc = { a0: a, a1: a + sweep, share: Math.max(0, v) / total };
    a += sweep;
    return arc;
  });
}

const fmt = (v) => (Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toString());

/** the reveal of bar i: 0..1 eased, staggered by index */
const barProgress = (t, i, stagger) => ease_(Math.min(1, Math.max(0, (t - i * stagger) / 0.7)));
const ease_ = (t) => 1 - Math.pow(1 - t, 3);

const DATA = { type: 'asset', assetType: 'json', default: null, nullable: true, label: 'Data set', animatable: false, description: 'a JSON file of the project: a list of { label, value } (or { series: […] }); empty: the values below' };

const barNode = {
  type: 'chart.bar', title: 'Bar chart', category: 'Charts',
  ai: { when: 'comparing a few figures (revenue by quarter, votes by candidate); sort the data by value, keep it under 9 categories, name each bar in one or two words', avoid: 'more than 9 categories, long labels, a log scale nobody reads' },
  props: {
    data: DATA,
    values: { type: 'json', default: [{ label: 'Q1', value: 32 }, { label: 'Q2', value: 51 }, { label: 'Q3', value: 44 }, { label: 'Q4', value: 68 }], label: 'Values', animatable: false, description: '[{ label, value }, …] used when there is no data set' },
    orientation: { type: 'enum', default: 'vertical', options: ['vertical', 'horizontal'], label: 'Orientation', animatable: false },
    fill: { type: 'paint', default: '#2EC4B6', label: 'Bars' },
    max: { type: 'number', default: 0, min: 0, label: 'Scale to', animatable: false, description: '0: the data\'s own maximum, rounded to a readable grid' },
    showValues: { type: 'bool', default: true, label: 'Values', animatable: false },
    showGrid: { type: 'bool', default: true, label: 'Grid', animatable: false },
    labelSize: { type: 'number', default: 0, min: 0, unit: 'px', label: 'Label size', animatable: false, description: '0: from the chart\'s size' },
    size: { type: 'vec2', default: [900, 500], label: 'Size', unit: 'px' },
    font: { type: 'asset', assetType: 'font', default: null, nullable: true, label: 'Font', animatable: false },
  },
  bounds: ({ size: [w, h] }) => ({ x: -w / 2, y: -h / 2, w, h }),
  path({ size: [w, h] }) { const s = new Path2D(); s.rect(-w / 2, -h / 2, w, h); return s; },
  render: {
    canvas2d(ctx, p, host) {
      const data = seriesOf(p, host);
      if (!data.length) return;
      const [w, h] = p.size;
      if (w <= 0 || h <= 0) return;
      const u = Math.min(w, h);
      const labelSize = p.labelSize || Math.round(u * 0.042);
      const t = host.t - (host.layerIn ?? 0);
      const stagger = data.length > 12 ? 0.03 : 0.09;
      const max = p.max > 0 ? p.max : niceMax(Math.max(...data.map((d) => d.value)));
      const values = data.map((d) => Math.max(0, d.value));
      // the layer's origin is its centre: draw in the chart's own 0..w × 0..h box, moved there
      ctx.save();
      ctx.translate(-w / 2, -h / 2);
      ctx.font = FONT(p, host, labelSize);
      ctx.textBaseline = 'alphabetic';

      if (p.orientation === 'horizontal') {
        const labelW = Math.min(w * 0.32, Math.max(...data.map((d) => d.label.length), 3) * labelSize * 0.62);
        const plotW = w - labelW - u * 0.06, plotH = h, row = plotH / data.length, barH = row * 0.6;
        if (p.showGrid) {
          ctx.strokeStyle = 'rgba(128,128,128,0.25)'; ctx.lineWidth = 1;
          for (let g = 0; g <= 4; g++) { const x = labelW + (plotW * g) / 4; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, plotH); ctx.stroke(); ctx.fillStyle = 'rgba(128,128,128,0.8)'; ctx.textAlign = 'center'; ctx.fillText(fmt((max * g) / 4), x, plotH + labelSize * 0.9); }
        }
        data.forEach((d, i) => {
          const y = i * row + (row - barH) / 2;
          ctx.fillStyle = 'rgba(128,128,128,0.9)', ctx.textAlign = 'right';
          ctx.fillText(d.label, labelW - u * 0.015, y + barH / 2 + labelSize * 0.35);
          const bw = (Math.max(0, d.value) / max) * plotW * barProgress(t, i, stagger);
          ctx.fillStyle = p.fill;
          ctx.beginPath(); ctx.roundRect(labelW, y, Math.max(1, bw), barH, Math.min(barH / 2, u * 0.012)); ctx.fill();
          if (p.showValues && barProgress(t, i, stagger) > 0.55) { ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.textAlign = 'left'; ctx.fillText(fmt(d.value), labelW + bw + u * 0.012, y + barH / 2 + labelSize * 0.35); }
        });
        return;
      }

      const plotH = h - (p.showGrid ? labelSize * 1.6 : 0) - labelSize * 1.4, baseline = h - labelSize * 1.4;
      const { slot, barW, x } = barSlots(w, data.length);
      if (p.showGrid) {
        ctx.strokeStyle = 'rgba(128,128,128,0.25)'; ctx.lineWidth = 1;
        for (let g = 0; g <= 4; g++) { const y = baseline - (plotH * g) / 4; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); ctx.fillStyle = 'rgba(128,128,128,0.8)'; ctx.textAlign = 'left'; ctx.fillText(fmt((max * g) / 4), 0, y - u * 0.012); }
      }
      const every = Math.ceil(data.length / 14);
      data.forEach((d, i) => {
        const bx = x(i), bh = (Math.max(0, d.value) / max) * plotH * barProgress(t, i, stagger);
        ctx.fillStyle = p.fill;
        ctx.beginPath(); ctx.roundRect(bx, baseline - bh, barW, Math.max(1, bh), Math.min(barW / 2, u * 0.012)); ctx.fill();
        if (p.showValues && barProgress(t, i, stagger) > 0.55) { ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.textAlign = 'center'; ctx.fillText(fmt(d.value), bx + barW / 2, baseline - bh - u * 0.02); }
        if (i % every === 0) { ctx.fillStyle = 'rgba(128,128,128,0.9)'; ctx.textAlign = 'center'; ctx.fillText(d.label, bx + barW / 2, baseline + labelSize); }
      });
      ctx.restore();
    },
  },
};

const lineNode = {
  type: 'chart.line', title: 'Line chart', category: 'Charts',
  ai: { when: 'a value over time (a price, an audience, a temperature): a rise or a fall is the story, so crop the scale to it and let the line draw itself', avoid: 'more than 3 lines on one chart; a scale from 0 when the story is the shape of the curve' },
  props: {
    data: DATA,
    values: { type: 'json', default: [12, 18, 15, 26, 34, 30, 45], label: 'Values', animatable: false, description: 'numbers only, left to right; the labels of a line chart are written as text layers' },
    smooth: { type: 'enum', default: 'smooth', options: ['smooth', 'straight'], label: 'Curve', animatable: false },
    area: { type: 'bool', default: true, label: 'Fill under', animatable: false },
    fill: { type: 'paint', default: '#2EC4B6', label: 'Line' },
    max: { type: 'number', default: 0, min: 0, label: 'Scale to', animatable: false, description: '0: the data\'s own maximum, rounded to a readable grid' },
    dots: { type: 'bool', default: true, label: 'Dots', animatable: false },
    drawFor: { type: 'number', default: 1.1, min: 0.2, unit: 's', label: 'Draw over', animatable: false },
    size: { type: 'vec2', default: [900, 420], label: 'Size', unit: 'px' },
    font: { type: 'asset', assetType: 'font', default: null, nullable: true, label: 'Font', animatable: false },
  },
  bounds: ({ size: [w, h] }) => ({ x: -w / 2, y: -h / 2, w, h }),
  path({ size: [w, h] }) { const s = new Path2D(); s.rect(-w / 2, -h / 2, w, h); return s; },
  render: {
    canvas2d(ctx, p, host) {
      const data = seriesOf(p, host);
      if (!data.length) return;
      const [w, h] = p.size;
      if (w <= 0 || h <= 0) return;
      const u = Math.min(w, h);
      const t = host.t - (host.layerIn ?? 0);
      const max = p.max > 0 ? p.max : niceMax(Math.max(...data.map((d) => d.value)));
      const pts = linePoints(w, h - u * 0.06, data.map((d) => Math.max(0, d.value)), max);
      const revealed = Math.min(1, t / Math.max(0.001, p.drawFor));
      // the layer's origin is its centre: draw in the chart's own 0..w × 0..h box, moved there
      ctx.save();
      ctx.translate(-w / 2, -h / 2);

      ctx.save();
      // the draw-on: the line is clipped to the fraction of the width its progress covers
      ctx.beginPath(); ctx.rect(0, 0, w * revealed, h); ctx.clip();
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      if (p.smooth === 'smooth') {
        for (let i = 1; i < pts.length; i++) {
          const mx = (pts[i - 1][0] + pts[i][0]) / 2, my = (pts[i - 1][1] + pts[i][1]) / 2;
          ctx.quadraticCurveTo(pts[i - 1][0], pts[i - 1][1], mx, my);
        }
        ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      } else for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
      if (p.area) {
        ctx.save();
        ctx.lineTo(pts[pts.length - 1][0], h - u * 0.06); ctx.lineTo(pts[0][0], h - u * 0.06); ctx.closePath();
        ctx.globalAlpha = 0.16; ctx.fillStyle = p.fill; ctx.fill();
        ctx.restore();
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        if (p.smooth === 'smooth') {
          for (let i = 1; i < pts.length; i++) { const mx = (pts[i - 1][0] + pts[i][0]) / 2, my = (pts[i - 1][1] + pts[i][1]) / 2; ctx.quadraticCurveTo(pts[i - 1][0], pts[i - 1][1], mx, my); }
          ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
        } else for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
      }
      ctx.strokeStyle = p.fill; ctx.lineWidth = Math.max(2, u * 0.008); ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
      if (p.dots) {
        ctx.fillStyle = p.fill;
        pts.forEach(([x, y], i) => {
          const at = pts.length === 1 ? 1 : i / (pts.length - 1);
          if (revealed >= at) { ctx.beginPath(); ctx.arc(x, y, Math.max(2.5, u * 0.011), 0, Math.PI * 2); ctx.fill(); }
        });
      }
      ctx.restore();
      // the last value, when the line is fully drawn
      if (revealed >= 1) { ctx.font = FONT(p, host, u * 0.055, 800); ctx.fillStyle = 'rgba(255,255,255,0.94)'; ctx.textAlign = pts[pts.length - 1][0] > w - u * 0.12 ? 'right' : 'left'; ctx.fillText(fmt(data[data.length - 1].value), Math.min(w - u * 0.01, pts[pts.length - 1][0] + u * 0.015), pts[pts.length - 1][1] - u * 0.03); }
      ctx.restore();
    },
  },
};

const donutNode = {
  type: 'chart.donut', title: 'Donut chart', category: 'Charts',
  ai: { when: 'parts of a whole (shares, budget lines): 2 to 5 slices, biggest first from 12 o\'clock, the percents on the big slices', avoid: 'more than 6 slices; a donut for values that do not sum to a whole' },
  props: {
    data: DATA,
    values: { type: 'json', default: [{ label: 'Direct', value: 46 }, { label: 'Search', value: 27 }, { label: 'Social', value: 17 }, { label: 'Other', value: 10 }], label: 'Values', animatable: false, description: '[{ label, value }, …]' },
    thickness: { type: 'number', default: 0.16, min: 0.04, max: 0.5, step: 0.01, unit: 'x', label: 'Thickness', animatable: false, description: 'of the radius' },
    innerLabel: { type: 'string', default: '', label: 'Centre text', animatable: false },
    showPercents: { type: 'bool', default: true, label: 'Percents', animatable: false },
    size: { type: 'vec2', default: [520, 520], label: 'Size', unit: 'px' },
    font: { type: 'asset', assetType: 'font', default: null, nullable: true, label: 'Font', animatable: false },
  },
  bounds: ({ size: [w, h] }) => ({ x: -w / 2, y: -h / 2, w, h }),
  path({ size: [w, h] }) { const s = new Path2D(); s.rect(-w / 2, -h / 2, w, h); return s; },
  render: {
    canvas2d(ctx, p, host) {
      const data = seriesOf(p, host);
      if (!data.length) return;
      const [w, h] = p.size;
      const u = Math.min(w, h);
      const t = host.t - (host.layerIn ?? 0);
      const arcs = donutArcs(data.map((d) => d.value));
      const r = Math.min(w, h) / 2 - u * 0.06, thickness = r * p.thickness;
      const stagger = 0.18;
      ctx.lineCap = 'butt';
      data.forEach((d, i) => {
        const { a0, share } = arcs[i];
        const sweep = (arcs[i].a1 - a0) * ease_(Math.min(1, Math.max(0, (t - i * stagger) / 0.6)));
        if (sweep <= 0) return;
        // each slice in its own turn of the palette: the accent first, then its tints
        ctx.strokeStyle = sliceColor(i, data.length);
        ctx.lineWidth = thickness;
        ctx.beginPath(); ctx.arc(0, 0, r - thickness / 2, a0, a0 + sweep); ctx.stroke();
        if (p.showPercents && share >= 0.06 && (t - i * stagger) > 0.45) {
          const mid = a0 + (arcs[i].a1 - a0) / 2, lr = r - thickness / 2;
          ctx.font = FONT(p, host, u * 0.055, 800);
          ctx.fillStyle = 'rgba(255,255,255,0.94)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(`${Math.round(share * 100)} %`, Math.cos(mid) * lr, Math.sin(mid) * lr);
        }
      });
      if (p.innerLabel) { ctx.font = FONT(p, host, u * 0.085, 800); ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p.innerLabel, 0, 0); }
    },
  },
};

// the slices' turns: the accent, then tints of it, so a chart reads as one family
function sliceColor(i, n) {
  const hue = 174, hue2 = 205, hue3 = 16;
  const set = [`hsl(${hue} 68% 48%)`, `hsl(${hue2} 62% 52%)`, `hsl(${hue3} 76% 55%)`, `hsl(${hue} 45% 62%)`, `hsl(${hue2} 40% 68%)`, `hsl(${hue} 30% 74%)`];
  return set[i % set.length];
}


// ── 1.1: CSV, ranks, ticks ───────────────────────────────────
/** a CSV into rows of string fields: the separator (`,` `;` or a tab) sniffed from the first line, quoted fields with doubled quotes kept whole */
export function parseCsv(text) {
  const src = String(text ?? '').replace(/\r\n?/g, '\n');
  const first = src.split('\n', 1)[0] ?? '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let q = false;
  for (const ch of first) {
    if (ch === '"') q = !q;
    else if (!q && ch in counts) counts[ch]++;
  }
  const sep = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0 ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ',';
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === sep) { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** a CSV field as a number: `1,5` reads as 1.5 (a decimal comma; a `;` file always has one) */
export function csvNumber(field) {
  const s = String(field ?? '').trim();
  if (/^-?\d+,\d+$/.test(s)) return parseFloat(s.replace(',', '.'));
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : NaN;
}

/** each period's ranking: the values of the period alone, ties broken by name, entries arriving and leaving allowed */
export function ranksOver(table) {
  return (table ?? []).map(({ period, values }) => {
    const names = Object.keys(values ?? {});
    names.sort((a, b) => (values[b] ?? -Infinity) - (values[a] ?? -Infinity) || (a < b ? -1 : 1));
    const rank = {};
    names.forEach((n, i) => { rank[n] = i + 1; });
    return { period, rank };
  });
}

/** the readable ticks of an axis: 0 to a nice top, a step of 1, 2, 2.5 or 5 times a power of ten */
export function ticks(min, max, count = 5) {
  const top = niceMax(Math.max(1e-9, max));
  const raw = (top - min) / Math.max(1, count);
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(1e-9, raw))));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const out = [];
  for (let v = min; v <= top + step * 0.001; v += step) out.push(+v.toFixed(6));
  return out;
}

/** the labels of a scatter kept apart: right of the point when it fits, left when it does not */
export function labelSides(points) {
  const placed = [];
  return points.map((p) => {
    const near = placed.some((q) => Math.hypot(q[0] - p.x, q[1] - p.y) < 0.075);
    const side = near && !placed.some((q) => Math.hypot(q[0] - p.x, q[1] - p.y) < 0.075 && q[2] === -1) ? -1 : 1;
    placed.push([p.x, p.y, side]);
    return side;
  });
}

const chartTool = {
  name: 'chart', title: 'Add a chart',
  description: 'a bar, line, donut, race, scatter or function chart from a JSON data set of the project or from a CSV (separators, quotes and decimal commas read), sized and placed in the composition, with an optional title above it',
  input: {
    type: 'object',
    properties: {
      data: { type: 'string', format: 'asset', assetType: 'json', title: 'Data set' },
      kind: { enum: ['bar', 'line', 'donut', 'race', 'scatter', 'function'], title: 'Kind', description: 'bar by default; a race takes a table of periods by entries, a function the sampled points' },
      title: { type: 'string', title: 'Title', description: 'a line above the chart, when the chart needs one' },
      orientation: { enum: ['vertical', 'horizontal'], title: 'Bar orientation' },
      points: { type: 'array', title: 'Points', items: { type: 'array', items: { type: 'number' } }, description: 'a function only: [[x, y], …] sampled from x = 0 to 1 — computed, never guessed' },
      entries: { type: 'integer', title: 'Entries', description: 'a race only: how many race at once (12 at most in 9:16, 20 in 16:9)' },
    },
  },
  async run({ data, kind = 'bar', title, orientation, points, entries }, ctx) {
    // a function chart takes its points; every other kind reads a data set of the project
    const a = data ? ctx.doc.assets[data] : null;
    if (kind !== 'function' && (!a || a.type !== 'json')) throw new Error(`${data ?? 'data'}: a JSON or CSV asset of the project is expected (a list of { label, value }, a table for a race)`);
    const c = ctx.doc.compositions[ctx.compId];
    const u = Math.min(c.width, c.height);
    const portrait = c.height > c.width;
    const cap = portrait ? 12 : 20;
    let props, note = '', count = 0;
    if (kind === 'race') {
      // the data set: a CSV text (separators, quotes, decimal commas), or the JSON table itself
      let text = null;
      if (a.src) { try { text = await ctx.readText(a.src); } catch { text = null; } }
      let table = tableOf(typeof text === 'string' ? text : []);
      if (!table.length && typeof text === 'string') {
        try { const j = JSON.parse(text); if (Array.isArray(j)) table = j.filter((r) => r?.values); } catch { /* neither csv nor a json table */ }
      }
      if (!table.length) throw new Error(`${data}: a race takes a CSV (first row of names, first cell the period) or a JSON list of { period, values }`);
      const names = [...new Set(table.flatMap(({ values }) => Object.keys(values ?? {})))];
      count = names.length;
      const best = new Map(names.map((n) => [n, Math.max(0, ...table.map(({ values }) => Number(values?.[n]) || 0))]));
      const keep = names.sort((x, y) => (best.get(y) ?? 0) - (best.get(x) ?? 0)).slice(0, Math.min(entries ?? cap, cap));
      const cut = names.length - keep.length;
      const filtered = table.map(({ period, values }) => ({ period, values: Object.fromEntries(keep.filter((n) => values?.[n] !== undefined).map((n) => [n, values[n]])) }));
      props = { table: filtered, entries: keep.length };
      if (cut) note = ` ${cut} of ${names.length} entries left out — the ${keep.length} that ever led race.`;
    } else if (kind === 'function') {
      const pts = (points ?? []).map(([x, y]) => [Number(x), Number(y)]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
      if (pts.length < 2) throw new Error('a function chart takes points: [[x, y], …] sampled from x = 0 to 1 (computed, never guessed)');
      props = { points: pts };
    } else if (kind === 'scatter') {
      // the points of the data set: [{ name, x, y }] or { points: [...] }
      let raw = null;
      try { raw = JSON.parse((await ctx.readText(a.src)) ?? 'null'); } catch { raw = null; }
      const list = (Array.isArray(raw) ? raw : raw?.points ?? []).filter((d) => d && Number.isFinite(Number(d.x)) && Number.isFinite(Number(d.y)));
      if (!list.length) throw new Error(`${data}: a scatter takes a list of { name, x, y }`);
      props = { values: list.map((d) => ({ name: String(d.name ?? d.label ?? ''), x: Number(d.x), y: Number(d.y), ...(Number.isFinite(Number(d.size)) ? { size: Number(d.size) } : {}) })) };
      count = list.length;
    } else props = { data };
    const size = kind === 'donut' ? [Math.round(u * 0.52), Math.round(u * 0.52)] : [Math.round(c.width * 0.76), Math.round(c.height * (portrait ? 0.38 : 0.5))];
    if (kind === 'race' || kind === 'scatter' || kind === 'function') { size[0] = Math.round(c.width * 0.8); size[1] = Math.round(c.height * (portrait ? 0.5 : 0.62)); }
    const taken = { ...c.layers };
    const base = `chart-${kind}-${data ?? 'curve'}`.replace(/[^a-z0-9-]/g, '-').slice(0, 60);
    let cid = base, k = 2;
    while (cid in taken) cid = `${base}-${k++}`;
    const ops = [], order = [...c.order];
    const accent = ctx.doc.tokens?.accent?.type === 'color';
    props.size = size;
    if (kind === 'bar' && orientation) props.orientation = orientation;
    if (kind !== 'donut' && accent) props.fill = '@accent';
    // a race runs over the composition: a period a second at least, the last one held
    if (kind === 'race' && props.table.length > 1) {
      const end = Math.max(1.6, Math.min(c.duration - 0.8, 0.4 + (props.table.length - 1) * Math.max(1, (c.duration - 1.2) / (props.table.length - 1))));
      props.progress = { $k: [{ t: 0.4, v: 0 }, { t: +end.toFixed(3), v: 1 }] };
      if ((end - 0.4) / (props.table.length - 1) < 1) note += ` The composition gives each period less than a second: lengthen it to ${Math.ceil(props.table.length + 1.2)} s.`;
    }
    ops.push({ op: 'add', path: `/compositions/${ctx.compId}/layers/${cid}`, value: { type: `chart.${kind}`, name: title ?? `${kind} chart`, transform: { position: [Math.round(c.width / 2), Math.round(c.height / 2)] }, props } });
    order.push(cid);
    if (title) {
      const tid = `${cid}-title`;
      ops.push({ op: 'add', path: `/compositions/${ctx.compId}/layers/${tid}`, value: { type: 'text', name: 'Chart title', in: 0, transform: { position: [c.width / 2, Math.round(c.height * (portrait ? 0.12 : 0.16))] }, props: { text: title, size: Math.round(u * 0.05), weight: 800, align: 'center', color: ctx.doc.tokens?.text?.type === 'color' ? '@text' : '#FFFFFF' } } });
      order.push(tid);
    }
    ops.push({ op: 'replace', path: `/compositions/${ctx.compId}/order`, value: order });
    return {
      ops, label: title ?? `${kind} chart`,
      text: `A ${kind} chart${count ? ` of ${count} entries` : ` of ${data}`} (${size[0]}×${size[1]})${title ? `, titled "${title}"` : ''}.${note} ${kind === 'race' ? `It runs on the layer's progress, keyed over the composition: the bars slide to their ranks, the period large behind.` : kind === 'function' ? 'The curve draws itself; the dot travels with the "at" property, a tangent on demand.' : ''} Edit the data in the inspector.`,
    };
  },
};

const chartCheck = {
  name: 'chart-readability', title: 'Chart readability',
  description: 'a chart with too many categories, labels too long for their bars, overlapping labels on a scatter, or more than 12 entries racing in 9:16, is a chart nobody reads',
  texts: ['{name}: {n} categories is a lot — group the small ones into "other"'],
  run(ctx) {
    const out = [];
    const portrait = ctx.comp.height > ctx.comp.width;
    const seen = new Set();
    for (const sample of ctx.samples) {
      for (const placed of sample.layers) {
        if (!placed.node.type.startsWith('chart.') || seen.has(placed.id)) continue;
        seen.add(placed.id);
        const values = Array.isArray(placed.props.values) ? placed.props.values : null;
        if (placed.node.type === 'chart.race') {
          const entries = Number(placed.props.entries) || 0;
          if (portrait && entries > 12) out.push({ check: 'chart-readability', severity: 'warning', message: `${name(placed)}: ${entries} entries racing in 9:16 — 12 at most, or the bars turn to lines` });
          const table = Array.isArray(placed.props.table) ? placed.props.table : [];
          const periods = table.length;
          if (periods && (placed.props.progress === undefined || placed.props.progress === 1) && periods > 1) out.push({ check: 'chart-readability', severity: 'info', t: sample.t, message: `${name(placed)}: the race shows its last period only — key the layer's progress over the composition to run it` });
          continue;
        }
        if (placed.node.type === 'chart.scatter') {
          const pts = (Array.isArray(placed.props.values) ? placed.props.values : (placed.props.values?.points ?? []));
          if (placed.props.labels !== false && pts.length > 1) {
            const close = [];
            for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
              if (Math.hypot((Number(pts[i].x) || 0) - (Number(pts[j].x) || 0), (Number(pts[i].y) || 0) - (Number(pts[j].y) || 0)) < Math.max(Number(placed.props.xMax) || 100, Number(placed.props.yMax) || 100) * 0.075) close.push([pts[i].name, pts[j].name]);
            }
            if (close.length) out.push({ check: 'chart-readability', severity: 'warning', message: `${name(placed)}: the labels of ${close.slice(0, 2).map((p) => p.join(' and ')).join(', ')} collide — label only the points the voice names` });
          }
          continue;
        }
        if (placed.props.data || !values) continue; // a data set: its shape is not in the document
        if (values.length > 9) out.push({ check: 'chart-readability', severity: 'warning', message: `${name(placed)}: ${values.length} categories is a lot — group the small ones into "other"` });
        const longest = values.reduce((a, d) => Math.max(a, String(d?.label ?? '').length), 0);
        const [w] = placed.props.size ?? [];
        if (longest > 16 && w && w / values.length < longest * 10) out.push({ check: 'chart-readability', severity: 'info', message: `${name(placed)}: the labels are long for their bars — shorten them or turn the chart` });
        if (values.every((d) => !(Number(d?.value) > 0))) out.push({ check: 'chart-readability', severity: 'info', message: `${name(placed)}: every value is 0 — the chart will draw nothing` });
      }
    }
    return out;
  },
};
const name = (placed) => placed.layer.name ?? placed.id;



// ── 1.1: the race, the scatter and the function ─────────────
const lerp = (a, b, u) => a + (b - a) * u;

/** a race's table from a CSV (first row of names, first cell the period) or a JSON list of { period, values } */
export function tableOf(raw) {
  if (Array.isArray(raw)) return raw.filter((r) => r && typeof r === 'object' && r.values);
  if (typeof raw !== 'string') return [];
  const rows = parseCsv(raw).filter((r) => r.some((f) => String(f).trim()));
  if (rows.length < 2) return [];
  const names = rows[0].slice(1).map((n) => String(n).trim());
  return rows.slice(1).map((r) => ({
    period: String(r[0] ?? '').trim(),
    values: Object.fromEntries(names.map((n, k) => [n, csvNumber(r[k + 1])]).filter(([, v]) => Number.isFinite(v))),
  }));
}

const raceNode = {
  type: 'chart.race', title: 'Race chart', category: 'Charts',
  ai: { when: 'a ranking over time (market shares, medals, populations): the bars slide to their new rank while the values roll; keep the leaders in view and let the tool cut the tail', avoid: 'more than 12 entries racing in 9:16 (20 at most in 16:9), a period on screen for less than a second, values so close the ranks swap every period' },
  props: {
    table: { type: 'json', default: [{ period: '2000', values: { Alpha: 30, Beta: 24, Gamma: 18 } }, { period: '2001', values: { Alpha: 34, Beta: 31, Gamma: 22, Delta: 12 } }, { period: '2002', values: { Alpha: 39, Beta: 38, Gamma: 27, Delta: 20 } }], label: 'Table', animatable: false, description: '[{ period, values: { name: value } }, …] — the chart tool builds it from a CSV' },
    progress: { type: 'number', default: 1, min: 0, max: 1, step: 0.001, label: 'Progress', description: '0: the first period; key it to run the race' },
    entries: { type: 'integer', default: 10, min: 3, max: 20, label: 'Entries', description: 'how many race at once (12 at most in 9:16)' },
    fill: { type: 'paint', default: '#2EC4B6', label: 'Bars' },
    ink: { type: 'paint', default: '@text', label: 'Text colour' },
    size: { type: 'vec2', default: [900, 560], label: 'Size', unit: 'px' },
    font: { type: 'asset', assetType: 'font', default: null, nullable: true, label: 'Font', animatable: false },
  },
  bounds: ({ size: [w, h] }) => ({ x: -w / 2, y: -h / 2, w, h }),
  path({ size: [w, h] }) { const s = new Path2D(); s.rect(-w / 2, -h / 2, w, h); return s; },
  render: {
    canvas2d(ctx, p, host) {
      const table = Array.isArray(p.table) ? p.table : [];
      if (table.length < 1) return;
      const [w, h] = p.size;
      if (w <= 0 || h <= 0) return;
      const u = Math.min(w, h);
      const ranks = ranksOver(table);
      const names = [...new Set(table.flatMap(({ values }) => Object.keys(values ?? {})))];
      const best = new Map(names.map((n) => [n, Math.max(0, ...table.map(({ values }) => Number(values?.[n]) || 0))]));
      const shown = names.sort((a, b) => (best.get(b) ?? 0) - (best.get(a) ?? 0)).slice(0, Math.max(3, p.entries ?? 10));
      const max = niceMax(Math.max(1, ...table.flatMap(({ values }) => Object.values(values ?? {}).map(Number))));
      const fu = Math.min(1, Math.max(0, p.progress)) * (table.length - 1);
      const k = Math.min(table.length - 2, Math.floor(fu)), blend = table.length < 2 ? 0 : fu - k;
      const valueAt = (n, i) => Number(table[Math.max(0, Math.min(table.length - 1, i))]?.values?.[n]) || 0;
      const rankAt = (n, i) => ranks[Math.max(0, Math.min(ranks.length - 1, i))]?.rank?.[n] ?? (shown.length + 1);
      const rows = shown.length, rowH = (h - u * 0.14) / rows;
      ctx.save();
      ctx.translate(-w / 2, -h / 2);
      // the period, large, behind the bars
      ctx.font = FONT(p, host, Math.round(u * 0.12), 800);
      ctx.fillStyle = p.ink; ctx.globalAlpha = 0.16;
      ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(String(table[Math.round(fu)]?.period ?? ''), w - u * 0.02, h - u * 0.03);
      ctx.globalAlpha = 1;
      ctx.font = FONT(p, host, Math.round(u * 0.034));
      ctx.textBaseline = 'alphabetic';
      const labelW = Math.min(w * 0.26, Math.max(...shown.map((n) => n.length), 4) * u * 0.021);
      const plotW = w - labelW - u * 0.14;
      shown.forEach((n, i) => {
        const v = lerp(valueAt(n, k), valueAt(n, k + 1), blend);
        const r0 = Math.min(rankAt(n, k), rows + 0.5), r1 = Math.min(rankAt(n, k + 1), rows + 0.5);
        const y = lerp((r0 - 1) * rowH, (r1 - 1) * rowH, blend) + rowH * 0.18;
        const bw = (v / max) * plotW;
        const lead = rankAt(n, blend > 0.5 ? k + 1 : k) === 1;
        ctx.fillStyle = lead ? p.fill : sliceColor(3, rows);
        ctx.globalAlpha = lead ? 1 : 0.78;
        ctx.beginPath(); ctx.roundRect(labelW, y, Math.max(1, bw), rowH * 0.64, Math.min(rowH * 0.32, u * 0.01)); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = p.ink; ctx.globalAlpha = 0.7;
        ctx.textAlign = 'right';
        ctx.fillText(n, labelW - u * 0.012, y + rowH * 0.58);
        ctx.globalAlpha = 1;
        ctx.textAlign = 'left';
        ctx.font = FONT(p, host, Math.round(u * 0.03), 800);
        ctx.fillText(fmt(v), labelW + bw + u * 0.012, y + rowH * 0.58);
        ctx.font = FONT(p, host, Math.round(u * 0.034));
      });
      ctx.restore();
    },
  },
};

const scatterNode = {
  type: 'chart.scatter', title: 'Scatter', category: 'Charts',
  ai: { when: 'two measures together (spend against reach, years against life): the points move between the periods and their trails tell where they came from; label only the points the voice names', avoid: 'more than 30 points, labels on every point (they collide — the check says so), a story the axes do not tell' },
  props: {
    values: { type: 'json', default: [{ name: 'Alpha', x: 20, y: 30 }, { name: 'Beta', x: 55, y: 62 }, { name: 'Gamma', x: 80, y: 40 }], label: 'Points', animatable: false, description: '[{ name, x, y, size? }]' },
    periods: { type: 'json', default: null, nullable: true, label: 'Over time', animatable: false, description: '[{ period, points: { name: { x, y } } }, …]: the points travel between the periods with the progress' },
    progress: { type: 'number', default: 1, min: 0, max: 1, step: 0.001, label: 'Progress', description: '0: the first period; key it to move the points' },
    labels: { type: 'bool', default: true, label: 'Labels', animatable: false },
    trails: { type: 'bool', default: true, label: 'Trails', animatable: false },
    fill: { type: 'paint', default: '#2EC4B6', label: 'Points' },
    ink: { type: 'paint', default: '@text', label: 'Text colour' },
    xMax: { type: 'number', default: 0, min: 0, label: 'X to', animatable: false, description: '0: the data\'s own maximum' },
    yMax: { type: 'number', default: 0, min: 0, label: 'Y to', animatable: false },
    size: { type: 'vec2', default: [900, 560], label: 'Size', unit: 'px' },
    font: { type: 'asset', assetType: 'font', default: null, nullable: true, label: 'Font', animatable: false },
  },
  bounds: ({ size: [w, h] }) => ({ x: -w / 2, y: -h / 2, w, h }),
  path({ size: [w, h] }) { const s = new Path2D(); s.rect(-w / 2, -h / 2, w, h); return s; },
  render: {
    canvas2d(ctx, p, host) {
      const [w, h] = p.size;
      if (w <= 0 || h <= 0) return;
      const u = Math.min(w, h);
      const axisW = u * 0.07, axisH = u * 0.07;
      const plotW = w - axisW * 1.2, plotH = h - axisH * 1.2;
      const raw = Array.isArray(p.values) ? { points: p.values } : (p.values ?? {});
      const periods = Array.isArray(p.periods) ? p.periods : null;
      const lastPoints = periods ? Object.values(periods[periods.length - 1]?.points ?? {}) : (raw.points ?? []);
      const xTop = p.xMax > 0 ? p.xMax : niceMax(Math.max(1, ...lastPoints.map((d) => Number(d?.x) || 0)));
      const yTop = p.yMax > 0 ? p.yMax : niceMax(Math.max(1, ...lastPoints.map((d) => Number(d?.y) || 0)));
      const X = (x) => axisW + (x / xTop) * plotW, Y = (y) => plotH - (y / yTop) * plotH + axisH * 0.2;
      ctx.save();
      ctx.translate(-w / 2, -h / 2);
      ctx.font = FONT(p, host, Math.round(u * 0.03));
      ctx.strokeStyle = 'rgba(128,128,128,0.3)'; ctx.lineWidth = 1;
      for (const t of ticks(0, xTop)) { ctx.beginPath(); ctx.moveTo(X(t), 0); ctx.lineTo(X(t), plotH + axisH * 0.2); ctx.stroke(); ctx.fillStyle = 'rgba(128,128,128,0.8)'; ctx.textAlign = 'center'; ctx.fillText(fmt(t), X(t), plotH + axisH * 0.55); }
      for (const t of ticks(0, yTop)) { ctx.beginPath(); ctx.moveTo(axisW, Y(t)); ctx.lineTo(w, Y(t)); ctx.stroke(); ctx.fillStyle = 'rgba(128,128,128,0.8)'; ctx.textAlign = 'right'; ctx.fillText(fmt(t), axisW - u * 0.008, Y(t) + u * 0.01); }
      const at = (frame, name) => frame?.points?.[name] ?? null;
      const fu = periods ? Math.min(1, Math.max(0, p.progress)) * (periods.length - 1) : 0;
      const k = Math.min(Math.max(0, (periods?.length ?? 1) - 2), Math.floor(fu)), blend = periods && periods.length > 1 ? fu - k : 0;
      const names = periods ? [...new Set(periods.flatMap(({ points }) => Object.keys(points ?? {})))] : (raw.points ?? []).map((d) => d.name);
      const drawn = [];
      names.forEach((n) => {
        let x, y, r = u * 0.014;
        if (periods) {
          const a = at(periods[Math.max(0, Math.min(periods.length - 1, k))], n), b = at(periods[Math.max(0, Math.min(periods.length - 1, k + 1))], n);
          if (!a && !b) return;
          x = lerp(Number(a?.x ?? b?.x) || 0, Number(b?.x ?? a?.x) || 0, blend);
          y = lerp(Number(a?.y ?? b?.y) || 0, Number(b?.y ?? a?.y) || 0, blend);
        } else {
          const d = (raw.points ?? []).find((q) => q.name === n);
          if (!d) return;
          x = Number(d.x) || 0; y = Number(d.y) || 0;
        }
        if (periods && p.trails) {
          for (let j = 0; j <= k; j++) {
            const t = at(periods[j], n);
            if (!t) continue;
            ctx.globalAlpha = 0.12 + 0.1 * (j / Math.max(1, k));
            ctx.fillStyle = p.fill;
            ctx.beginPath(); ctx.arc(X(Number(t.x) || 0), Y(Number(t.y) || 0), r * 0.7, 0, Math.PI * 2); ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = p.fill;
        ctx.beginPath(); ctx.arc(X(x), Y(y), r, 0, Math.PI * 2); ctx.fill();
        drawn.push({ name: n, x: X(x), y: Y(y) });
      });
      if (p.labels) {
        const sides = labelSides(drawn.map((d) => ({ x: d.x / w, y: d.y / h })));
        drawn.forEach((d, i) => {
          ctx.fillStyle = p.ink;
          ctx.textAlign = sides[i] > 0 ? 'left' : 'right';
          ctx.fillText(String(d.name), d.x + sides[i] * u * 0.018, d.y + u * 0.01);
        });
      }
      ctx.restore();
    },
  },
};

const functionNode = {
  type: 'chart.function', title: 'Function', category: 'Charts',
  ai: { when: 'a curve the tool sampled (the tool takes the points; the node never computes): a formula drawn on, a dot travelling along it, the area under it filling; the pack\'s ticks keep the axes readable', avoid: 'points the model invented without computing (a wrong curve is worse than none), more than two curves on one frame, a tangent nobody asked for' },
  props: {
    points: { type: 'json', default: [[0, 0], [0.25, 0.5], [0.5, 0.71], [0.75, 0.87], [1, 1]], label: 'Points', animatable: false, description: '[[x, y], …], sampled by the tool from x = 0 to 1' },
    drawFor: { type: 'number', default: 1.1, min: 0.2, unit: 's', label: 'Draw over', animatable: false },
    at: { type: 'number', default: 1, min: 0, max: 1, step: 0.001, label: 'Dot at', description: 'where the travelling dot stands (1: at the end); key it to travel' },
    tangent: { type: 'bool', default: false, label: 'Tangent', animatable: false },
    area: { type: 'bool', default: false, label: 'Area under', animatable: false },
    fill: { type: 'paint', default: '#2EC4B6', label: 'Curve' },
    size: { type: 'vec2', default: [900, 560], label: 'Size', unit: 'px' },
    font: { type: 'asset', assetType: 'font', default: null, nullable: true, label: 'Font', animatable: false },
  },
  bounds: ({ size: [w, h] }) => ({ x: -w / 2, y: -h / 2, w, h }),
  path({ size: [w, h] }) { const s = new Path2D(); s.rect(-w / 2, -h / 2, w, h); return s; },
  render: {
    canvas2d(ctx, p, host) {
      const pts = (Array.isArray(p.points) ? p.points : []).map(([x, y]) => [Number(x), Number(y)]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
      if (pts.length < 2) return;
      const [w, h] = p.size;
      if (w <= 0 || h <= 0) return;
      const u = Math.min(w, h);
      const axisW = u * 0.07, axisH = u * 0.07;
      const plotW = w - axisW * 1.2, plotH = h - axisH * 1.2;
      const xTop = niceMax(Math.max(1e-9, ...pts.map(([x]) => x)));
      const yTop = niceMax(Math.max(1e-9, ...pts.map(([, y]) => y)));
      const X = (x) => axisW + (x / xTop) * plotW, Y = (y) => plotH - (y / yTop) * plotH + axisH * 0.2;
      const t = host.t - (host.layerIn ?? 0);
      const revealed = Math.min(1, Math.max(0, t) / Math.max(0.001, p.drawFor));
      ctx.save();
      ctx.translate(-w / 2, -h / 2);
      ctx.font = FONT(p, host, Math.round(u * 0.03));
      for (const v of ticks(0, xTop)) { ctx.strokeStyle = 'rgba(128,128,128,0.25)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(v), 0); ctx.lineTo(X(v), plotH + axisH * 0.2); ctx.stroke(); ctx.fillStyle = 'rgba(128,128,128,0.8)'; ctx.textAlign = 'center'; ctx.fillText(fmt(v), X(v), plotH + axisH * 0.55); }
      for (const v of ticks(0, yTop)) { ctx.strokeStyle = 'rgba(128,128,128,0.25)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(axisW, Y(v)); ctx.lineTo(w, Y(v)); ctx.stroke(); ctx.fillStyle = 'rgba(128,128,128,0.8)'; ctx.textAlign = 'right'; ctx.fillText(fmt(v), axisW - u * 0.008, Y(v) + u * 0.01); }
      const xy = pts.map(([x, y]) => [X(x), Y(y)]);
      const trace = () => {
        ctx.beginPath();
        ctx.moveTo(xy[0][0], xy[0][1]);
        for (let i = 1; i < xy.length; i++) { const mx = (xy[i - 1][0] + xy[i][0]) / 2, my = (xy[i - 1][1] + xy[i][1]) / 2; ctx.quadraticCurveTo(xy[i - 1][0], xy[i - 1][1], mx, my); }
        ctx.lineTo(xy[xy.length - 1][0], xy[xy.length - 1][1]);
      };
      if (p.area) {
        trace();
        ctx.lineTo(xy[xy.length - 1][0], plotH + axisH * 0.2); ctx.lineTo(xy[0][0], plotH + axisH * 0.2); ctx.closePath();
        ctx.globalAlpha = 0.14; ctx.fillStyle = p.fill; ctx.fill(); ctx.globalAlpha = 1;
      }
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, axisW + plotW * revealed, h); ctx.clip();
      trace();
      ctx.strokeStyle = p.fill; ctx.lineWidth = Math.max(2, u * 0.008); ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
      ctx.restore();
      const at = Math.min(1, Math.max(0, p.at));
      const flat = xy.length - 1, fi = Math.min(flat - 1, Math.floor(at * flat)), fu = at * flat - fi;
      const dx = xy[fi + 1][0] - xy[fi][0], dy = xy[fi + 1][1] - xy[fi][1];
      const px = xy[fi][0] + dx * fu, py = xy[fi][1] + dy * fu;
      if (p.tangent && revealed >= at) {
        const len = Math.hypot(dx, dy) || 1, half = u * 0.09;
        ctx.strokeStyle = p.fill; ctx.globalAlpha = 0.55; ctx.lineWidth = Math.max(1.5, u * 0.005);
        ctx.beginPath(); ctx.moveTo(px - (dx / len) * half, py - (dy / len) * half); ctx.lineTo(px + (dx / len) * half, py + (dy / len) * half); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (revealed >= at) { ctx.fillStyle = p.fill; ctx.beginPath(); ctx.arc(px, py, Math.max(3, u * 0.013), 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    },
  },
};

export const meta = { id: 'tramme/charts', name: 'charts', version: '1.1.0', description: 'Bar, line, donut, race, scatter and function charts from a data set, with a layout tool and a readability check', api: 1 };
export const nodes = [barNode, lineNode, donutNode, raceNode, scatterNode, functionNode];
export const tools = [chartTool];
export const checks = [chartCheck];
export const presets = [
  { name: 'chart-bar', title: 'Bar chart', category: 'Charts', description: 'four quarters, on the accent', layer: { type: 'chart.bar', name: 'Bar chart', props: { size: [900, 500] } } },
  { name: 'chart-donut', title: 'Donut chart', category: 'Charts', description: 'four shares with their percents', layer: { type: 'chart.donut', name: 'Donut chart', props: { size: [520, 520] } } },
];
export const messages = {
  fr: {
    "Kind": "Type",
    "Title": "Titre",
    "a line above the chart, when the chart needs one": "une ligne au-dessus du graphique, quand il en a besoin",
    "Bar orientation": "Orientation des barres",
    'Bar chart': 'Histogramme', 'Line chart': 'Courbe', 'Donut chart': 'Anneau', 'Race chart': 'Course', 'Scatter': 'Nuage', 'Function': 'Fonction',
    'Bars': 'Barres', 'Values': 'Valeurs', 'Orientation': 'Orientation', 'Scale to': 'Échelle jusqu\'à',
    'Grid': 'Grille', 'Label size': 'Corps des étiquettes', 'Size': 'Taille', 'Font': 'Police',
    'Curve': 'Courbure', 'Fill under': 'Remplir dessous', 'Dots': 'Points', 'Draw over': 'Tracé en', 'Text colour': 'Couleur du texte',
    'Thickness': 'Épaisseur', 'Centre text': 'Texte central', 'Percents': 'Pourcentages',
    'Data set': 'Jeu de données', 'Chart title': 'Titre du graphique', 'Add a chart': 'Ajouter un graphique',
    'Progress': 'Progression', 'Table': 'Table', 'Entries': 'Concurrents', 'Points': 'Points', 'Over time': 'Dans le temps', 'Labels': 'Étiquettes', 'Trails': 'Traînées',
    'X to': 'X jusqu’à', 'Y to': 'Y jusqu’à', 'Draw over': 'Tracé en', 'Text colour': 'Couleur du texte', 'Dot at': 'Point à', 'Tangent': 'Tangente', 'Area under': 'Aire dessous',
    '0: the first period; key it to run the race': '0 : la première période ; keyframez-le pour lancer la course',
    'how many race at once (12 at most in 9:16)': 'combien courent en même temps (12 au plus en 9:16)',
    '[{ period, values: { name: value } }, …] — the chart tool builds it from a CSV': '[{ period, values: { name: valeur } }, …] — l’outil graphique le construit depuis un CSV',
    '[{ name, x, y, size? }]': '[{ name, x, y, taille ? }]',
    '[{ period, points: { name: { x, y } } }, …]: the points travel between the periods with the progress': '[{ period, points: { name: { x, y } } }, …] : les points voyagent entre les périodes avec la progression',
    '0: the first period; key it to move the points': '0 : la première période ; keyframez-le pour faire bouger les points',
    'where the travelling dot stands (1: at the end); key it to travel': 'où tient le point voyageur (1 : à la fin) ; keyframez-le pour le faire voyager',
    '[[x, y], …], sampled by the tool from x = 0 to 1': '[[x, y], …], échantillonné par l’outil de x = 0 à 1',
    '0: the data\'s own maximum': '0 : le maximum des données',
    'a ranking over time (market shares, medals, populations): the bars slide to their new rank while the values roll; keep the leaders in view and let the tool cut the tail': 'un classement dans le temps (parts de marché, médailles, populations) : les barres glissent vers leur rang tandis que les valeurs défilent ; gardez les leaders en vue et laissez l’outil couper la queue',
    'more than 12 entries racing in 9:16 (20 at most in 16:9), a period on screen for less than a second, values so close the ranks swap every period': 'plus de 12 concurrents en 9:16 (20 au plus en 16:9), une période à l’écran moins d’une seconde, des valeurs si proches que les rangs s’échangent à chaque période',
    'two measures together (spend against reach, years against life): the points move between the periods and their trails tell where they came from; label only the points the voice names': 'deux mesures ensemble (dépense contre portée, années contre vie) : les points voyagent entre les périodes et leurs traînées disent d’où ils viennent ; n’étiquetez que les points que la voix nomme',
    'more than 30 points, labels on every point (they collide — the check says so), a story the axes do not tell': 'plus de 30 points, des étiquettes sur chaque point (elles se heurtent — la vérification le dit), une histoire que les axes ne racontent pas',
    'a curve the tool sampled (the tool takes the points; the node never computes): a formula drawn on, a dot travelling along it, the area under it filling; the pack\'s ticks keep the axes readable': 'une courbe échantillonnée par l’outil (l’outil prend les points ; le nœud ne calcule jamais) : une formule qui se trace, un point qui voyage le long, l’aire dessous qui se remplit ; les graduations du pack gardent les axes lisibles',
    'points the model invented without computing (a wrong curve is worse than none), more than two curves on one frame, a tangent nobody asked for': 'des points inventés sans calcul (une courbe fausse est pire que pas de courbe), plus de deux courbes sur une image, une tangente que personne ne demande',
    'a bar, line, donut, race, scatter or function chart from a JSON data set of the project or from a CSV (separators, quotes and decimal commas read), sized and placed in the composition, with an optional title above it': 'un histogramme, une courbe, un anneau, une course, un nuage ou une fonction depuis un jeu de données JSON du projet ou depuis un CSV (séparateurs, guillemets et virgules décimales lus), dimensionné et placé dans la composition, avec un titre optionnel au-dessus',
    'bar by default; a race takes a table of periods by entries, a function the sampled points': 'histogramme par défaut ; une course prend une table de périodes par concurrents, une fonction les points échantillonnés',
    'a function only: [[x, y], …] sampled from x = 0 to 1 — computed, never guessed': 'pour une fonction : [[x, y], …] échantillonné de x = 0 à 1 — calculé, jamais deviné',
    'a race only: how many race at once (12 at most in 9:16, 20 in 16:9)': 'pour une course : combien courent en même temps (12 au plus en 9:16, 20 en 16:9)',
    'a chart with too many categories, labels too long for their bars, overlapping labels on a scatter, or more than 12 entries racing in 9:16, is a chart nobody reads': 'un graphique à trop de catégories, aux libellés trop longs pour ses barres, aux étiquettes qui se chevauchent sur un nuage, ou à plus de 12 concurrents en 9:16, est un graphique que personne ne lit',
    'a value over time (a price, an audience, a temperature): a rise or a fall is the story, so crop the scale to it and let the line draw itself': 'une valeur dans le temps (un cours, une audience, une température) : la hausse ou la baisse est l\'histoire — resserrez l\'échelle sur elle et laissez la courbe se tracer',
    'a JSON file of the project: a list of { label, value } (or { series: […] }); empty: the values below': 'un fichier JSON du projet : une liste de { label, value } (ou { series: […] }); vide : les valeurs ci-dessous',
    '[{ label, value }, …] used when there is no data set': '[{ label, value }, …] utilisées quand il n\'y a pas de jeu de données',
    '0: the data\'s own maximum, rounded to a readable grid': '0 : le maximum des données, arrondi à une grille lisible',
    '0: from the chart\'s size': '0 : selon la taille du graphique',
    'numbers only, left to right; the labels of a line chart are written as text layers': 'nombres seulement, de gauche à droite ; les libellés d\'une courbe s\'écrivent en calques de texte',
    'Line': 'Courbe',
    '[{ label, value }, …]': '[{ label, value }, …]',
    'of the radius': 'du rayon',
    'a bar, line or donut chart from a JSON data set of the project (a list of { label, value }), sized and placed in the composition, with an optional title above it': 'un histogramme, une courbe ou un anneau depuis un jeu de données JSON du projet (une liste de { label, value }), dimensionné et placé dans la composition, avec un titre optionnel au-dessus',
    'Chart readability': 'Lisibilité d\'un graphique',
    'a chart with too many categories, or labels too long for their bars, is a chart nobody reads': 'un graphique à trop de catégories, ou aux libellés trop longs pour ses barres, est un graphique que personne ne lit',
    'four quarters, on the accent': 'quatre trimestres, sur l\'accent',
    'four shares with their percents': 'quatre parts avec leurs pourcentages',
  },
};
