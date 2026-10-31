// The names of the models that are not Claude's. Claude's come from its
// listing (claude-models.ts); Codex's, Antigravity's and OpenRouter's listings
// name their models too, kept here as they come. A model a listing only gives by
// its key (`gpt-5.1-codex-max`, `glm-4-plus`) is written out from the key, with
// no table of models: the words capitalised, a version kept as it is.

/** the names listings gave, by `provider:model` */
const listed = new Map<string, string>();

/** a listing came: each model's own name (a name that is only the key says nothing and is not kept) */
export function setModelLabels(list: [id: string, label: string][]) {
  for (const [id, label] of list) if (label && label !== id.slice(id.indexOf(':') + 1)) listed.set(id, label);
}

/** the name a listing gave a model, if any */
export const listedLabel = (id: string): string | undefined => listed.get(id);

/** these brands are written in capitals, and the version follows after a hyphen (GPT-5, GLM-4) */
const CAPITALS: Record<string, string> = { gpt: 'GPT', glm: 'GLM', chatgpt: 'ChatGPT' };
const HYPHEN = new Set(['gpt', 'glm']);

/** a model's key as a name to read: `gpt-5.1-codex-max` is "GPT-5.1 Codex Max"; a key already written with capitals is a name already */
export function readableModel(key: string): string {
  const bare = key.replace(/^models\//, '').split('/').at(-1) ?? key;
  if (/[A-Z]/.test(bare)) return bare;
  const words = bare.split(/[-_]+/).filter(Boolean);
  return words.map((w, i) => {
    const word = CAPITALS[w] ?? (/^o?\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1));
    return i === 0 ? word : `${HYPHEN.has(words[i - 1]) && /^\d/.test(w) ? '-' : ' '}${word}`;
  }).join('');
}
