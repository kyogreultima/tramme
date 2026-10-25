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

const chartTool = {
  name: 'chart', title: 'Add a chart',
  description: 'a bar, line or donut chart from a JSON data set of the project (a list of { label, value }), sized and placed in the composition, with an optional title above it',
  input: {
    type: 'object',
    properties: {
      data: { type: 'string', format: 'asset', assetType: 'json', title: 'Data set' },
      kind: { enum: ['bar', 'line', 'donut'], title: 'Kind', description: 'bar by default' },
      title: { type: 'string', title: 'Title', description: 'a line above the chart, when the chart needs one' },
      orientation: { enum: ['vertical', 'horizontal'], title: 'Bar orientation' },
    },
    required: ['data'],
  },
  async run({ data, kind = 'bar', title, orientation }, ctx) {
    const a = ctx.doc.assets[data];
    if (!a || a.type !== 'json') throw new Error(`${data}: a JSON asset of the project is expected (a list of { label, value })`);
    const c = ctx.doc.compositions[ctx.compId];
    const u = Math.min(c.width, c.height);
    const size = kind === 'donut' ? [Math.round(u * 0.52), Math.round(u * 0.52)] : [Math.round(c.width * 0.76), Math.round(c.height * (c.height > c.width ? 0.38 : 0.5))];
    const taken = { ...c.layers };
    const base = `chart-${kind}-${data}`.replace(/[^a-z0-9-]/g, '-').slice(0, 60);
    let cid = base, k = 2;
    while (cid in taken) cid = `${base}-${k++}`;
    const ops = [], order = [...c.order];
    const accent = ctx.doc.tokens?.accent?.type === 'color';
    const props = { data, size };
    if (kind === 'bar' && orientation) props.orientation = orientation;
    if (kind !== 'donut' && accent) props.fill = '@accent';
    ops.push({ op: 'add', path: `/compositions/${ctx.compId}/layers/${cid}`, value: { type: `chart.${kind}`, name: title ?? `${kind} chart`, props } });
    order.push(cid);
    if (title) {
      const tid = `${cid}-title`;
      ops.push({ op: 'add', path: `/compositions/${ctx.compId}/layers/${tid}`, value: { type: 'text', name: 'Chart title', in: 0, transform: { position: [c.width / 2, Math.round(c.height * (c.height > c.width ? 0.12 : 0.16))] }, props: { text: title, size: Math.round(u * 0.05), weight: 800, align: 'center', color: '#FFFFFF' } } });
      order.push(tid);
    }
    ops.push({ op: 'replace', path: `/compositions/${ctx.compId}/order`, value: order });
    return {
      ops, label: title ?? `${kind} chart`,
      text: `A ${kind} chart of ${data} (${size[0]}×${size[1]})${title ? `, titled "${title}"` : ''}. It draws itself over about a second; edit the data set or the inline values in the inspector. When the composition has no data set yet, write one with write_file (a list of { label, value }) and add it first.`,
    };
  },
};

const chartCheck = {
  name: 'chart-readability', title: 'Chart readability',
  description: 'a chart with too many categories, or labels too long for their bars, is a chart nobody reads',
  texts: ['{name}: {n} categories is a lot — group the small ones into "other"'],
  run(ctx) {
    const out = [];
    const seen = new Set();
    for (const sample of ctx.samples) {
      for (const placed of sample.layers) {
        if (!placed.node.type.startsWith('chart.') || seen.has(placed.id)) continue;
        seen.add(placed.id);
        const values = Array.isArray(placed.props.values) ? placed.props.values : null;
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

export const meta = { id: 'tramme/charts', name: 'charts', version: '1.0.0', description: 'Bar, line and donut charts from a data set, with a layout tool and a readability check', api: 1 };
export const nodes = [barNode, lineNode, donutNode];
export const tools = [chartTool];
export const checks = [chartCheck];
export const presets = [
  { name: 'chart-bar', title: 'Bar chart', category: 'Charts', description: 'four quarters, on the accent', layer: { type: 'chart.bar', name: 'Bar chart', props: { size: [900, 500] } } },
  { name: 'chart-donut', title: 'Donut chart', category: 'Charts', description: 'four shares with their percents', layer: { type: 'chart.donut', name: 'Donut chart', props: { size: [520, 520] } } },
];
export const messages = {
  fr: {
    'Bar chart': 'Histogramme', 'Line chart': 'Courbe', 'Donut chart': 'Anneau',
    'Bars': 'Barres', 'Values': 'Valeurs', 'Orientation': 'Orientation', 'Scale to': 'Échelle jusqu\'à',
    'Grid': 'Grille', 'Label size': 'Corps des étiquettes', 'Size': 'Taille', 'Font': 'Police',
    'Curve': 'Courbure', 'Fill under': 'Remplir dessous', 'Dots': 'Points', 'Draw over': 'Tracé en',
    'Thickness': 'Épaisseur', 'Centre text': 'Texte central', 'Percents': 'Pourcentages',
    'Data set': 'Jeu de données', 'Chart title': 'Titre du graphique', 'Add a chart': 'Ajouter un graphique',
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
