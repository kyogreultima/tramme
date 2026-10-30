// The film plan: before building, the few kinds of picture a film alternates,
// assigned to scenes, and one to three directions written precisely
// (assets/film-plan.json, also an asset record of the document). Kinds are
// kinds, never layouts: each scene's composition is decided when it is built.
// The style frames drawn from the directions, and the one kept as the film's
// target, are recorded in the same file.

import { pointer, type Op, type ToolType, type TrammeDoc } from '@tramme/core';
import { m, t } from './i18n/index.ts';
import { slug } from './model.ts';

export const FILM_PLAN_PATH = 'assets/film-plan.json';

export type PictureKind = 'interface' | 'type' | 'object' | 'data' | 'diagram' | 'photo' | '3d' | 'character' | 'map';

/** what each kind of picture is, one line each, read by the model */
export const KIND_LINE: Record<PictureKind, string> = {
  interface: "a product's screen up close, built in layers",
  type: 'kinetic type, a title or a figure set large',
  object: 'an object or an illustration standing for a noun of the script',
  data: 'a chart, a counter, a table',
  diagram: 'a balance, a flow, a comparison, a price line',
  photo: 'a photo or footage on screen',
  '3d': 'a solid or a model',
  character: 'a person or a mascot, drawn or made',
  map: 'a place, a route',
};
export const PICTURE_KINDS = Object.keys(KIND_LINE) as PictureKind[];
/** what each kind is called to the user (the studio's direction panel) */
export const KIND_LABEL: Record<PictureKind, string> = {
  interface: m('studio.kinds.interface'), type: m('studio.kinds.type'), object: m('studio.kinds.object'), data: m('studio.kinds.data'), diagram: m('studio.kinds.diagram'),
  photo: m('studio.kinds.photo'), '3d': m('studio.kinds.3d'), character: m('studio.kinds.character'), map: m('studio.kinds.map'),
};

export interface Direction { name: string; type: string; palette: string; light: string; materials: string; framing: string }
export interface PlanScene { id: string; name: string; kind: PictureKind; idea: string; hero?: boolean; comp?: string; seconds?: number; status?: 'todo' | 'built' | 'failed'; brief?: string }
export interface StyleFrame { path: string; direction: string; scene: string; provider: string; model: string }
export interface FilmPlan {
  version: 1;
  kind: 'film-plan';
  updated: string;
  idea: string;
  kinds: PictureKind[];
  scenes: PlanScene[];
  directions: Direction[];
  /** an example the user gave (an animation, a video to match): one kind among the others */
  example?: { kind: PictureKind; what: string };
  frames?: StyleFrame[];
  /** the path of the kept style frame */
  target?: string;
}
export const isPlan = (x: unknown): x is FilmPlan => !!x && typeof x === 'object' && (x as FilmPlan).kind === 'film-plan';

/** a plan read from its file, or null when there is none (or it is not one) */
export function parsePlan(raw: string | null | undefined): FilmPlan | null {
  try { const p = JSON.parse(raw ?? 'null'); return isPlan(p) ? p : null; } catch { return null; }
}

const FIELDS = ['type', 'palette', 'light', 'materials', 'framing'] as const;

/** what is wrong with the variety of a plan: empty when the scenes alternate enough */
export function planIssues(plan: Pick<FilmPlan, 'kinds' | 'scenes' | 'example'>): string[] {
  const { kinds, scenes, example } = plan, n = scenes.length, out: string[] = [];
  if (kinds.length < 2 || kinds.length > 5) out.push(`Name 2 to 5 kinds of picture (there are ${kinds.length}).`);
  for (const s of scenes) if (!kinds.includes(s.kind)) out.push(`The scene "${s.name}" is a ${s.kind}, which the plan's kinds do not list.`);
  for (let i = 1; i < n; i++) if (scenes[i].kind === scenes[i - 1].kind) out.push(`"${scenes[i - 1].name}" and "${scenes[i].name}" are both ${scenes[i].kind}: change the kind of one.`);
  const used = new Set(scenes.map((s) => s.kind)).size, want = Math.min(3, n - 1);
  if (n >= 3 && used < want) out.push(`The film alternates ${used} kinds over ${n} scenes: use at least ${want} kinds.`);
  const count = (k: PictureKind) => scenes.filter((s) => s.kind === k).length;
  if (n >= 4) for (const k of new Set(scenes.map((s) => s.kind))) if (count(k) > Math.ceil(n / 2)) out.push(`${k} covers more than half the ${n} scenes (${count(k)}): give some of them another kind.`);
  if (example && count(example.kind) > Math.ceil(n / 3)) out.push(`The example (${example.what}) is one kind among the others: ${example.kind} is on ${count(example.kind)} scenes, at most ${Math.ceil(n / 3)} here.`);
  return out;
}

/** what is wrong with the directions: one to three, each of its five fields written precisely */
export function directionIssues(directions: Direction[]): string[] {
  const out: string[] = [];
  if (directions.length < 1 || directions.length > 3) out.push(`Write 1 to 3 directions (there are ${directions.length}).`);
  for (const d of directions) for (const f of FIELDS) if ((d[f] ?? '').trim().length < 12) out.push(`The ${f} of the direction "${d.name}" is too vague: write it precisely (12 characters at least).`);
  return out;
}

const LIMIT = 2500;
const directionText = (d: Direction) => `${d.name}: ${FIELDS.map((f) => `${f} ${d[f]}`).join('; ')}`;

/** the plan as the model reads it in the system prompt, at most 2 500 characters, the scenes' ideas clipped first */
export function planText(plan: FilmPlan): string {
  const head = [`Idea: ${plan.idea}`, `Kinds: ${plan.kinds.join(', ')}.`];
  if (plan.example) head.push(`Example from the user (${plan.example.kind}, one kind among the others): ${plan.example.what}`);
  const kept = plan.directions[0];
  const tail = [...(kept ? [`${plan.target ? 'Kept' : 'First'} direction: ${directionText(kept)}`] : []), ...(plan.target ? [`Target (style frame): ${plan.target}`] : [])];
  const fixed = [...head, ...tail].join('\n').length + 'Scenes:\n'.length;
  const names = plan.scenes.map((s) => `- ${s.name}: ${s.kind}${s.status && s.status !== 'todo' ? ` [${s.status}]` : ''}`);
  const room = LIMIT - fixed - names.reduce((a, l) => a + l.length + 3, 0);
  const each = Math.max(0, Math.floor(room / Math.max(1, plan.scenes.length)));
  const lines = plan.scenes.map((s, i) => {
    const idea = s.idea.length > each ? (each > 1 ? `${s.idea.slice(0, each - 1).trimEnd()}…` : '') : s.idea;
    return idea ? `${names[i]}, ${idea}` : names[i];
  });
  return [...head, 'Scenes:', ...lines, ...tail].join('\n').slice(0, LIMIT);
}

/** the scenes still to build (to do, or never started) whose composition exists, and the others with why they are left */
export function todoScenes(plan: FilmPlan, doc: TrammeDoc): { run: PlanScene[]; skipped: { scene: PlanScene; why: string }[] } {
  const run: PlanScene[] = [], skipped: { scene: PlanScene; why: string }[] = [];
  for (const scene of plan.scenes) {
    if (scene.status === 'built') skipped.push({ scene, why: 'already built' });
    else if (!scene.comp) skipped.push({ scene, why: 'it has no composition' });
    else if (!doc.compositions[scene.comp]) skipped.push({ scene, why: `its composition "${scene.comp}" does not exist` });
    else run.push(scene);
  }
  return { run, skipped };
}

/** the plan with one scene's state changed */
export const setStatus = (plan: FilmPlan, id: string, status: PlanScene['status']): FilmPlan => ({ ...plan, updated: new Date().toISOString(), scenes: plan.scenes.map((s) => (s.id === id ? { ...s, status } : s)) });

/** the plan's record in the document, added or brought up to date */
export function planOp(doc: TrammeDoc): Op {
  const value = { type: 'json' as const, src: FILM_PLAN_PATH };
  return doc.assets['film-plan'] ? { op: 'replace', path: pointer('assets', 'film-plan'), value } : { op: 'add', path: pointer('assets', 'film-plan'), value };
}

/** unique scene ids from the names */
function sceneIds(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const base = slug(name) || 'scene', n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  });
}

interface FilmPlanInput { idea: string; kinds: PictureKind[]; scenes: Omit<PlanScene, 'id'>[]; directions: Direction[]; example?: { kind: PictureKind; what: string } }

const kindProp = { type: 'string', enum: PICTURE_KINDS };
const filmPlan: ToolType<FilmPlanInput> = {
  name: 'film-plan', title: 'Film plan', description: `writes the plan of a film (assets/film-plan.json): its idea, the 2 to 5 kinds of picture it alternates (${PICTURE_KINDS.map((k) => `${k}: ${KIND_LINE[k]}`).join('; ')}), each scene with its kind and its idea, and one to three directions written precisely (type, palette, light, materials, framing); it says when the scenes would look alike`,
  input: {
    type: 'object',
    properties: {
      idea: { type: 'string', title: 'Idea', description: 'the idea of the film in two or three sentences: the story it tells and why it is worth watching' },
      kinds: { type: 'array', items: kindProp, title: 'Kinds', description: 'the 2 to 5 kinds of picture the film alternates' },
      scenes: {
        type: 'array', title: 'Scenes', description: 'the scenes in order, each with the kind of picture it is and what happens in it; no kind twice in a row, none on more than half the scenes',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'a short name' }, kind: kindProp, idea: { type: 'string', description: 'what the scene shows and does, in a sentence' },
            hero: { type: 'boolean', description: 'the scene the film is remembered for: its style frame is drawn first' },
            seconds: { type: 'number', description: 'how long it lasts, when known' },
            comp: { type: 'string', description: 'the id of the composition the scene is built in (the root plays it)' },
            brief: { type: 'string', description: 'what the builder of this scene needs beyond the plan: the words, names and figures it shows, the sources it uses, its length and where it sits in the root' },
          },
          required: ['name', 'kind', 'idea'],
        },
      },
      directions: {
        type: 'array', title: 'Directions', description: 'one to three directions, different from each other and from what you would do by default',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: { type: 'string', description: 'the lettering: family feel, weight, case, contrast' }, palette: { type: 'string', description: 'the colours, named, with their roles' },
            light: { type: 'string', description: 'where the light comes from and how hard it is' }, materials: { type: 'string', description: 'the textures and surfaces' },
            framing: { type: 'string', description: 'how pictures are cut and placed in the frame' },
          },
          required: ['name', 'type', 'palette', 'light', 'materials', 'framing'],
        },
      },
      example: {
        type: 'object', title: 'Example', description: 'an example the user gave (an animation, a video to match): its kind is limited to a third of the scenes',
        properties: { kind: kindProp, what: { type: 'string' } }, required: ['kind', 'what'],
      },
    },
    required: ['idea', 'kinds', 'scenes', 'directions'],
  },
  ai: {
    when: 'before building a film or dressing a video, after reading the sources and the brief; again when the user changes the story',
    avoid: 'one kind of picture for every scene; a kind used as a layout (a kind says what the picture is, not where things sit)',
  },
  async run(input, ctx) {
    const prev = parsePlan(await ctx.readText(FILM_PLAN_PATH).catch(() => null));
    const ids = sceneIds(input.scenes.map((s) => s.name));
    const written: FilmPlan = {
      version: 1, kind: 'film-plan', updated: new Date().toISOString(), idea: input.idea, kinds: input.kinds,
      scenes: input.scenes.map((s, i) => { const had = prev?.scenes.find((p) => p.id === ids[i]); return { ...(had?.status ? { status: had.status } : {}), ...(had?.comp ? { comp: had.comp } : {}), ...(had?.brief ? { brief: had.brief } : {}), ...s, id: ids[i] }; }), directions: input.directions,
      ...(input.example ? { example: input.example } : {}),
      ...(prev?.frames?.length ? { frames: prev.frames } : {}), ...(prev?.target ? { target: prev.target } : {}),
    };
    const path = await ctx.writeFile(FILM_PLAN_PATH, JSON.stringify(written, null, 1));
    const issues = [...planIssues(written), ...directionIssues(written.directions)];
    return {
      ops: [planOp(ctx.doc)], label: t('filmPlan.written'),
      text: `The film plan is at ${path}${prev ? ' (the style frames and the target kept before are kept)' : ''}:\n${planText(written)}\n${issues.length ? `To fix:\n${issues.map((l) => `- ${l}`).join('\n')}\nCall film-plan again with these fixed.\n` : ''}Next: have the directions drawn (style-frames), then build each scene in its kind.`,
    };
  },
};

const sceneDone: ToolType<{ scene: string; note?: string }> = {
  name: 'scene-done', title: 'Scene built',
  description: 'marks a scene of the film plan as built: the end of a scene builder’s turn',
  input: { type: 'object', properties: { scene: { type: 'string', title: 'Scene', description: 'its id in the plan' }, note: { type: 'string', title: 'Note', description: 'what the next scene or the assembly should know' } }, required: ['scene'] },
  ai: { when: 'the scene you were asked to build is built and checked: call it once, then stop without a summary', avoid: 'calling it for a scene that is not finished, or for another scene' },
  async run({ scene, note }, ctx) {
    const plan = parsePlan(await ctx.readText(FILM_PLAN_PATH).catch(() => null));
    if (!plan) throw new Error('there is no film plan: write it first (use_tool "film-plan")');
    if (!plan.scenes.some((s) => s.id === scene)) throw new Error(`${scene}: no such scene (the plan's scenes: ${plan.scenes.map((s) => s.id).join(', ')})`);
    await ctx.writeFile(FILM_PLAN_PATH, JSON.stringify(setStatus(plan, scene, 'built'), null, 1));
    return { ops: [planOp(ctx.doc)], label: `${scene} built`, text: `${scene} is marked built${note ? ` (${note})` : ''}. Stop here: do not summarise.` };
  },
};

export const FILM_PLAN_TOOLS: ToolType[] = [filmPlan as unknown as ToolType, sceneDone as unknown as ToolType];
