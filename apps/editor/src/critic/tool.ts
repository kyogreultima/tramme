// The critique tool: a review of the film by a model that did not make it, in
// a fresh context. It measures what done means first (never argued with),
// shows the critic the film in motion, and merges its verdict with the
// measures: "done" only when nothing is missing by measure and the critic
// agrees. It counts its rounds and each scene's failures within the turn, and
// asks for takes of a scene that fails twice.

import { pointer, runChecks, likeness, type Op, type ToolContext, type ToolType } from '@tramme/core';
import { CRITIC_SYSTEM, NO_USAGE, addUsage, parseVerdict, type Usage } from '@tramme/assistant';
import { consult, seesPictures, type ConsultRequest, type Via } from '../ai/consult.ts';
import { FILM_PLAN_PATH, parsePlan } from '../filmplan.ts';
import { analyses } from '../perception.ts';
import { renderAndTarget } from '../review.ts';
import { scenesOf } from '../scenes.ts';
import { t } from '../i18n/index.ts';
import { doneIssues, type DoneIssue } from './done.ts';
import { gather, type Evidence } from './evidence.ts';

/** what the tool needs from the assistant's turn: kept apart so the tool does not import the engine that registers it */
export interface CriticHost {
  /** where a consult goes; null when the assistant has no route */
  via(): Via | null;
  /** the setting: how many consults one turn may make (0: the critic is off) */
  rounds(): number;
  gather(ctx: ToolContext, compId: string, checked?: Evidence['issues']): Promise<Evidence>;
  /** how much the film looks like its target, in a line; null when there is no target */
  likeness(ctx: ToolContext, compId: string, evidence: Evidence): Promise<string | null>;
  consult(req: ConsultRequest, via: Via): Promise<{ text: string; usage: Usage }>;
}

/** the likeness of a render at the hero moment (or the first entrance, or the middle) to the target, as a line */
async function targetLikeness(ctx: ToolContext, compId: string, evidence: Evidence): Promise<string | null> {
  if (!evidence.target) return null;
  const comp = ctx.doc.compositions[compId];
  const hero = (comp.markers ?? []).find((m) => m.kind === 'hero')?.t ?? (evidence.moments.find((m) => m.why.endsWith('enters'))?.t ?? comp.duration / 2 - 0.4) + 0.4;
  const { pa, pb } = await renderAndTarget(ctx, evidence.target, compId, Math.max(0, Math.min(hero, comp.duration - 0.05)));
  const like = likeness(pa, pb);
  return `Likeness to the target at ${hero.toFixed(1)} s: ${like.score}/100 (palette ${like.palette}, layout ${like.layout}, light ${like.light})${like.words.length ? `; ${like.words.join('; ')}` : ''}.`;
}

let host: CriticHost = { via: () => null, rounds: () => 2, gather, likeness: targetLikeness, consult };
/** the assistant's turn engine hands the tool its route and its setting; tests hand it stubs */
export function setCriticHost(next: Partial<CriticHost>) { host = { ...host, ...next }; }

/** what the critic has done so far in the turn */
const turn: { rounds: number; failures: Map<string, number>; usage: Usage[]; model: string } = { rounds: 0, failures: new Map(), usage: [], model: '' };

/** a new turn: no round used, no scene failed, no consult counted */
export function resetCritic() { turn.rounds = 0; turn.failures.clear(); turn.usage = []; turn.model = ''; }

/** the turn's consults added up, with their count and the model that made them; undefined when there were none */
export function consultsOf(): (Usage & { n: number; model: string }) | undefined {
  if (!turn.usage.length) return undefined;
  return { ...turn.usage.reduce(addUsage, NO_USAGE), n: turn.usage.length, model: turn.model };
}

/** a data URL as the parts a request takes */
const imageOf = (url: string) => { const m = /^data:([^;]+);base64,(.*)$/.exec(url); return m ? { mediaType: m[1], data: m[2] } : null; };

/** the strips of each take, side by side and labelled (the first picture of each, the target and the plan of the first) */
async function gatherTakes(ctx: ToolContext, takes: string[]): Promise<Evidence> {
  for (const id of takes) if (!ctx.doc.compositions[id]) throw new Error(`${id}: no such take`);
  const each = await Promise.all(takes.map((id) => host.gather(ctx, id, [])));
  return { ...each[0], strips: each.flatMap((e, i) => e.strips.slice(0, 1).map((s) => ({ url: s.url, caption: `Take "${takes[i]}": ${s.caption}` }))), moments: [], issues: [] };
}

const measuredLines = (found: DoneIssue[]) => found.map((i) => `- [${i.id}]${i.scene ? ` ${i.scene}:` : ''} ${i.line}`);

interface Input { compId?: string; takes?: string[] }

const critique: ToolType<Input> = {
  name: 'critique', title: 'Review the film',
  description: 'a review of the film by a model that did not make it, in a fresh context: it checks what done means by measure, looks at strips of the film around every cut and entrance against the style frame, and answers done or not yet with the three things that matter most',
  input: {
    type: 'object',
    properties: {
      compId: { type: 'string', title: 'Composition', description: 'the film; the one on screen by default' },
      takes: { type: 'array', title: 'Takes', description: 'the compositions that are takes of one scene (use_tool "scene-takes"): the critic compares them and names the best', items: { type: 'string' } },
    },
  },
  ai: {
    when: 'when the film or the dressing is built, before the summary; again after fixing what it said. Fix the three things it names, never argue with what it measures',
    avoid: 'calling it after every change; arguing with its measured issues; chasing a score',
  },
  async run({ compId, takes }, ctx) {
    const id = compId ?? ctx.compId;
    if (!ctx.doc.compositions[id]) throw new Error(`unknown composition: ${id}`);
    const limit = host.rounds();
    const plan = parsePlan(await ctx.readText(FILM_PLAN_PATH).catch(() => null));
    const issues = await runChecks(ctx.doc, ctx.registry, id, { data: await analyses(ctx) });
    const beats = { data: await analyses(ctx), analysisIds: Object.keys(ctx.doc.assets).filter((a) => /^analysis-/.test(a)) };
    const measured = doneIssues(ctx.doc, id, ctx.registry, plan, issues, beats);
    const head = measured.length ? `Measured, not to be argued with (${measured.length}):\n${measuredLines(measured).join('\n')}` : 'Measured: nothing missing (material, hierarchy, coverage, a hero, an ending, transitions, sound, nothing provisional, readable).';
    const measuredOnly = (why: string) => ({
      text: `${head}\n${why}`,
      notice: measured.length ? t('critic.measured', { n: measured.length }) : t('critic.nothingMeasured'),
    });

    if (limit <= 0) return measuredOnly('The critic is off (the setting "critic rounds" is 0): only what is measured ran. Fix it, and raise in the summary what you did not.');
    if (turn.rounds >= limit) return measuredOnly(`The critic's rounds are used (${turn.rounds} of ${limit}): finish, and say in the summary what is measured above and what the critic last asked for.`);
    const via = host.via();
    if (!via) throw new Error('no assistant route is available for the critic');
    if (!seesPictures(via.model)) return measuredOnly(`The critic needs a model that sees pictures: ${via.model} does not, so only what is measured ran. Choose a model that sees (a Claude, GPT or Gemini model, or a local vision model) to have the film reviewed.`);

    // the film in motion, the target and the plan: all the critic has
    let evidence: Evidence;
    try { evidence = takes?.length ? await gatherTakes(ctx, takes) : await host.gather(ctx, id, issues); } catch (e) { return measuredOnly(`The critic could not look at the film: ${(e as Error).message}`); }
    const pictures = [...(evidence.target ? [evidence.target] : []), ...evidence.strips.map((s) => s.url)].map(imageOf).filter((x): x is NonNullable<typeof x> => !!x);
    const takesText = takes?.length ? `\n\nThese are takes of one scene, built differently (their strips follow, in this order): ${takes.join(', ')}. Name the best in the "what" of your first fix and say why it beats the others.` : '';
    const text = [
      evidence.facts,
      evidence.plan ? `Plan:\n${evidence.plan}` : '',
      evidence.target ? 'The first picture is the target frame the film was made towards: reach its level of finish, not its content.' : '',
      `Moments (each strip is four frames over 0.6 s, left to right, three strips to a picture):\n${evidence.strips.map((s) => s.caption).join('\n')}`,
    ].filter(Boolean).join('\n\n') + takesText;

    let answer: { text: string; usage: Usage };
    try { answer = await host.consult({ system: CRITIC_SYSTEM, text, images: pictures, signal: ctx.signal }, via); } catch (e) {
      // the turn goes on, and no round is lost
      return { text: `${head}\nThe critic could not answer: ${(e as Error).message}. No round was counted; ask again, or go on.`, notice: t('critic.failed', { error: (e as Error).message }) };
    }
    turn.rounds++; turn.usage.push(answer.usage); turn.model = via.model;
    const verdict = parseVerdict(answer.text);
    const done = verdict.verdict === 'done' && measured.length === 0;
    const twice = verdict.fixes.map((f) => f.scene).filter((s): s is string => !!s && (turn.failures.set(s, (turn.failures.get(s) ?? 0) + 1), turn.failures.get(s)! >= 2));
    const like = await host.likeness(ctx, id, evidence).catch(() => null);
    const lines = [
      head,
      `Verdict: ${done ? 'done' : 'not yet'}${verdict.verdict === 'done' && !done ? ' (the critic said done, but what is measured above is missing)' : ''}`,
      ...(verdict.score !== null ? [`Score ${verdict.score}/10`] : []),
      ...(verdict.fixes.length ? ['What matters most:', ...verdict.fixes.map((f, i) => `${i + 1}. ${f.scene ? `${f.scene}: ` : ''}${f.what}${f.why ? ` (${f.why})` : ''}`)] : []),
      ...(verdict.raw ? [`The critic answered in prose, not in the form asked; taken as not yet. Its words: ${verdict.raw.slice(0, 600)}`] : []),
      ...[...new Set(twice)].map((s) => `${s} failed twice: make two or three takes of it (use_tool "scene-takes") rather than fixing it again`),
      ...(like ? [like] : []),
      `Rounds left: ${Math.max(0, limit - turn.rounds)} of ${limit}.`,
    ];
    return { text: lines.join('\n'), notice: done ? t('critic.done') : t('critic.notYet', { n: measured.length + verdict.fixes.length }) };
  },
};

/** the compositions that are the original of a scene and its takes: "price", "price~take2", "price~take3" */
const TAKE = /~take\d+$/;
const baseOf = (id: string) => id.replace(TAKE, '');

interface TakesInput { scene: string; make?: 2 | 3; keep?: string }

const sceneTakes: ToolType<TakesInput> = {
  name: 'scene-takes', title: 'Takes of a scene',
  description: 'copies a scene that failed twice into two or three takes to rebuild differently, and keeps the best one afterwards: the others and the original are removed',
  input: {
    type: 'object',
    properties: {
      scene: { type: 'string', title: 'Scene', description: 'its name, or the id of its composition' },
      make: { type: 'integer', enum: [2, 3], title: 'Takes', description: 'how many versions in all, the original included' },
      keep: { type: 'string', title: 'Keep', description: 'the composition to keep: a take, or the original; the rest of the scene’s takes are removed' },
    },
    required: ['scene'],
  },
  ai: {
    when: 'a scene the critic names for the second time: make two or three takes, build each differently (another kind of picture or another composition, not the same scene in other colours), have the critic compare them (use_tool "critique" with takes), keep the best',
    avoid: 'takes of a scene that failed once; takes that differ only in colour',
  },
  async run({ scene, make, keep }, ctx) {
    const root = ctx.doc.compositions[ctx.compId];
    const wanted = scene.toLowerCase();
    const found = scenesOf(ctx.doc, ctx.compId).find((s) => s.id === scene || s.name.toLowerCase() === wanted || s.comp === scene);
    if (!found?.comp) throw new Error(`${scene}: no scene of that name that plays a composition of its own`);
    const base = baseOf(found.comp), layerId = found.id;
    const all = Object.keys(ctx.doc.compositions).filter((c) => c === base || (baseOf(c) === base && TAKE.test(c)));
    if (keep) {
      if (!all.includes(keep)) throw new Error(`${keep}: not a take of ${found.name} (its versions: ${all.join(', ')})`);
      const ops: Op[] = [];
      if (root.layers[layerId] && (root.layers[layerId].props as { comp?: string } | undefined)?.comp !== keep) ops.push({ op: 'replace', path: pointer('compositions', ctx.compId, 'layers', layerId, 'props', 'comp'), value: keep });
      for (const c of all) if (c !== keep) ops.push({ op: 'remove', path: pointer('compositions', c) });
      // the kept take takes the scene's own name back
      if (keep !== base) ops.push({ op: 'replace', path: pointer('compositions', keep, 'name'), value: ctx.doc.compositions[base]?.name ?? found.name });
      return { ops, label: `Keep ${keep}`, text: `${keep} is now ${found.name}; ${all.length - 1} other version(s) removed.` };
    }
    const count = make ?? 2;
    const ops: Op[] = [], made: string[] = [];
    for (let n = 2; n <= count; n++) {
      const id = `${base}~take${n}`;
      if (ctx.doc.compositions[id]) continue;
      // the composition is plain data and its layer ids are its own: a copy keeps every reference inside it (children, clips, links)
      const copy = JSON.parse(JSON.stringify(ctx.doc.compositions[base])) as { name?: string };
      copy.name = `${ctx.doc.compositions[base].name ?? found.name} (take ${n})`;
      ops.push({ op: 'add', path: pointer('compositions', id), value: copy });
      made.push(id);
    }
    return {
      ops, label: `${count} takes of ${found.name}`,
      text: `${found.name} copied into ${made.length} take(s): ${made.join(', ')} (the root still plays the original). Each take must be built differently: another kind of picture or another composition, never the same scene in other colours. Then compare them (use_tool "critique" with takes: [${[...all, ...made].map((x) => `"${x}"`).join(', ')}]) and keep the best (use_tool "scene-takes" with keep).`,
    };
  },
};

export const CRITIC_TOOLS: ToolType[] = [critique as ToolType, sceneTakes as ToolType];
