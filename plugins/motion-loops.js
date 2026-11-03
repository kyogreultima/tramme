// Native, deterministic loop drawing. Inspired by the periodic-time and
// palette discipline of Scenario Motion Loops; independently implemented.
// https://github.com/scenario-labs/skills/tree/main/skills/scenario-motion-loops
const TAU = Math.PI * 2;
const phase = (t, period) => ((t % period) + period) % period / period;

const loop = {
  type: 'motion.loop', title: 'Motion loop', category: 'Motion',
  description: 'a seamless orbit, flowing ribbons or travelling grid, drawn from time in the project palette',
  ai: { when: 'an editable looping backdrop, bumper or brand pattern; set period to the film length or an exact divisor of it', avoid: 'a busy pattern behind small text, or a period that does not divide the intended loop duration' },
  props: {
    kind: { type: 'enum', default: 'ribbons', options: ['orbit', 'ribbons', 'grid'], label: 'Pattern', animatable: false },
    size: { type: 'vec2', default: [1920, 1080], label: 'Size', unit: 'px' },
    period: { type: 'number', default: 6, min: 0.1, max: 120, label: 'Period', unit: 's', animatable: false },
    count: { type: 'integer', default: 8, min: 2, max: 32, label: 'Count', animatable: false },
    background: { type: 'color', default: '#101923', label: 'Background' },
    color: { type: 'color', default: '#24394B', label: 'Pattern color' },
    accent: { type: 'color', default: '#F19A67', label: 'Accent' },
  },
  bounds: ({ size: [w, h] }) => ({ x: -w / 2, y: -h / 2, w, h }),
  render: {
    canvas2d(ctx, p, host) {
      const [w, h] = p.size, u = Math.min(w, h) / 100;
      const count = Math.max(2, Math.min(32, Math.round(p.count || 8)));
      const turn = phase(host.t, Math.max(0.1, p.period || 6)), angle = turn * TAU;
      ctx.save();
      ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, h); ctx.clip();
      ctx.fillStyle = p.background; ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.strokeStyle = p.color; ctx.lineWidth = Math.max(1, u * 0.2);
      if (p.kind === 'grid') {
        const cell = Math.max(w, h) / count, offset = turn * cell;
        for (let x = -w / 2 - cell; x < w / 2 + cell; x += cell) {
          ctx.beginPath(); ctx.moveTo(x + offset, -h / 2); ctx.lineTo(x + offset, h / 2); ctx.stroke();
        }
        for (let y = -h / 2 - cell; y < h / 2 + cell; y += cell) {
          ctx.beginPath(); ctx.moveTo(-w / 2, y + offset); ctx.lineTo(w / 2, y + offset); ctx.stroke();
        }
      } else if (p.kind === 'orbit') {
        for (let i = 0; i < count; i++) {
          const a = angle + i * TAU / count, r = u * (20 + i * 1.8);
          ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.6, -0.35, 0, TAU); ctx.stroke();
          ctx.fillStyle = i === 0 ? p.accent : p.color;
          ctx.beginPath(); ctx.arc(Math.cos(a) * r, Math.sin(a) * r * 0.6, u * (i === 0 ? 1.1 : 0.6), 0, TAU); ctx.fill();
        }
      } else {
        for (let i = 0; i < count; i++) {
          ctx.strokeStyle = i === 0 ? p.accent : p.color;
          ctx.beginPath();
          for (let j = 0; j <= 100; j++) {
            const x = -w / 2 + j * w / 100;
            const y = (i - (count - 1) / 2) * u * 6 + Math.sin(j / 100 * TAU + angle + i * 0.25) * u * 8;
            if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }
      ctx.restore();
    },
  },
};

const description = 'adds an editable seamless orbit, ribbons or grid behind the composition; its palette and period stay in the inspector';
const addLoop = {
  name: 'motion-loop', title: 'Add a motion loop', description,
  input: { type: 'object', properties: {
    kind: { type: 'string', enum: ['orbit', 'ribbons', 'grid'], title: 'Pattern' },
    period: { type: 'number', title: 'Period', description: 'seconds; defaults to the composition duration' },
    count: { type: 'integer', title: 'Count' },
    background: { type: 'string', title: 'Background' }, color: { type: 'string', title: 'Pattern color' }, accent: { type: 'string', title: 'Accent' },
  } },
  ai: { when: 'a seamless code-drawn backdrop, bumper or branded pattern; no generated footage needed', avoid: 'using a distracting moving backdrop when the brief asks for a still plate' },
  run(input, ctx) {
    const comp = ctx.doc.compositions[ctx.compId];
    const period = input.period ?? comp.duration;
    if (!Number.isFinite(period) || period < 0.1 || period > 120) throw new Error('Period must be between 0.1 and 120 seconds.');
    let id = 'motion-loop', n = 2;
    while (comp.layers[id]) id = `motion-loop-${n++}`;
    return { ops: [
      { op: 'add', path: `/compositions/${ctx.compId}/layers/${id}`, value: { type: loop.type, name: 'Motion loop', props: { kind: input.kind ?? 'ribbons', size: [comp.width, comp.height], period, count: input.count ?? 8, background: input.background ?? '#101923', color: input.color ?? '#24394B', accent: input.accent ?? '#F19A67' }, transform: { position: [comp.width / 2, comp.height / 2] } } },
      { op: 'add', path: `/compositions/${ctx.compId}/order/0`, value: id },
    ], label: 'Add a motion loop', text: `An editable ${input.kind ?? 'ribbons'} loop, period ${period} s. For a seamless film, its duration must contain a whole number of periods.` };
  },
};

export const meta = { id: 'tramme/motion-loops', name: 'motion-loops', version: '1.0.0', api: 1, description: 'Editable periodic motion: orbit, ribbons and travelling grids' };
export const nodes = [loop];
export const tools = [addLoop];
export const messages = { fr: {
  'Motion loop': 'Boucle animée', 'Motion': 'Mouvement', 'Pattern': 'Motif', 'Size': 'Dimensions', 'Period': 'Période', 'Count': 'Nombre',
  'Background': 'Fond', 'Pattern color': 'Couleur du motif', 'Accent': 'Accent',
  'Add a motion loop': 'Ajouter une boucle animée',
  'seconds; defaults to the composition duration': 'secondes ; par défaut, la durée de la composition',
  [loop.description]: 'une orbite, des rubans ou une grille en boucle, calculés selon le temps dans les couleurs du projet',
  [description]: 'ajoute une orbite, des rubans ou une grille en boucle derrière la composition ; ses couleurs et sa période restent dans l’inspecteur',
} };
