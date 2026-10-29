// The closed vocabulary that describes a typeface's character, and what the
// data of a family says about it by itself (its name, its width and weight
// range, its category). The catalogue script adds the hand-written overlay
// (character.json) on top.

export const TAGS = [
  'condensed', 'wide', 'heavy', 'light', 'serif', 'slab', 'mono', 'rounded',
  'grotesque', 'geometric', 'humanist', 'neutral', 'elegant', 'playful', 'display',
  'handwritten', 'techno', 'editorial', 'friendly', 'bold', 'variable', 'italic',
] as const;

export interface FamilyData {
  id: string;
  family: string;
  weights: number[];
  axes?: Record<string, [number, number]>;
  category: string;
  italic?: boolean;
}

const NAME_TAGS: [RegExp, string][] = [
  [/\b(condensed|narrow|compressed)\b/i, 'condensed'],
  [/\b(extended|expanded|wide)\b/i, 'wide'],
  [/\bslab\b/i, 'slab'],
  [/\b(mono|code)\b/i, 'mono'],
  [/\b(rounded|round)\b/i, 'rounded'],
  [/\b(black|heavy)\b/i, 'heavy'],
];

const CATEGORY_TAGS: Record<string, string> = { serif: 'serif', monospace: 'mono', display: 'display', handwriting: 'handwritten' };

export function deriveTags(f: FamilyData): string[] {
  const tags = new Set<string>();
  for (const [re, tag] of NAME_TAGS) if (re.test(f.family)) tags.add(tag);
  const wdth = f.axes?.wdth;
  if (wdth && wdth[0] <= 80) tags.add('condensed');
  if (wdth && wdth[1] >= 125) tags.add('wide');
  if (f.weights.length) {
    if (Math.max(...f.weights) >= 800) tags.add('heavy');
    if (Math.min(...f.weights) <= 200) tags.add('light');
  }
  const byCategory = CATEGORY_TAGS[f.category];
  if (byCategory) tags.add(byCategory);
  if (f.axes) tags.add('variable');
  if (f.italic) tags.add('italic');
  return [...tags];
}
