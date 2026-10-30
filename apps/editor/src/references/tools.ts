// The references as tools of the vocabulary: `references` reads what the craft
// says (and the user's own kept films, watched for convergence), `reference-keep`
// writes the user's own entry to the library shared by the projects.

import type { ToolType } from '@tramme/core';
import { api } from '../api.ts';
import { FILM_PLAN_PATH, parsePlan } from '../filmplan.ts';
import { refreshLibrary } from '../library.ts';
import { slug } from '../model.ts';
import { t } from '../i18n/index.ts';
import { queryWords } from '../words.ts';
import { loadReferences, REF_TAGS, type Reference } from './catalogue.ts';
import { convergence, factsOf, isReferenceFile, parseOwn, referenceFile, type OwnReference } from './own.ts';
import { searchReferences } from './search.ts';

/** the user's kept films, read from the library; throws when the library cannot be reached */
async function readOwn(): Promise<OwnReference[]> {
  const list = (await api.library()).filter((f) => isReferenceFile(f.name)).slice(0, 40);
  const out: OwnReference[] = [];
  for (const f of list) { try { const e = parseOwn(await api.libraryGet(f.name)); if (e) out.push(e); } catch { /* one file unreadable: left out */ } }
  return out;
}

const lines = (r: Reference) => [`- [${r.kind}] ${r.title} (${r.tags.join(', ')})`, `  ${r.text}`, ...(r.see ? [`  See: ${r.see}`] : []), ...(r.fix ? [`  Fix: ${r.fix}`] : [])].join('\n');

/** the user's films that answer the words, the best two; the more the films converge, the lower they weigh */
function rankOwn(own: OwnReference[], query: string, weight: number): OwnReference[] {
  const words = queryWords(query);
  return own
    .map((o) => { const have = new Set(queryWords([o.title, o.why, o.tags.join(' ')].join(' '))); return { o, score: words.filter((w) => have.has(w)).length * weight }; })
    .filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 2).map((x) => x.o);
}

const references: ToolType<{ query: string; kind?: 'principle' | 'fault'; count?: number }> = {
  name: 'references', title: 'What the craft says',
  description: 'reads, in words, what makes a frame or a cut work and the faults to avoid (composition, hierarchy, type, contrast, rhythm, transitions, the link between picture and sound), and the films the user kept with their reasons; it warns when those films converge on one look',
  input: {
    type: 'object',
    properties: {
      query: { type: 'string', title: 'Query', description: 'two or three words of what is hard in this film: "transitions between scenes", "talking video coverage"' },
      kind: { enum: ['principle', 'fault'], title: 'Kind', description: 'principles or faults only; both by default' },
      count: { type: 'integer', minimum: 1, maximum: 8, title: 'How many', description: '4 by default' },
    },
    required: ['query'],
  },
  ai: {
    when: 'before directing a film or a dressing, with two or three words of what is hard in it; and when the critic names a fault. The entries are principles, never a look to copy',
    avoid: 'copying an entry as a recipe; reading the whole library: ask for the hard part',
  },
  async run({ query, kind, count }) {
    const refs = await loadReferences();
    const { found, closest } = searchReferences(refs, query, { kind, count });
    let own: OwnReference[] = [], unreadable = false;
    try { own = await readOwn(); } catch { unreadable = true; }
    const conv = convergence(own), converging = !!conv && conv.score > 0.6;
    const mine = rankOwn(own, query, converging ? 1 - conv!.score : 1);
    const text = [
      closest ? `No entry matched "${query}": these are the closest.` : '',
      ...found.map(lines),
      ...(mine.length ? ['Films the user kept:', ...mine.map((o) => `- ${o.title} (${o.tags.join(', ')}): ${o.why}`)] : []),
      ...(unreadable ? ["The user's kept films could not be read (the library is out of reach): only the shipped entries are given."] : []),
      ...(converging ? [`Your kept films are converging on one look (${conv!.shared.join('; ') || 'one palette and one set of kinds'}): take this film elsewhere.`] : []),
    ].filter(Boolean).join('\n');
    return { text, notice: t('references.read', { n: found.length }) };
  },
};

const keepReference: ToolType<{ title: string; why: string; tags: string[] }> = {
  name: 'reference-keep', title: 'Keep this film as a reference',
  description: 'keeps the film of this project in the library shared by the projects, with the reasons it works in words and the facts read from the document (palette, typefaces, kinds of picture), so the craft can draw on it',
  input: {
    type: 'object',
    properties: {
      title: { type: 'string', title: 'Title', description: 'a few words that name what the film does well' },
      why: { type: 'string', title: 'Why it works', description: 'the reasons in words, at least 80 characters: the principle at work and how to see it' },
      tags: { type: 'array', title: 'Tags', description: 'one or more of the closed list of tags (craft: composition, hierarchy, type, rhythm, sound…; kinds of picture; kinds of film); a tag outside it is refused and the error lists them', items: { type: 'string' } },
    },
    required: ['title', 'why', 'tags'],
  },
  ai: {
    when: 'the user says a film is good, or keeps it: write the reasons it works in words, as a principle',
    avoid: 'keeping a film nobody judged; describing a shot precisely enough to rebuild it',
  },
  async run({ title, why, tags }, ctx) {
    const reasons = String(why ?? '').trim();
    if (reasons.length < 80) throw new Error('why: the reasons in words are the entry; write at least 80 characters on the principle at work and how to see it');
    if (reasons.length > 900) throw new Error('why: at most 900 characters');
    const bad = (tags ?? []).filter((x) => !(REF_TAGS as readonly string[]).includes(x));
    if (bad.length || !tags?.length) throw new Error(`tags: ${bad.length ? `"${bad.join('", "')}" ${bad.length > 1 ? 'are' : 'is'} not in the list` : 'at least one tag'} (${REF_TAGS.join(', ')})`);
    // the state imports the vocabulary, which imports this file: it is read when the tool runs
    const { S } = await import('../state.ts');
    const project = S.project.peek();
    const plan = parsePlan(await ctx.readText(FILM_PLAN_PATH).catch(() => null));
    const entry = { kind: 'tramme-reference', id: project.id, project: project.id, kept: new Date().toISOString(), title: String(title).trim(), why: reasons, tags, facts: factsOf(ctx.doc, plan) };
    const file = referenceFile(project.id, slug);
    // the same project's entry is replaced, never doubled
    await api.libraryPut(file, `export default ${JSON.stringify(entry)};\n`);
    await refreshLibrary();
    return { text: `The film is kept as a reference in the library (${file}): ${entry.title}. The facts read from it: ${JSON.stringify(entry.facts)}.`, notice: t('references.kept', { title: entry.title }) };
  },
};

export const REFERENCE_TOOLS: ToolType[] = [references as unknown as ToolType, keepReference as unknown as ToolType];
