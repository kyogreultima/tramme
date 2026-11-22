// The sound library: what each sound is (kind, tags, length, the moment it
// lands on) wherever it comes from: files shipped with Tramme, sounds written
// as code (synthesis), the user's own library shared by the projects, sounds
// made by a provider. The assistant searches it by words, the way it would
// ask a sound designer.

export type SoundSource = 'built-in' | 'preset' | 'library';

export interface SoundEntry {
  /** unique in the library: lower case words and digits joined by - */
  id: string;
  title: string;
  /** what it is: impact, whoosh, riser, fall, click, glitch, chime, sting, boom, zap, pop, ui, ambience, music, voice… */
  kind: string;
  /** words it is found by: material, weight, mood, use */
  tags: string[];
  /** variants of one sound share it, so a sound placed many times does not repeat itself */
  family?: string;
  source: SoundSource;
  /** built-in: path under the library (impact/impactMetal_heavy_000.ogg); library: its file name */
  file?: string;
  /** preset: the code of the sound (the body of an async function (ctx, kit)) */
  code?: string;
  /** seconds */
  duration: number;
  /** the moment it lands on, seconds from its start (placed on the moment asked for) */
  peakAt: number;
  peakDb?: number;
  /** how loud it sounds (loudest 400 ms, dBFS) */
  loudDb?: number;
  license?: string;
  author?: string;
  /** where it comes from (its page), for the credits */
  url?: string;
  /** a sound made by a provider: what it was asked */
  prompt?: string;
  provider?: string;
  /** packed 512-dimensional CLAP audio vector, when the local model was available */
  clap?: string;
}

const words = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(Boolean);

/** words that mean the same kind of sound, so a request finds it in its own terms */
const ALIASES: Record<string, string[]> = {
  impact: ['hit', 'thud', 'bang', 'knock', 'punch', 'slam'],
  whoosh: ['swoosh', 'swish', 'swipe', 'pass', 'transition', 'woosh'],
  riser: ['rise', 'build', 'buildup', 'tension', 'up', 'ascend', 'uplifter'],
  fall: ['down', 'drop', 'descend', 'downlifter'],
  boom: ['explosion', 'sub', 'bass', 'drop'],
  click: ['tap', 'tick', 'button', 'switch', 'toggle', 'select'],
  chime: ['ding', 'bell', 'notification', 'glass', 'sparkle'],
  sting: ['jingle', 'logo', 'outro', 'ending', 'fanfare'],
  glitch: ['digital', 'error', 'noise', 'data', 'stutter'],
  zap: ['laser', 'electric', 'shot', 'beam'],
  pop: ['bubble', 'blip', 'appear'],
};

export const banKey = (e: SoundEntry): string => e.family ?? e.id;
const SOURCE_ORDER: Record<SoundSource, number> = { library: 0, 'built-in': 1, preset: 2 };
export const MEANING_WEIGHT = 4;
export const MEANING_MIN = 0.35;
export const MEANING_ONLY_MIN = 0.5;

/**
 * Sounds matching the words of a request, best first: kind, tags, title and
 * family count, the aliases of a kind too. With no words, the first of each kind.
 */
export function searchSounds(entries: SoundEntry[], query = '', opts: { kind?: string; limit?: number; banned?: ReadonlySet<string>; meaning?: (e: SoundEntry) => number | null } = {}): SoundEntry[] {
  const q = words(query), limit = opts.limit ?? 12;
  const pool = entries.filter((e) => (!opts.kind || e.kind === opts.kind) && !opts.banned?.has(banKey(e)));
  if (!q.length) {
    const seen = new Set<string>();
    return [...pool].sort((a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] || a.id.localeCompare(b.id)).filter((e) => { const key = e.family ?? e.id; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, limit);
  }
  const scored = pool.map((e) => {
    const tags = new Set(e.tags.flatMap(words)), title = words(e.title), kindWords = [e.kind, ...(ALIASES[e.kind] ?? [])];
    let score = 0;
    for (const w of q) {
      if (w === e.kind) score += 6;
      else if (kindWords.includes(w)) score += 4;
      if (tags.has(w)) score += 3;
      if (title.includes(w)) score += 2;
      else if (title.some((x) => x.startsWith(w) && w.length > 2)) score += 1;
    }
    const similarity = opts.meaning?.(e);
    if (similarity !== null && similarity !== undefined && similarity >= (score > 0 ? MEANING_MIN : MEANING_ONLY_MIN)) score += MEANING_WEIGHT * (similarity - MEANING_MIN) / (1 - MEANING_MIN);
    return { e, score };
  }).filter((x) => x.score > 0);
  // one sound per family: its variants come with it when it is placed
  const seen = new Set<string>();
  return scored.sort((a, b) => b.score - a.score || SOURCE_ORDER[a.e.source] - SOURCE_ORDER[b.e.source] || a.e.id.localeCompare(b.e.id))
    .map((x) => x.e)
    .filter((e) => { const key = e.family ?? e.id; if (seen.has(key)) return false; seen.add(key); return true; })
    .slice(0, limit);
}

/** the variants of a sound (itself included), in a stable order */
export const variantsOf = (entries: SoundEntry[], e: SoundEntry) =>
  (e.family ? entries.filter((x) => x.family === e.family && x.source === e.source) : [e]).sort((a, b) => a.id.localeCompare(b.id));
