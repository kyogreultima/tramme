// Audiograms: the sound of a podcast or an interview as a clip — the cover,
// the name, the wave moving with the voice, a progress bar. The wave reads
// the analysis' 32 log bands (the beats tool computes them at authoring
// time), a pure function of t; the tool lays the clip out for the format.

/** the band bars of a moment: `count` values, linear between the two frames around t (bands sampled at `rate` a second) */
export function barsAt(bands, rate, t, count) {
  const list = Array.isArray(bands) ? bands : [];
  const B = list.length;
  if (!B) return new Array(count ?? 32).fill(0);
  const frames = list[0].length ?? 0;
  const f = Math.max(0, Math.min(frames - 1, t * (rate || 12.5)));
  const i0 = Math.floor(f), i1 = Math.min(frames - 1, i0 + 1), u = f - i0;
  const n = Math.max(1, Math.min(B, count ?? B));
  const out = [];
  for (let k = 0; k < n; k++) {
    // the bars walk the bands from the top down, evenly spread
    const b = B === n ? k : Math.round((k / (n - 1 || 1)) * (B - 1));
    const a = list[b]?.[i0] ?? 0, c = list[b]?.[i1] ?? 0;
    out.push(a + (c - a) * u);
  }
  return out;
}

const wave = {
  type: 'audiogram.wave', title: 'Wave', category: 'Audiogram',
  description: 'the sound of an analysis as bars, a mirrored wave, a line or a ring, moving with the voice, a playhead crossing it',
  ai: { when: 'the sound made visible on an audiogram: under the speaker\'s picture, around a quote, at the foot of the clip; the bars read the analysis\' bands, so they follow the voice', avoid: 'a wave on screen without its sound playing, more than one wave on a frame, a ring around nothing (it wants a picture or a name in the middle)' },
  props: {
    analysis: { type: 'asset', assetType: 'json', default: null, nullable: true, label: 'Analysis', animatable: false, description: 'the analysis of the sound (the beats tool writes it, bands included)' },
    style: { type: 'enum', default: 'mirror', options: ['bars', 'mirror', 'line', 'ring'], label: 'Style', animatable: false },
    count: { type: 'integer', default: 48, min: 8, max: 96, label: 'Bars', animatable: false },
    fill: { type: 'paint', default: '@accent', label: 'Wave' },
    ink: { type: 'paint', default: '@text', label: 'Playhead' },
    progress: { type: 'number', default: 1, min: 0, max: 1, step: 0.001, label: 'Progress', description: 'the playhead\'s walk over the clip; 1 holds it at the end' },
    size: { type: 'vec2', default: [900, 240], label: 'Size', unit: 'px' },
    font: { type: 'asset', assetType: 'font', default: null, nullable: true, label: 'Font', animatable: false },
  },
  bounds: ({ size: [w, h] }) => ({ x: -w / 2, y: -h / 2, w, h }),
  render: {
    canvas2d(ctx, p, host) {
      const [w, h] = p.size;
      if (w <= 0 || h <= 0) return;
      let analysis = null;
      try { analysis = p.analysis ? host.asset(p.analysis) : null; } catch { analysis = null; }
      const bands = analysis?.bands, rate = (analysis?.rate ?? 50) / 4;
      const duration = analysis?.duration ?? 1;
      const u = Math.min(w, h);
      const n = p.count ?? 48;
      // the bars around the playhead's time: the window the clip shows walks with the progress
      const t = Math.max(0, Math.min(duration - 0.01, p.progress * duration));
      const bars = bands ? barsAt(bands, rate, t, n) : new Array(n).fill(0);
      ctx.fillStyle = p.fill;
      const drawBar = (k, x, bw, hgt) => {
        ctx.beginPath(); ctx.roundRect(x, hgt, bw, Math.max(1.5, Math.min(h, Math.abs(hgt))), Math.min(bw / 2, 3)); ctx.fill();
      };
      if (p.style === 'line') {
        ctx.strokeStyle = p.fill;
        ctx.lineWidth = Math.max(2, u * 0.012);
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.beginPath();
        bars.forEach((v, k) => { const x = (k / (n - 1 || 1)) * w - w / 2, y = h / 2 - (v - 0.5) * h * 0.86; if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
        ctx.stroke();
      } else if (p.style === 'ring') {
        const r = Math.min(w, h) / 2 - u * 0.06;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 - Math.PI / 2;
          const len = u * 0.04 + bars[k] * u * 0.16;
          ctx.strokeStyle = p.fill;
          ctx.lineWidth = Math.max(2, (2 * Math.PI * r) / n * 0.55);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
          ctx.lineTo(Math.cos(a) * (r + len), Math.sin(a) * (r + len));
          ctx.stroke();
        }
      } else {
        const bw = (w / n) * 0.62, gap = (w / n) * 0.38;
        for (let k = 0; k < n; k++) {
          const v = Math.max(0.02, bars[k]);
          const x = -w / 2 + k * (bw + gap);
          if (p.style === 'mirror') {
            const half = (v * h) / 2;
            ctx.beginPath(); ctx.roundRect(x, h / 2 - half, bw, half * 2, Math.min(bw / 2, 3)); ctx.fill();
          } else {
            drawBar(k, x, bw, h - v * h * 0.92);
          }
        }
      }
      // the playhead
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = Math.max(2, u * 0.008);
      ctx.beginPath();
      if (p.style === 'ring') { const r = Math.min(w, h) / 2 - u * 0.02; ctx.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.progress); ctx.stroke(); }
      else { const x = -w / 2 + w * p.progress; ctx.moveTo(x, -h / 2); ctx.lineTo(x, h / 2); ctx.stroke(); }
    },
  },
};

const audiogram = {
  name: 'audiogram', title: 'Make an audiogram',
  description: 'an extract of a podcast or an interview as a clip: the cover, the name, the wave moving with the voice, a progress bar — laid out for the format',
  input: {
    type: 'object',
    properties: {
      asset: { type: 'string', format: 'asset', assetType: ['audio', 'video'], title: 'Sound' },
      name: { type: 'string', title: 'Name', description: 'the show or the episode, over the wave' },
      cover: { type: 'string', format: 'asset', assetType: 'image', title: 'Cover', description: 'the picture behind the wave' },
      style: { enum: ['bars', 'mirror', 'line', 'ring'], title: 'Wave', description: 'mirror by default' },
      at: { type: 'number', title: 'From', description: 'the extract\'s start in the sound (0 by default)' },
      duration: { type: 'number', title: 'Seconds', description: 'the extract\'s length (30 s by default)' },
    },
    required: ['asset'],
  },
  ai: { when: 'a podcast extract for the feeds: the cover behind, the show\'s name, the wave moving with the voice; the analysis asset carries the bands, so the wave follows the sound', avoid: 'a wave without its analysis (run the beats tool first), a clip longer than a minute, the wave over busy art (it disappears)' },
  async run({ asset: wanted, name, cover, style = 'mirror', at = 0, duration = 30 }, ctx) {
    const comp = ctx.doc.compositions[ctx.compId];
    const media = wanted && ctx.doc.assets[wanted]?.type.match(/audio|video/) ? wanted : Object.entries(ctx.doc.assets).find(([, x]) => x.type === 'audio')?.[0];
    if (!media) throw new Error('the project needs the sound as an asset');
    // the analysis of the sound, bands included (the beats tool writes it)
    const analysisId = `analysis-${media}`;
    const analysisSrc = ctx.doc.assets[analysisId]?.src;
    let analysis = null;
    if (analysisSrc) { try { analysis = JSON.parse((await ctx.readText(analysisSrc)) ?? 'null'); } catch { analysis = null; } }
    if (!analysis || !analysis.bands) throw new Error(`the analysis of "${media}" has no bands — run the beats tool (use_tool "beats") on it first, then this`);
    const a = ctx.doc.assets[media], c = ctx.doc.assets[cover];
    const portrait = comp.height > comp.width;
    const [w, h] = portrait ? [1080, 1920] : [1920, 1080];
    const u = Math.min(w, h);
    const dur = Math.max(3, Math.min(duration, analysis.duration - at));
    const fps = comp.fps ?? 30;
    const layers = {}, order = [];
    const colorOf = (t, fallback) => (ctx.doc.tokens?.[t]?.type === 'color' ? `@${t}` : fallback);
    // the cover fills the frame, a plate under the text
    if (c) {
      layers.cover = { type: 'image', name: 'Cover', in: 0, out: dur, transform: { position: [w / 2, h / 2] }, props: { image: cover, size: [w, h], fit: 'cover' } };
      order.push('cover');
      layers.shade = { type: 'shape.rect', name: 'Shade', in: 0, out: dur, transform: { position: [w / 2, h / 2] }, props: { size: [w, h], fill: colorOf('plate', '#0E1420'), opacity: 0.42 } };
      order.push('shade');
    }
    if (name) {
      layers.name = { type: 'text', name: 'Name', in: 0, out: dur, transform: { position: [Math.round(w * 0.08), Math.round(h * (portrait ? 0.12 : 0.16))] }, props: { text: name, size: Math.round(u * 0.052), weight: 800, color: colorOf('text', '#F4F5F7') } };
      order.push('name');
    }
    layers.wave = {
      type: 'audiogram.wave', name: 'Wave', in: 0, out: dur,
      transform: { position: [Math.round(w / 2), Math.round(h * (portrait ? 0.82 : 0.84))] },
      props: { analysis: analysisId, style, count: portrait ? 64 : 72, fill: colorOf('accent', '#2EC4B6'), size: [Math.round(w * 0.84), Math.round(u * 0.24)], progress: { $k: [{ t: 0, v: 0 }, { t: dur, v: 1 }] } },
    };
    order.push('wave');
    // the progress bar, the trim drawing itself across the composition
    layers.bar = {
      type: 'shape.rect', name: 'Progress', in: 0, out: dur,
      transform: { position: [Math.round(w / 2), Math.round(h * (portrait ? 0.94 : 0.93))] },
      props: { size: [Math.round(w * 0.84), Math.max(4, Math.round(u * 0.006))], fill: colorOf('text', '#F4F5F7'), trimEnd: { $k: [{ t: 0, v: 0 }, { t: dur, v: 1 }] } },
    };
    order.push('bar');
    const sound = { type: 'audio', name: a.name ?? media, in: 0, out: dur, props: { audio: media, start: at } };
    layers.sound = sound;
    order.push('sound');
    const ops = [{ op: 'add', path: `/compositions/audiogram-${Date.now().toString(36)}`, value: { name: name ? `Audiogram · ${name}` : 'Audiogram', width: w, height: h, fps, duration: dur, background: colorOf('background', '#0E0F12'), layers, order } }];
    return {
      ops, label: name ? `Audiogram · ${name}` : 'Audiogram',
      text: `The clip runs ${dur.toFixed(1)} s of "${a.name ?? media}" from ${at} s${c ? ', the cover behind' : ''}${name ? `, named "${name}"` : ''}: the wave reads the analysis' bands (32, log-spaced), the playhead walks with the progress, the bar below trims itself across. ${portrait ? '9:16, ready for the feeds' : '16:9'} — the sound plays from its start; move "at" in the audio layer for another moment.`,
    };
  },
};

export const meta = { id: 'tramme/audiogram', name: 'audiogram', version: '1.0.0', description: 'Audiograms: the wave of a sound moving with the voice, a cover, a name, a progress bar — a clip for the feeds', api: 1 };
export const nodes = [wave];
export const tools = [audiogram];
export const messages = {
  fr: {
    'Wave': 'Onde', 'Make an audiogram': 'Faire un audiogramme',
    'Analysis': 'Analyse', 'Style': 'Style', 'Bars': 'Barres', 'Playhead': 'Tête de lecture', 'Progress': 'Progression', 'Size': 'Taille', 'Font': 'Police',
    'Sound': 'Son', 'Name': 'Nom', 'Cover': 'Pochette', 'From': 'Depuis', 'Seconds': 'Secondes',
    'the analysis of the sound (the beats tool writes it, bands included)': 'l’analyse du son (l’outil beats l’écrit, bandes comprises)',
    'the playhead\'s walk over the clip; 1 holds it at the end': 'la marche de la tête de lecture sur l’extrait ; 1 la tient à la fin',
    'the sound of an analysis as bars, a mirrored wave, a line or a ring, moving with the voice, a playhead crossing it': 'le son d’une analyse en barres, onde en miroir, ligne ou anneau, qui bouge avec la voix, une tête de lecture qui le traverse',
    'the sound made visible on an audiogram: under the speaker\'s picture, around a quote, at the foot of the clip; the bars read the analysis\' bands, so they follow the voice': 'le son rendu visible sur un audiogramme : sous la photo de l’intervenant, autour d’une citation, au pied de l’extrait ; les barres lisent les bandes de l’analyse, elles suivent la voix',
    'a wave on screen without its sound playing, more than one wave on a frame, a ring around nothing (it wants a picture or a name in the middle)': 'une onde à l’écran sans son son joué, plus d’une onde par image, un anneau autour de rien (il veut une image ou un nom au milieu)',
    'an extract of a podcast or an interview as a clip: the cover, the name, the wave moving with the voice, a progress bar — laid out for the format': 'un extrait de podcast ou d’entretien en clip : la pochette, le nom, l’onde qui bouge avec la voix, une barre de progression — disposé pour le format',
    'the show or the episode, over the wave': 'l’émission ou l’épisode, au-dessus de l’onde',
    'the picture behind the wave': 'l’image derrière l’onde',
    'the extract\'s start in the sound (0 by default)': 'le début de l’extrait dans le son (0 par défaut)',
    'the extract\'s length (30 s by default)': 'la longueur de l’extrait (30 s par défaut)',
    'a podcast extract for the feeds: the cover behind, the show\'s name, the wave moving with the voice; the analysis asset carries the bands, so the wave follows the sound': 'un extrait de podcast pour les plateformes : la pochette derrière, le nom de l’émission, l’onde qui bouge avec la voix ; l’asset d’analyse porte les bandes, l’onde suit le son',
    'a wave without its analysis (run the beats tool first), a clip longer than a minute, the wave over busy art (it disappears)': 'une onde sans son analyse (passez d’abord l’outil beats), un clip de plus d’une minute, l’onde sur une image chargée (elle disparaît)',
  },
};
