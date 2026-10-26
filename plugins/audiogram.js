// Audiograms: the sound of a podcast or an interview as a clip — the cover,
// the name, the wave moving with the voice, the words said, a progress bar.
// The wave reads the analysis' 32 log bands (the beats tool computes them at
// authoring time), a pure function of t with a meter's rise and decay; the
// tool lays the clip out for the format, varied by the seed.

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

/** the meter's fall: what was loud a moment ago still shows, decaying over `decay` seconds */
const DECAY = 0.35;

/**
 * The bars a meter shows at t: they rise at once with the sound and fall back
 * slowly (each bar the loudest of the last `decay` seconds, faded by its age).
 * A pure function of t — the same frame alone or after the others.
 */
export function meterAt(bands, rate, t, count, decay = DECAY) {
  const now = barsAt(bands, rate, t, count);
  const steps = 6;
  for (let s = 1; s <= steps; s++) {
    const age = (decay * s) / steps;
    if (t - age < 0) break;
    const fade = 1 - age / decay;
    const past = barsAt(bands, rate, t - age, count);
    for (let k = 0; k < now.length; k++) now[k] = Math.max(now[k], past[k] * fade);
  }
  return now;
}

/** the moment of the sound the wave shows: the extract's start, walked over its length by the progress */
export function soundTime(p, duration) {
  const from = Math.max(0, Number(p.from) || 0);
  const span = Number(p.span) > 0 ? Number(p.span) : Math.max(0, duration - from);
  return Math.max(0, Math.min(Math.max(0, duration - 0.01), from + Math.min(1, Math.max(0, p.progress ?? 1)) * span));
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
    from: { type: 'number', default: 0, min: 0, step: 0.01, unit: 's', label: 'From', animatable: false, description: 'the extract\'s start in the sound' },
    span: { type: 'number', default: 0, min: 0, step: 0.01, unit: 's', label: 'Length', animatable: false, description: 'the extract\'s length; 0: to the end of the sound' },
    progress: { type: 'number', default: 1, min: 0, max: 1, step: 0.001, label: 'Progress', description: 'the playhead\'s walk over the extract, in step with its sound; 1 holds it at the end' },
    size: { type: 'vec2', default: [900, 240], label: 'Size', unit: 'px' },
  },
  bounds: ({ size: [w, h] }) => ({ x: -w / 2, y: -h / 2, w, h }),
  render: {
    canvas2d(ctx, p, host) {
      const [w, h] = p.size;
      if (w <= 0 || h <= 0) return;
      let analysis = null;
      try { analysis = p.analysis ? host.asset(p.analysis) : null; } catch { analysis = null; }
      const bands = analysis?.bands, rate = analysis?.bandsRate ?? (analysis?.rate ?? 50) / 4;
      const duration = analysis?.duration ?? 1;
      const u = Math.min(w, h);
      const n = p.count ?? 48;
      const bars = bands ? meterAt(bands, rate, soundTime(p, duration), n) : new Array(n).fill(0);
      const progress = Math.min(1, Math.max(0, p.progress ?? 1));
      ctx.fillStyle = p.fill;
      if (p.style === 'line') {
        ctx.strokeStyle = p.fill;
        ctx.lineWidth = Math.max(2, u * 0.012);
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.beginPath();
        bars.forEach((v, k) => { const x = (k / (n - 1 || 1)) * w - w / 2, y = h / 2 - Math.min(1, v) * h * 0.92 - h * 0.04; if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
        ctx.stroke();
      } else if (p.style === 'ring') {
        const r = Math.min(w, h) / 2 - u * 0.22;
        ctx.strokeStyle = p.fill;
        ctx.lineWidth = Math.max(2, ((2 * Math.PI * r) / n) * 0.55);
        ctx.lineCap = 'round';
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 - Math.PI / 2;
          const len = u * 0.03 + Math.min(1, bars[k]) * u * 0.16;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
          ctx.lineTo(Math.cos(a) * (r + len), Math.sin(a) * (r + len));
          ctx.stroke();
        }
      } else {
        const slot = w / n, bw = slot * 0.62;
        const radius = Math.min(bw / 2, 3);
        for (let k = 0; k < n; k++) {
          const v = Math.min(1, Math.max(0.02, bars[k]));
          const x = -w / 2 + k * slot + (slot - bw) / 2;
          ctx.beginPath();
          if (p.style === 'mirror') { const half = (v * h) / 2; ctx.roundRect(x, -half, bw, half * 2, radius); }
          else { const bh = Math.max(1.5, v * h); ctx.roundRect(x, h / 2 - bh, bw, bh, radius); }
          ctx.fill();
        }
      }
      // the playhead
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = Math.max(2, u * 0.008);
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (p.style === 'ring') { const r = Math.min(w, h) / 2 - u * 0.25; ctx.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress); ctx.stroke(); }
      else { const x = -w / 2 + w * progress; ctx.moveTo(x, -h / 2); ctx.lineTo(x, h / 2); ctx.stroke(); }
    },
  },
};

// ── the tool ─────────────────────────────────────────────────
const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** the clip's layout, picked by the seed among those that suit the format: where the wave, the name and the words sit */
export function audiogramLayout(portrait, seed = 1) {
  const rnd = mulberry32(seed >>> 0);
  const layouts = portrait
    ? [
        { name: [0.08, 0.12], wave: 0.8, captions: 0.62, bar: 0.94 },
        { name: [0.08, 0.08], wave: 0.5, captions: 0.72, bar: 0.92 },
        { name: [0.08, 0.86], wave: 0.66, captions: 0.4, bar: 0.95 },
      ]
    : [
        { name: [0.08, 0.16], wave: 0.84, captions: 0.62, bar: 0.93 },
        { name: [0.08, 0.12], wave: 0.48, captions: 0.76, bar: 0.92 },
      ];
  return layouts[Math.floor(rnd() * layouts.length) % layouts.length];
}

const audiogram = {
  name: 'audiogram', title: 'Make an audiogram',
  description: 'an extract of a podcast or an interview as a clip: the cover, the name, the wave moving with the voice, the words said, a progress bar — laid out for the format',
  input: {
    type: 'object',
    properties: {
      asset: { type: 'string', format: 'asset', assetType: ['audio', 'video'], title: 'Sound' },
      name: { type: 'string', title: 'Name', description: 'the show or the episode, over the wave' },
      cover: { type: 'string', format: 'asset', assetType: 'image', title: 'Cover', description: 'the picture behind the wave' },
      style: { enum: ['bars', 'mirror', 'line', 'ring'], title: 'Wave', description: 'mirror by default' },
      at: { type: 'number', title: 'From', description: 'the extract\'s start in the sound (0 by default)' },
      duration: { type: 'number', title: 'Seconds', description: 'the extract\'s length (30 s by default)' },
      seed: { type: 'integer', title: 'Seed', description: 'another seed, another layout of equal weight' },
    },
    required: ['asset'],
  },
  ai: { when: 'a podcast extract for the feeds: the cover behind, the show\'s name, the wave moving with the voice, the words said when the sound has its transcript; the analysis asset carries the bands, so the wave follows the sound', avoid: 'a wave without its analysis (run the beats tool first), a clip longer than a minute, the wave over busy art (it disappears)' },
  async run({ asset: wanted, name, cover, style = 'mirror', at = 0, duration = 30, seed = 1 }, ctx) {
    const comp = ctx.doc.compositions[ctx.compId];
    const media = wanted && /audio|video/.test(ctx.doc.assets[wanted]?.type ?? '') ? wanted : Object.entries(ctx.doc.assets).find(([, x]) => x.type === 'audio')?.[0];
    if (!media) throw new Error('the project needs the sound as an asset');
    // the analysis of the sound, bands included (the beats tool writes it)
    const analysisId = `analysis-${media}`;
    const analysisSrc = ctx.doc.assets[analysisId]?.src;
    let analysis = null;
    if (analysisSrc) { try { analysis = JSON.parse((await ctx.readText(analysisSrc)) ?? 'null'); } catch { analysis = null; } }
    if (!analysis || !analysis.bands) throw new Error(`the analysis of "${media}" has no bands — run the beats tool (use_tool "beats") on it first, then this`);
    const a = ctx.doc.assets[media], c = cover ? ctx.doc.assets[cover] : null;
    const portrait = comp.height > comp.width;
    const [w, h] = portrait ? [1080, 1920] : [1920, 1080];
    const u = Math.min(w, h);
    const from = Math.max(0, Math.min(at, Math.max(0, analysis.duration - 1)));
    const dur = +Math.max(1, Math.min(duration, analysis.duration - from)).toFixed(3);
    const fps = comp.fps ?? 30;
    const look = audiogramLayout(portrait, seed);
    const layers = {}, order = [];
    const colorOf = (t, fallback) => (ctx.doc.tokens?.[t]?.type === 'color' ? `@${t}` : fallback);
    const ink = colorOf('text', colorOf('ink', '#F4F5F7'));
    // the cover fills the frame, a plate under the text
    if (c) {
      layers.cover = { type: 'image', name: 'Cover', in: 0, out: dur, transform: { position: [w / 2, h / 2] }, props: { image: cover, size: [w, h], fit: 'cover' } };
      order.push('cover');
      layers.shade = { type: 'shape.rect', name: 'Shade', in: 0, out: dur, transform: { position: [w / 2, h / 2], opacity: 0.42 }, props: { size: [w, h], fill: colorOf('plate', '#0E1420') } };
      order.push('shade');
    }
    if (name) {
      layers.name = { type: 'text', name: 'Name', in: 0, out: dur, transform: { position: [Math.round(w * look.name[0]), Math.round(h * look.name[1])] }, props: { text: name, size: Math.round(u * 0.052), weight: 800, color: ink } };
      order.push('name');
    }
    layers.wave = {
      type: 'audiogram.wave', name: 'Wave', in: 0, out: dur,
      transform: { position: [Math.round(w / 2), Math.round(h * look.wave)] },
      props: { analysis: analysisId, style, count: portrait ? 64 : 72, fill: colorOf('accent', '#2EC4B6'), ink, from, span: dur, size: style === 'ring' ? [Math.round(u * 0.6), Math.round(u * 0.6)] : [Math.round(w * 0.84), Math.round(u * 0.24)], progress: { $k: [{ t: 0, v: 0 }, { t: dur, v: 1 }] } },
    };
    order.push('wave');
    // the words said, when the sound has its transcript: the built-in captions, in step with the extract
    const transcript = `transcription-${media}`.slice(0, 64);
    const captioned = !!ctx.doc.assets[transcript];
    if (captioned) {
      layers.captions = {
        type: 'captions', name: 'Captions', in: 0, out: dur,
        transform: { position: [Math.round(w / 2), Math.round(h * look.captions)] },
        props: { transcript, start: from, size: Math.round(u * (portrait ? 0.075 : 0.06)), weight: 800, width: Math.round(w * 0.82), maxWords: portrait ? 3 : 5, highlight: 'box', color: ink, activeColor: colorOf('accent', '#2EC4B6') },
      };
      order.push('captions');
    }
    // the progress bar, the trim drawing itself across the composition
    layers.bar = {
      type: 'shape.rect', name: 'Progress', in: 0, out: dur,
      transform: { position: [Math.round(w / 2), Math.round(h * look.bar)] },
      props: { size: [Math.round(w * 0.84), Math.max(4, Math.round(u * 0.006))], fill: ink, trimEnd: { $k: [{ t: 0, v: 0 }, { t: dur, v: 1 }] } },
    };
    order.push('bar');
    // the sound itself: an audio layer for a sound file, the video's own sound (its picture hidden) for a video
    layers.sound = a.type === 'video'
      ? { type: 'video', name: a.name ?? media, in: 0, out: dur, transform: { opacity: 0 }, props: { video: media, start: from } }
      : { type: 'audio', name: a.name ?? media, in: 0, out: dur, props: { audio: media, start: from } };
    order.push('sound');
    const ops = [{ op: 'add', path: `/compositions/audiogram-${Date.now().toString(36)}`, value: { name: name ? `Audiogram · ${name}` : 'Audiogram', width: w, height: h, fps, duration: dur, background: colorOf('background', '#0E0F12'), layers, order } }];
    return {
      ops, label: name ? `Audiogram · ${name}` : 'Audiogram',
      text: `The clip runs ${dur.toFixed(1)} s of "${a.name ?? media}" from ${from} s${c ? ', the cover behind' : ''}${name ? `, named "${name}"` : ''}: the wave reads the analysis' bands (32, log-spaced) at the moment the sound plays, rising with the voice and falling back slowly, the bar below trims itself across. ${captioned ? 'The words said run as captions.' : 'No transcript of the sound yet: transcribe it and the captions can join.'} ${portrait ? '9:16, ready for the feeds' : '16:9'}; another seed lays it out another way.`,
    };
  },
};

export const meta = { id: 'tramme/audiogram', name: 'audiogram', version: '1.0.0', description: 'Audiograms: the wave of a sound moving with the voice, a cover, a name, the words said, a progress bar — a clip for the feeds', api: 1 };
export const nodes = [wave];
export const tools = [audiogram];
export const messages = {
  fr: {
    'Wave': 'Onde', 'Make an audiogram': 'Faire un audiogramme',
    'Analysis': 'Analyse', 'Style': 'Style', 'Bars': 'Barres', 'Playhead': 'Tête de lecture', 'Progress': 'Progression', 'Size': 'Taille',
    'Sound': 'Son', 'Name': 'Nom', 'Cover': 'Pochette', 'From': 'Depuis', 'Seconds': 'Secondes', 'Length': 'Longueur', 'Seed': 'Graine',
    'the analysis of the sound (the beats tool writes it, bands included)': 'l’analyse du son (l’outil beats l’écrit, bandes comprises)',
    'the extract\'s start in the sound': 'le début de l’extrait dans le son',
    'the extract\'s length; 0: to the end of the sound': 'la longueur de l’extrait ; 0 : jusqu’à la fin du son',
    'the playhead\'s walk over the extract, in step with its sound; 1 holds it at the end': 'la marche de la tête de lecture sur l’extrait, au pas de son son ; 1 la tient à la fin',
    'the sound of an analysis as bars, a mirrored wave, a line or a ring, moving with the voice, a playhead crossing it': 'le son d’une analyse en barres, onde en miroir, ligne ou anneau, qui bouge avec la voix, une tête de lecture qui le traverse',
    'the sound made visible on an audiogram: under the speaker\'s picture, around a quote, at the foot of the clip; the bars read the analysis\' bands, so they follow the voice': 'le son rendu visible sur un audiogramme : sous la photo de l’intervenant, autour d’une citation, au pied de l’extrait ; les barres lisent les bandes de l’analyse, elles suivent la voix',
    'a wave on screen without its sound playing, more than one wave on a frame, a ring around nothing (it wants a picture or a name in the middle)': 'une onde à l’écran sans son son joué, plus d’une onde par image, un anneau autour de rien (il veut une image ou un nom au milieu)',
    'an extract of a podcast or an interview as a clip: the cover, the name, the wave moving with the voice, the words said, a progress bar — laid out for the format': 'un extrait de podcast ou d’entretien en clip : la pochette, le nom, l’onde qui bouge avec la voix, les mots dits, une barre de progression — disposé pour le format',
    'the show or the episode, over the wave': 'l’émission ou l’épisode, au-dessus de l’onde',
    'the picture behind the wave': 'l’image derrière l’onde',
    'mirror by default': 'miroir par défaut',
    'the extract\'s start in the sound (0 by default)': 'le début de l’extrait dans le son (0 par défaut)',
    'the extract\'s length (30 s by default)': 'la longueur de l’extrait (30 s par défaut)',
    'another seed, another layout of equal weight': 'une autre graine, une autre mise en page d’égale valeur',
    'a podcast extract for the feeds: the cover behind, the show\'s name, the wave moving with the voice, the words said when the sound has its transcript; the analysis asset carries the bands, so the wave follows the sound': 'un extrait de podcast pour les plateformes : la pochette derrière, le nom de l’émission, l’onde qui bouge avec la voix, les mots dits quand le son a sa transcription ; l’asset d’analyse porte les bandes, l’onde suit le son',
    'a wave without its analysis (run the beats tool first), a clip longer than a minute, the wave over busy art (it disappears)': 'une onde sans son analyse (passez d’abord l’outil beats), un clip de plus d’une minute, l’onde sur une image chargée (elle disparaît)',
  },
};
