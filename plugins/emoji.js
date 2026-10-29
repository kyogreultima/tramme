// Emoji for the films, as pictures: the 300 most used, Fluent Emoji Flat
// (MIT), shipped beside the pack as SVG so they draw the same on every
// machine — never the system's emoji font, which draws differently on each.
// The search reads names, keywords and the character itself; the tool places
// one or several as picture layers, and only the files used enter the project.

const low = (s) => String(s ?? '').toLowerCase();

/** the words of a query, a few synonyms of the common words expanded */
const SYNONYMS = {
  happy: ['smiling', 'grinning'], laugh: ['joy', 'tears'], sad: ['crying', 'pleading'], love: ['heart'],
  angry: ['rage', 'steam'], party: ['popper', 'celebration'], money: ['banknote', 'coin', 'dollar'],
  food: ['pizza', 'burger', 'sandwich'], drink: ['coffee', 'tea', 'beer'], weather: ['sun', 'rain', 'cloud', 'snow'],
  animal: ['dog', 'cat', 'fox', 'bear'], travel: ['plane', 'rocket', 'train', 'car'], work: ['office', 'laptop', 'worker'],
  yes: ['check', 'thumbs'], no: ['cross', 'prohibited'], idea: ['bulb', 'thinking'], time: ['clock', 'watch', 'calendar'],
};

export function wordsOf(query) {
  const words = low(query).split(/[^a-z0-9]+/).filter(Boolean);
  const out = new Set(words);
  for (const w of words) for (const s of SYNONYMS[w] ?? []) out.add(s);
  return [...out];
}

/** how well one emoji answers the words: the best of an exact name, a name part, a keyword hit */
export function scoreOf(name, keywords, words) {
  let best = 0;
  for (const w of words) {
    if (name === w) best = Math.max(best, 100);
    else if (name.includes(w)) best = Math.max(best, name.startsWith(w) ? 70 : 55);
    for (const t of keywords) {
      if (t === w) best = Math.max(best, 50);
      else if (t.includes(w)) best = Math.max(best, 22);
    }
  }
  return best;
}

/**
 * The emoji a query finds, best first: names, keywords and the character
 * itself ("🔥" finds fire), the set's own order keeping the ties.
 */
export function searchEmoji(index, query, count = 12) {
  const raw = low(query).replace(/\s+/g, ' ').trim();
  const words = [...new Set([...wordsOf(query), raw])];
  const list = index.emoji ?? index;
  if (!words.length) return [];
  const found = [];
  for (const e of list) {
    let score = scoreOf(e.name, e.keywords ?? [], words);
    if (raw && e.codepoint) {
      // the character itself: 🔥
      const ch = String.fromCodePoint(...String(e.codepoint).split(' ').map((c) => parseInt(c, 16)));
      if (raw === ch || String.fromCodePoint(parseInt(e.codepoint.split(' ')[0], 16)) === raw) score += 120;
    }
    if (score > 0) found.push([score + (e.rank ?? 0) * 0.001, e]);
  }
  found.sort((a, b) => b[0] - a[0] || a[1].name.length - b[1].name.length || (a[1].name < b[1].name ? -1 : 1));
  return found.slice(0, count).map(([, e]) => e.name);
}

/** fresh, deterministic layer ids against the composition's own */
function takerOf(ctx) {
  const taken = new Set(Object.keys(ctx.doc.compositions?.[ctx.compId]?.layers ?? {}));
  return (base) => {
    let id = base, n = 1;
    while (taken.has(id)) { n++; id = `${base}-${n}`; }
    taken.add(id);
    return id;
  };
}

const emoji = {
  name: 'emoji', title: 'Place an emoji',
  description: 'one or several emoji as picture layers, found by name or by the character itself, the files they use copied into the project so they draw the same everywhere',
  input: {
    type: 'object',
    properties: {
      emoji: { type: 'string', title: 'Emoji', description: 'names ("fire, sparkles", "party popper") or the characters themselves ("🔥"), separated with commas; vague words come back as candidates' },
      layer: { type: 'string', format: 'layer', layerType: 'chat.thread', title: 'Chat thread', description: 'a thread of the chat pack: the emoji of its script drawn as the pack\'s pictures, in its bubbles' },
      size: { type: 'number', title: 'Size', description: 'the height on screen, in px; a quarter of the frame by default' },
      layout: { enum: ['row', 'grid', 'one'], title: 'Layout', description: 'how several are laid: a row, a grid, or each alone (one by default)' },
      at: { type: 'array', title: 'At', items: { type: 'number' }, description: 'the times each one shows, in seconds (from the start by default)' },
      duration: { type: 'number', title: 'Duration', description: 'how long each shows (2 s by default)' },
    },
  },
  ai: { when: 'emoji from the pack\'s own set: a point a picture says faster than a word: a reaction on a message in a chat thread, a celebration on a result, one clear pictogram in a title; the pack\'s set draws the same on every machine', avoid: 'an emoji per word, more than three on screen, emoji as decoration around everything, and the system font (never: the pack ships its own)' },
  async run(a, ctx) {
    const data = await ctx.packFile('index.json').then((t) => JSON.parse(t));
    const thread = a.layer ? ctx.doc.compositions[ctx.compId]?.layers?.[a.layer] : null;
    if (thread?.type === 'chat.thread') return threadEmoji(a.layer, thread, data, ctx);
    const asks = String(a.emoji ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!asks.length) throw new Error('say which emoji: names or the characters themselves');
    const found = [];
    for (const ask of asks) {
      const hits = searchEmoji(data, ask, 6);
      if (hits.length) found.push(hits[0]);
      else if (/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(ask)) {
        // an unknown character: kept as asked, the tool says it could not ship it
        found.push(null);
      }
    }
    const named = found.filter(Boolean);
    const sheet = found.includes(null) || (a.layout && a.layout !== 'one' && asks.length > 1 && !named.length);
    if (!named.length || (sheet && named.length > 1)) {
      return { ops: [], text: `Nothing sure in "${a.emoji}". Candidates: ${searchEmoji(data, asks.join(' '), 8).join(', ')}. Name one (or several, separated with commas) and I place it.` };
    }
    const comp = ctx.doc.compositions[ctx.compId];
    const layout = a.layout ?? 'one';
    // several in a row or a grid fit the frame's width, whatever size was asked
    const cols = layout === 'grid' ? Math.ceil(Math.sqrt(named.length)) : layout === 'row' ? named.length : 1;
    const size = Math.round(Math.min(a.size ?? Math.min(comp.width, comp.height) * 0.25, (comp.width * 0.9) / (cols * 1.2)));
    const duration = a.duration ?? 2;
    // the files used enter the project, and only them
    const ops = [], order = [];
    const take = takerOf(ctx);
    const byName = new Map((data.emoji ?? []).map((e) => [e.name, e]));
    let t0 = a.at?.[0];
    for (let k = 0; k < named.length; k++) {
      const e = byName.get(named[k]);
      if (!e) continue;
      const path = await ctx.writeFile(`assets/emoji/${e.file}`, await ctx.packFile(e.file));
      const aid = take(`emoji-${e.file.replace('.svg', '')}`);
      ops.push({ op: 'add', path: `/assets/${aid}`, value: { type: 'image', src: path, name: e.name } });
      const from = +(t0 ?? 0).toFixed(3), at = Array.isArray(a.at) ? +(a.at[k] ?? from).toFixed(3) : from;
      const lid = take(`emoji-${k + 1}`);
      const rows = Math.ceil(named.length / cols);
      const pos = layout === 'grid' && named.length > 1
        ? [Math.round(comp.width / 2 + ((k % cols) - (cols - 1) / 2) * size * 1.2), Math.round(comp.height / 2 + (Math.floor(k / cols) - (rows - 1) / 2) * size * 1.2)]
        : layout === 'row' && named.length > 1
          ? [Math.round(comp.width / 2 + (k - (named.length - 1) / 2) * size * 1.2), Math.round(comp.height / 2)]
          : [Math.round(comp.width / 2), Math.round(comp.height / 2)];
      ops.push({ op: 'add', path: `/compositions/${ctx.compId}/layers/${lid}`, value: {
        type: 'image', name: e.name, in: at, out: Math.min(comp.duration, at + duration),
        transform: { position: pos, scale: [size / 512, size / 512] },
        props: { image: aid, size: [512, 512], fit: 'contain' },
      } });
      order.push(lid);
    }
    for (const lid of order) ops.push({ op: 'add', path: `/compositions/${ctx.compId}/order/-`, value: lid });
    return {
      ops, label: `Emoji · ${named.join(', ')}`,
      text: `${named.length} emoji as picture layers (${named.join(', ')}), ${size} px, the SVGs copied into the project — they draw the same on every machine. Move, scale or retime them like any layer.`,
    };
  },
};

/** the emoji characters of a text, each whole (skin tones, joined sequences and the variation selector kept) */
export function emojiIn(text) {
  return [...new Set(String(text ?? '').match(/\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic}\uFE0F?)*/gu) ?? [])];
}

/** a chat thread's emoji as the pack's pictures: the files its script uses copied, its map filled */
async function threadEmoji(layerId, thread, data, ctx) {
  const chars = emojiIn(thread.props?.script);
  if (!chars.length) return { ops: [], text: 'The thread\'s script has no emoji: nothing to draw.' };
  const take = takerOf(ctx);
  const byName = new Map((data.emoji ?? []).map((e) => [e.name, e]));
  const map = { ...(thread.props?.emoji ?? {}) }, ops = [], missing = [];
  for (const ch of chars) {
    if (map[ch] && ctx.doc.assets[map[ch]]) continue;
    // the character as written, else without its skin tone and variation selector (the set ships the plain ones)
    const e = byName.get(searchEmoji(data, ch, 1)[0] ?? searchEmoji(data, ch.replace(/[\u{1F3FB}-\u{1F3FF}️]/gu, ''), 1)[0]);
    if (!e) { missing.push(ch); continue; }
    const path = await ctx.writeFile(`assets/emoji/${e.file}`, await ctx.packFile(e.file));
    const existing = Object.entries(ctx.doc.assets).find(([, x]) => x.src === path)?.[0];
    const aid = existing ?? take(`emoji-${e.file.replace('.svg', '')}`);
    if (!existing) ops.push({ op: 'add', path: `/assets/${aid}`, value: { type: 'image', src: path, name: e.name } });
    map[ch] = aid;
  }
  ops.push({ op: thread.props?.emoji === undefined ? 'add' : 'replace', path: `/compositions/${ctx.compId}/layers/${layerId}/props/emoji`, value: map });
  return {
    ops, label: `Emoji · ${thread.name ?? layerId}`,
    text: `${Object.keys(map).length} emoji of the thread drawn as the pack's pictures${missing.length ? ` (${missing.join(' ')} not in the set: they keep the system's font — change them in the script)` : ''}.`,
  };
}

export const meta = { id: 'tramme/emoji', name: 'emoji', version: '1.0.0', description: 'Emoji as pictures: the 300 most used (Fluent Emoji Flat, MIT) shipped as SVG, found by name or character, drawing the same on every machine', api: 1 };
export const tools = [emoji];
export const messages = {
  fr: {
    "Chat thread": "Fil de discussion",
    "a thread of the chat pack: the emoji of its script drawn as the pack's pictures, in its bubbles": "un fil du pack chat : les emoji de son script dessinés avec les images du pack, dans ses bulles",
    "the times each one shows, in seconds (from the start by default)": "les temps où chacun se montre, en secondes (depuis le début par défaut)",
    'Place an emoji': 'Placer un emoji', 'Emoji': 'Emoji', 'Size': 'Taille', 'Layout': 'Disposition', 'At': 'À', 'Duration': 'Durée',
    'names ("fire, sparkles", "party popper") or the characters themselves ("🔥"), separated with commas; vague words come back as candidates': 'des noms (« fire, sparkles », « party popper ») ou les caractères eux-mêmes (« 🔥 »), séparés par des virgules ; les mots vagues reviennent en candidats',
    'the height on screen, in px; a quarter of the frame by default': 'la hauteur à l’écran, en px ; un quart du cadre par défaut',
    'how several are laid: a row, a grid, or each alone (one by default)': 'comment plusieurs se disposent : en ligne, en grille, ou chacun seul (un par défaut)',
    'the times each one shows, in seconds (all the composition by default)': 'les temps où chacun se montre, en secondes (toute la composition par défaut)',
    'how long each shows (2 s by default)': 'combien de temps chacun se montre (2 s par défaut)',
    'one or several emoji as picture layers, found by name or by the character itself, the files they use copied into the project so they draw the same everywhere': 'un ou plusieurs emoji comme couches d’image, trouvés par nom ou par le caractère lui-même, les fichiers utilisés copiés dans le projet pour qu’ils se dessinent pareil partout',
    'a point a picture says faster than a word: a reaction on a message in a chat thread, a celebration on a result, one clear pictogram in a title; the pack\'s set draws the same on every machine': 'ce qu’une image dit plus vite qu’un mot : une réaction sur un message d’un fil de discussion, une célébration sur un résultat, un pictogramme clair dans un titre ; la série du pack se dessine pareil partout',
    'an emoji per word, more than three on screen, emoji as decoration around everything, and the system font (never: the pack ships its own)': 'un emoji par mot, plus de trois à l’écran, les emoji en décoration autour de tout, et la police du système (jamais : le pack livre les siens)',
  },
};
