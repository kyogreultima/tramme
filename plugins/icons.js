// Icons: the pictograms of explainers, feature lists and steps, drawn as
// strokes that stay editable. The data is Lucide (ISC), shipped beside this
// pack as lucide.json — path values on the 24-unit grid, read at authoring
// time with ctx.packFile. The icon tool finds icons by name, tag or a few
// words (ranked, with synonyms of the common words) and lays them in a row, a
// grid or beside the lines of a list, in the film's colours, each icon a
// group of path layers whose contours draw themselves with the trim. When the
// words are vague, the candidates come back as a contact sheet. The
// icon-stroke check says when an icon's stroke would vanish on a phone, or
// when one group mixes weights.

const GRID = 24; // the lucide grid the data is drawn on
const STROKE = 2; // the stroke the icons are drawn with, on that grid

/** words the user says that lucide names and tags spell otherwise */
const SYNONYMS = {
  money: ['banknote', 'wallet', 'coins', 'circle-dollar-sign', 'hand-coins', 'piggy-bank', 'credit-card'],
  car: ['car', 'car-front', 'truck', 'bus'],
  clock: ['clock', 'timer', 'watch', 'hourglass'],
  mail: ['mail', 'envelope', 'send', 'inbox'],
  phone: ['smartphone', 'phone', 'phone-call', 'tablet'],
  home: ['house', 'home', 'building', 'warehouse'],
  team: ['users', 'users-round', 'person-standing', 'contact'],
  user: ['user', 'user-round', 'circle-user', 'person-standing'],
  growth: ['trending-up', 'chart-line', 'sprout', 'rocket'],
  speed: ['gauge', 'zap', 'rocket', 'timer'],
  lock: ['lock', 'lock-keyhole', 'shield-check', 'key-round'],
  cloud: ['cloud', 'cloud-upload', 'cloud-download', 'server'],
  star: ['star', 'sparkles', 'award', 'badge-check'],
  check: ['check', 'circle-check', 'badge-check', 'check-check'],
  warning: ['triangle-alert', 'circle-alert', 'octagon-alert', 'shield-alert'],
  time: ['clock', 'calendar', 'hourglass', 'timer'],
  world: ['globe', 'earth', 'map', 'map-pin'],
  chat: ['message-circle', 'message-square', 'messages-square', 'speech'],
  code: ['code', 'code-xml', 'terminal', 'braces'],
  brain: ['brain', 'brain-circuit', 'lightbulb', 'circuit-board'],
  ai: ['brain-circuit', 'cpu', 'bot', 'sparkles'],
  plant: ['sprout', 'leaf', 'flower-2', 'trees'],
  food: ['utensils', 'apple', 'pizza', 'cup-soda'],
  heart: ['heart', 'heart-pulse', 'activity'],
  book: ['book-open', 'book', 'graduation-cap', 'library'],
  play: ['play', 'circle-play', 'film', 'clapperboard'],
};

const low = (s) => String(s ?? '').toLowerCase();

/** the words of a query, its synonyms expanded */
export function wordsOf(query) {
  const words = low(query).split(/[^a-z0-9]+/).filter(Boolean);
  const out = new Set(words);
  for (const w of words) for (const s of SYNONYMS[w] ?? []) out.add(s);
  return [...out];
}

/** how well one icon answers the words: the best of an exact name, a name part, a tag hit */
export function scoreOf(name, tags, words) {
  let best = 0;
  for (const w of words) {
    if (name === w) best = Math.max(best, 100);
    else if (name.includes(w)) best = Math.max(best, name.startsWith(w) ? 70 : 55);
    for (const t of tags) {
      if (t === w) best = Math.max(best, 50);
      else if (t.split(/\s+/).includes(w)) best = Math.max(best, 40);
      else if (t.includes(w)) best = Math.max(best, 22);
    }
  }
  return best;
}

/** the icons a query finds, best first */
export function searchIcons(data, query, count = 8) {
  // the whole query counts as a word of its own: "shield-check" names one icon, not two words
  const raw = low(query).replace(/\s+/g, ' ').trim();
  const words = [...new Set([...wordsOf(query), raw])];
  if (!words.length) return [];
  const found = [];
  for (const [name, icon] of Object.entries(data.icons ?? {})) {
    const score = scoreOf(name, icon.tags ?? [], words) + (name === raw ? 15 : 0); // the query spelled as one name wins its ties
    if (score > 0) found.push([score, name]);
  }
  found.sort((a, b) => b[0] - a[0] || a[1].length - b[1].length || (a[1] < b[1] ? -1 : 1));
  return found.slice(0, count).map(([score, name]) => ({ name, score, d: data.icons[name].d }));
}

/** the first icons whatever the words, for the contact sheet's "did you mean" */
export const topIcons = (data, count = 12) => Object.keys(data.icons ?? {}).slice(0, count);

// ── the tool ─────────────────────────────────────────────────
const JITTER = [1, 1.35, 0.8, 1.15, 0.9, 1.2, 1.05, 0.85];
/** the draw-on's ease: the kit's enter, or tramme's out ease */
const enterOf = (doc) => (doc.tokens?.enter?.type === 'ease' ? '@enter' : [0.16, 1, 0.3, 1]);

/** fresh, deterministic layer ids: base, base-2, base-3… against the composition's own */
function takerOf(ctx) {
  const taken = new Set(Object.keys(ctx.doc.compositions?.[ctx.compId]?.layers ?? {}));
  return (base) => {
    let id = base, n = 1;
    while (taken.has(id)) { n++; id = `${base}-${n}`; }
    taken.add(id);
    return id;
  };
}

/** one icon's layers: a group named icon:<name> of contour layers, trimmed when drawing on */
function iconLayers(take, f, at, size, color, t0, drawOn, enter) {
  const k = size / GRID;
  const contours = f.d ?? [];
  const children = [];
  const layers = [];
  const span = Math.min(0.6, Math.max(0.35, 0.12 * contours.length));
  contours.forEach((p, i) => {
    const id = take(`${f.name}-c${i + 1}`);
    // the stroke stays on the 24-unit grid: the group's scale carries it to the size
    const props = { path: p, fill: null, stroke: color, strokeWidth: STROKE, lineCap: 'round', lineJoin: 'round' };
    if (drawOn) {
      const delay = t0 + JITTER[i % JITTER.length] * 0.06 * i;
      props.trimStart = 0;
      props.trimEnd = { $k: [{ t: Math.round(delay * 100) / 100, v: 0, ease: enter }, { t: Math.round((delay + span) * 100) / 100, v: 1 }] };
    }
    layers.push([id, { type: 'shape.path', name: `${f.name} · ${i + 1}`, in: t0, props }]);
    children.push(id);
  });
  const id = take(`icon-${f.name}`);
  // anchored on the grid's centre, so the icon sits centred on its place and scales around it
  layers.push([id, { type: 'group', name: `icon:${f.name}`, in: t0, transform: { anchor: [GRID / 2, GRID / 2], position: [Math.round(at[0]), Math.round(at[1])], scale: [Math.round(k * 1000) / 1000, Math.round(k * 1000) / 1000] }, children }]);
  return { id, layers };
}

const iconTool = {
  name: 'icon', title: 'Icons',
  description: 'finds pictograms by name, tag or a few words and lays them as editable stroke groups: a row, a grid, or one beside each line of a list; when the words are vague, the candidates come back as a contact sheet',
  input: {
    type: 'object',
    properties: {
      icons: { type: 'string', title: 'Icons', description: 'the words (money, growth), a lucide name (trending-up), or several separated by commas: one per place' },
      count: { type: 'integer', minimum: 1, maximum: 24, title: 'How many', description: 'when the words name one icon: how many best matches to lay out' },
      layout: { enum: ['row', 'grid', 'list'], title: 'Layout' },
      cols: { type: 'integer', minimum: 1, maximum: 12, title: 'Columns', description: "a grid's columns (default: as many as keep it square)" },
      size: { type: 'number', minimum: 12, title: 'Size (px)', description: "one icon's box; its stroke scales with it" },
      color: { type: 'string', title: 'Colour', description: '@ink (the default), @accent, or a CSS colour' },
      at: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2, title: 'At', description: "[x, y] of the row's or grid's centre, or of the first icon of a list" },
      gap: { type: 'number', minimum: 4, title: 'Gap (px)', description: "between two icons; a list's rows sit 1.8 × the gap apart" },
      drawOn: { type: 'boolean', title: 'Draw on', description: 'the contours draw themselves with the trim (yes by default)' },
    },
    required: ['icons'],
  },
  ai: {
    when: 'a point a picture says faster than a word, a step of a process, a feature list; three reasons to switch get three icons beside their lines',
    avoid: 'an icon per word, more than five on screen at once, icons as decoration, two icon families in one film; vague words (money, growth) return a contact sheet: name the icons it shows before proposing them',
    example: { icons: 'trending-up, shield-check, users', layout: 'row', size: 96, color: '@accent' },
  },
  run(input, ctx) {
    if (!ctx.packFile) throw new Error('the icons pack reads its data beside the editor; run it from the editor or the assistant');
    return (async () => {
      const data = JSON.parse(await ctx.packFile('lucide.json'));
      const c = ctx.doc.compositions?.[ctx.compId] ?? { width: 1920, height: 1080 };
      const u = Math.min(c.width, c.height);
      const size = input.size > 0 ? input.size : Math.round(u * 0.08);
      const color = typeof input.color === 'string' && input.color ? input.color : ctx.doc.tokens?.ink?.type === 'color' ? '@ink' : '#16161a';
      const at0 = Number(ctx.time) || 0;
      const enter = enterOf(ctx.doc);
      const take = takerOf(ctx);
      const asked = low(input.icons).split(',').map((x) => x.trim()).filter(Boolean);
      const multi = asked.length > 1;
      const found = multi
        ? asked.map((q) => searchIcons(data, q, 1)[0]).filter(Boolean)
        : searchIcons(data, asked.join(' ') || input.icons, input.count ?? 5);
      // vague words: the best match is weak, so the candidates answer as a contact sheet
      if (!multi && (!found.length || found[0].score < 40)) {
        const picks = searchIcons(data, asked.join(' '), 12);
        const candidates = picks.length ? picks : topIcons(data, 12).map((name) => ({ name, d: data.icons[name].d, score: 0 }));
        const ops = [], order = [];
        const cols = Math.min(4, Math.ceil(Math.sqrt(candidates.length)));
        const gap = size * 0.9;
        const rows = Math.ceil(candidates.length / cols);
        const w = cols * (size + gap) - gap, h = rows * (size + gap * 1.9) - gap * 0.9;
        const x0 = c.width / 2 - w / 2 + size / 2, y0 = c.height / 2 - h / 2 + size / 2;
        candidates.forEach((f, k) => {
          const x = x0 + (k % cols) * (size + gap), y = y0 + Math.floor(k / cols) * (size + gap * 1.9);
          const { id, layers } = iconLayers(take, f, [x, y], size, color, at0, false, enter);
          for (const [cid, layer] of layers) ops.push({ op: 'add', path: `/compositions/${ctx.compId}/layers/${cid}`, value: layer });
          // the name under each candidate, so the sheet can be read
          const tid = take(`label-${f.name}`);
          ops.push({ op: 'add', path: `/compositions/${ctx.compId}/layers/${tid}`, value: { type: 'text', name: f.name, in: at0, transform: { position: [Math.round(x), Math.round(y + size * 0.75)] }, props: { text: f.name, size: Math.max(16, Math.round(size * 0.22)), align: 'center', color: '@ink' } } });
          order.push(tid, id);
        });
        for (const id of order) ops.push({ op: 'add', path: `/compositions/${ctx.compId}/order/-`, value: id });
        const still = await ctx.renderStill(at0, ctx.compId);
        return {
          ops, label: `Icon candidates (${candidates.length})`,
          text: `${candidates.length} candidate icons for "${input.icons}", laid out to look at, their names under them. The words were vague: this sheet is the pending proposal. Name the icons you want and ask again with them.`,
          images: [{ url: still, caption: `icon candidates for "${input.icons}"` }],
        };
      }
      if (!found.length) throw new Error(`no icon answers "${input.icons}" (try a lucide name, or other words)`);
      const layout = input.layout ?? (found.length > 4 ? 'grid' : 'row');
      const gap = input.gap > 0 ? input.gap : size * (layout === 'list' ? 0.8 : 0.6);
      const n = found.length;
      const cols = layout === 'grid' ? Math.min(input.cols ?? Math.ceil(Math.sqrt(n)), n) : n;
      const rows = layout === 'grid' ? Math.ceil(n / cols) : layout === 'list' ? n : 1;
      const w = cols * (size + gap) - gap, h = rows * (size + (layout === 'list' ? gap * 1.8 : gap)) - (layout === 'list' ? gap * 0.8 : gap);
      const at = Array.isArray(input.at) && input.at.length === 2 && input.at.every(Number.isFinite) ? input.at : [c.width / 2, c.height / 2];
      const x0 = layout === 'list' ? at[0] : at[0] - w / 2 + size / 2;
      const y0 = layout === 'list' ? at[1] : at[1] - h / 2 + size / 2;
      const ops = [], order = [];
      found.forEach((f, k) => {
        const col = layout === 'list' ? 0 : k % cols, row = layout === 'list' ? k : Math.floor(k / cols);
        const x = x0 + col * (size + gap), y = y0 + row * (size + (layout === 'list' ? gap * 1.8 : gap));
        const { id, layers } = iconLayers(take, f, [x, y], size, color, at0, input.drawOn !== false, enter);
        for (const [cid, layer] of layers) ops.push({ op: 'add', path: `/compositions/${ctx.compId}/layers/${cid}`, value: layer });
        order.push(id);
      });
      for (const id of order) ops.push({ op: 'add', path: `/compositions/${ctx.compId}/order/-`, value: id });
      return {
        ops, label: `Icons (${n})`,
        text: `${n} icon(s) in a ${layout} at ${size} px: ${found.map((f) => f.name).join(', ')}. Each is a group of path layers (named icon:<name>), drawn in ${color} with a ${Math.round(STROKE * size / GRID * 100) / 100} px stroke${input.drawOn !== false ? ', the contours drawing themselves' : ''}. A list's rows sit 1.8 × the gap apart: lay the lines' texts on the same rhythm, around ${Math.round(size * 0.55)} px type.`,
      };
    })();
  },
};

// ── the check ────────────────────────────────────────────────
const iconCheck = {
  name: 'icon-stroke', title: 'Icon stroke',
  description: 'an icon whose stroke is under 2 px at the composition\'s size vanishes on a phone, and one group of icons at mixed weights reads as a mistake',
  texts: ['{name}: its stroke is {px} px at this size — under 2 px it vanishes on a phone'],
  run(ctx) {
    const out = [];
    const seen = new Set();
    for (const sample of ctx.samples) {
      const byId = new Map(sample.layers.map((l) => [l.id, l]));
      for (const placed of sample.layers) {
        if (placed.node.type !== 'group' || !placed.layer.name?.startsWith('icon:') || seen.has(placed.id)) continue;
        seen.add(placed.id);
        const weights = new Set();
        let px = null;
        // the stroke as it shows: the contour's own times the group's scale
        const scale = (placed.layer.transform?.scale?.[0] ?? 1) || 1;
        for (const child of placed.layer.children ?? []) {
          const p = byId.get(child);
          if (p?.node.type === 'shape.path' && p.props.strokeWidth > 0) { const w = p.props.strokeWidth * scale; weights.add(Math.round(w * 10) / 10); px = w; }
        }
        const name = placed.layer.name.replace('icon:', '');
        if (px !== null && px < 2) out.push({ check: 'icon-stroke', severity: 'warning', message: `${name}: its stroke is ${Math.round(px * 100) / 100} px at this size — under 2 px it vanishes on a phone`, t: sample.t, layers: [placed.id] });
        else if (weights.size > 1) out.push({ check: 'icon-stroke', severity: 'info', message: `${name}: its strokes mix weights (${[...weights].join(', ')} px) — one weight per row of icons`, t: sample.t, layers: [placed.id] });
      }
    }
    return out;
  },
};

export const meta = { id: 'tramme/icons', name: 'icons', version: '1.0.0', description: 'Lucide icons as editable stroke groups, found by name, tag or words, laid in a row, a grid or a list', api: 1 };
export const tools = [iconTool];
export const checks = [iconCheck];
export const messages = {
  fr: {
    'Icons': 'Icônes',
    'finds pictograms by name, tag or a few words and lays them as editable stroke groups: a row, a grid, or one beside each line of a list; when the words are vague, the candidates come back as a contact sheet': 'trouve des pictogrammes par nom, étiquette ou quelques mots et les pose en groupes de traits éditables : en ligne, en grille, ou à côté de chaque ligne d\'une liste ; quand les mots sont vagues, les candidates reviennent en planche',
    'Icon stroke': 'Trait des icônes',
    'an icon whose stroke is under 2 px at the composition\'s size vanishes on a phone, and one group of icons at mixed weights reads as a mistake': 'une icône au trait sous 2 px à la taille de la composition disparaît sur un téléphone, et un groupe d\'icônes d\'épaisseurs mêlées se lit comme une erreur',
    'Icons (labels)': 'Icônes',
  },
};
