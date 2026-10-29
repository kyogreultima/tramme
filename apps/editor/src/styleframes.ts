// Style frames: before building, an image model draws a finished frame of the
// film for each direction of the film plan (filmplan.ts); one is kept as the
// film's target. A frame is a file of the project under assets/frames/ with
// its record, never an asset of the document and never a layer: the film is
// built in layers to match it. Keeping one sets the palette tokens from it.

import type { ToolContext, ToolOutput, ToolType } from '@tramme/core';
import type { MadeImage } from './api.ts';
import { alone, chooseAmong } from './confirm.ts';
import { FILM_PLAN_PATH, parsePlan, planOp, type Direction, type FilmPlan, type PlanScene, type StyleFrame } from './filmplan.ts';
import { CHANGERS, FRAMES_DIR, drawTakes, holdTakes, ratioOf, referenceOf, takeHeld, takeSheet } from './images.ts';
import { extOf } from './media.ts';
import { clip, slug } from './model.ts';
import { canvas, paletteOf, paletteOps } from './perception.ts';
import { planMatches } from './forms.ts';
import { scenesOf } from './scenes.ts';
import { prefs } from './settings.ts';
import { t } from './i18n/index.ts';

const FINISHED = 'A frame from a finished, art-directed film: every element designed, nothing generic.';
const OVER = "Redraw the picture given as this finished frame: keep its subject and composition, and bring its style, light, materials and palette to the direction's.";
const BUILD_FROM_WORDS = "build from the direction's words (type, palette, light, materials, framing) instead";

/** a finished frame of the film at the composition's proportions: the scene's idea, then the direction's five fields */
export function framePrompt(plan: FilmPlan, d: Direction, scene: PlanScene, format: { width: number; height: number }): string {
  return [
    `A finished frame of a motion design film (${plan.idea}), ${format.width} by ${format.height} px: ${scene.idea}`,
    `Type: ${d.type}`, `Palette: ${d.palette}`, `Light: ${d.light}`, `Materials: ${d.materials}`, `Framing: ${d.framing}`,
    FINISHED,
  ].join('\n');
}

/** what is held with the frames drawn when nobody was there to choose */
interface HeldFrames { scene: string; frames: { direction: string; prompt: string }[] }

interface Input { scene?: string; count?: 1 | 2 | 3; over?: 'frame'; keep?: string; provider?: string }

const text = (s: string): ToolOutput => ({ ops: [], text: s });

/** the frame kept as the target: its file and record, the plan, the palette of the film */
async function keepFrame(ctx: ToolContext, plan: FilmPlan, scene: string, d: Direction, made: MadeImage, prompt: string, take?: number): Promise<ToolOutput> {
  const base = `${FRAMES_DIR}${scene}-${slug(d.name)}`;
  const path = await ctx.writeFile(`${base}.${extOf('image', made.blob.type)}`, made.blob);
  await ctx.writeFile(`${base}.json`, JSON.stringify({ prompt, provider: made.provider, model: made.model, direction: d.name, scene, ...(take ? { take } : {}) }, null, 1));
  const entry: StyleFrame = { path, direction: d.name, scene, provider: made.provider, model: made.model };
  const next: FilmPlan = {
    ...plan, updated: new Date().toISOString(), frames: [...(plan.frames ?? []).filter((f) => f.path !== path), entry], target: path,
    directions: [d, ...plan.directions.filter((x) => x.name !== d.name)],
  };
  await ctx.writeFile(FILM_PLAN_PATH, JSON.stringify(next, null, 1));
  // the palette of the frame becomes the film's tokens
  const bitmap = await createImageBitmap(made.blob), { g } = canvas(96, 96);
  try { g.drawImage(bitmap, 0, 0, 96, 96); } finally { bitmap.close(); }
  const palette = paletteOf(g, 96, 96);
  return {
    ops: [planOp(ctx.doc), ...paletteOps(palette, path)], label: t('styleFrames.kept', { path }),
    text: `Style frame kept at ${path} (direction "${d.name}", scene "${scene}"): the film's target, with its record beside it. It is a target, never placed in the film. The palette tokens are set from it: plate ${palette.plate}, ink ${palette.ink}, accent ${palette.accent}. Next, in order: retype every word you read in the frame as text layers (the words of a picture never ship); match its lettering in the catalogue (typefaces with compare: "${path}"); make its plates, textures and objects again without words (generate-image with reference: "${path}" and a change that removes every word and every interface element, remove-bg for an object); rebuild the scene in layers to match the frame; then animate it.`,
    images: [{ url: (await takeSheet([made], 768))[0], caption: `${d.name} · ${made.provider}` }],
    notice: t('styleFrames.kept', { path }),
  };
}

const styleFrames: ToolType<Input> = {
  name: 'style-frames', title: 'Style frames', description: "has an image model draw a finished frame of the film for each direction of the film plan (assets/film-plan.json), saves the one kept as the film's target under assets/frames/ with its record, and sets the project's palette from it",
  input: {
    type: 'object',
    properties: {
      scene: { type: 'string', title: 'Scene', description: "a scene id of the film plan: the hero scene by default, else the first" },
      count: { type: 'integer', enum: [1, 2, 3], title: 'Frames', description: "how many frames: one per direction (up to this number), or the takes of the only direction; the Pictures settings' by default" },
      over: { enum: ['frame'], title: 'Over the video', description: 'dressing a video: the frame is drawn over a still of the video at the scene\'s time, which the provider restyles (OpenAI and Gemini)' },
      keep: { type: 'string', title: 'Keep a frame', description: 'a frame held from an earlier call ("takes-…:2"), kept as the film\'s target without drawing again' },
      provider: { enum: ['openai', 'gemini', 'zai', 'hydracept'], title: 'Provider', description: "the Pictures settings' by default" },
    },
  },
  ai: {
    when: "after film-plan, before building the first scene; when dressing a video, over: 'frame' on the scene of an illustration. Keep the strongest frame when the user is not there",
    avoid: 'placing the frame in the film (it is a target: the scene is built in layers to match it); drawing frames again to fix a detail (fix the scene in layers); frames when the settings turned them off',
  },
  async run(a, ctx) {
    const p = prefs.peek(), c = ctx.doc.compositions[ctx.compId];
    const plan = parsePlan(await ctx.readText(FILM_PLAN_PATH).catch(() => null));
    if (!plan) return text('There is no film plan yet: write it first (use_tool "film-plan"), then have its directions drawn.');

    // a frame held from an earlier call, kept as the target
    if (a.keep) {
      const h = takeHeld(a.keep);
      if (h && !h.take) return text(`${h.made.length} frames are held under "${a.keep}": say which one to keep, keep: "${a.keep}:<n>" (1 to ${h.made.length}).`);
      if (!h?.take) return text(`Nothing is held under "${a.keep}": frames are held for this session only, and a frame is kept once. The plan keeps its target${plan.target ? ` (${plan.target})` : ' (none yet)'}; have the frames drawn again if you need another.`);
      const x = h.extra as unknown as HeldFrames, meta = x.frames[h.take - 1];
      const d = plan.directions.find((y) => y.name === meta.direction) ?? plan.directions[0];
      return keepFrame(ctx, plan, x.scene, d, h.made[0], meta.prompt, h.take);
    }

    if (!p.styleFrames) return text(`Style frames are off in the settings: ${BUILD_FROM_WORDS}.`);
    const scene = a.scene ? plan.scenes.find((s) => s.id === a.scene) : plan.scenes.find((s) => s.hero) ?? plan.scenes[0];
    if (!scene) throw new Error(a.scene ? `${a.scene}: no such scene in the film plan (${plan.scenes.map((s) => s.id).join(', ')})` : 'the film plan has no scene');
    if (!plan.directions.length) return text('The film plan has no direction to draw: write them with film-plan.');
    const provider = a.provider ?? (p.pictureProvider !== 'auto' ? p.pictureProvider : undefined);
    if (a.over && provider && !CHANGERS.includes(provider)) throw new Error(`${provider} draws from words only: restyle a still of the video with OpenAI or Gemini (provider)`);

    // one frame per direction (at most the count), or the takes of the only one
    const n = a.count ?? p.styleFrames;
    const jobs = plan.directions.length > 1 ? plan.directions.slice(0, n).map((d) => ({ d, n: 1 })) : [{ d: plan.directions[0], n }];
    const at = scenesOf(ctx.doc, ctx.compId).find((s) => planMatches(scene, s))?.from ?? ctx.time;
    const ref = a.over ? await referenceOf(ctx, { source: 'frame', at }) : null;
    const made: MadeImage[] = [], meta: HeldFrames['frames'] = [];
    let stopped = '';
    for (const { d, n: takes } of jobs) {
      const prompt = [framePrompt(plan, d, scene, c), a.over ? OVER : ''].filter(Boolean).join('\n\n');
      try {
        const got = await drawTakes(ctx, {
          prompt, ratio: ratioOf(c.width, c.height), provider, n: takes,
          quality: p.pictureQuality !== 'auto' ? p.pictureQuality : undefined, size: p.pictureSize === 'small' ? 'small' : undefined,
          ...(ref ? { reference: ref.reference } : {}),
        }, { what: t('styleFrames.paidText', { n: takes, prompt: clip(scene.idea, 140) }), instead: BUILD_FROM_WORDS });
        made.push(...got);
        meta.push(...got.map(() => ({ direction: d.name, prompt })));
      } catch (e) {
        if (ctx.signal.aborted) throw e;
        stopped = e instanceof Error ? e.message : String(e);
        break;
      }
    }
    if (!made.length) return text(`No style frame could be drawn (${stopped}): ${BUILD_FROM_WORDS}.`);
    const partial = stopped ? ` Drawing stopped there (${stopped}).` : '';

    const keepAt = async (i: number) => {
      const out = await keepFrame(ctx, plan, scene.id, plan.directions.find((d) => d.name === meta[i].direction)!, made[i], meta[i].prompt, made.length > 1 ? i + 1 : undefined);
      return partial ? { ...out, text: `${out.text}${partial}` } : out;
    };
    if (made.length === 1) return keepAt(0);
    // several frames: the user keeps one; alone, the assistant is handed the choice
    const sheet = await takeSheet(made);
    const label = (i: number) => (jobs.length === 1 ? `${meta[i].direction} ${i + 1}` : meta[i].direction);
    const picked = await chooseAmong(t('styleFrames.pickTitle'), t('styleFrames.pickText', { n: made.length, scene: scene.name }), sheet.map((url, i) => ({ url, label: label(i) })));
    if (picked !== null) return keepAt(picked);
    if (!alone()) return { ops: [], text: `The user kept none of the ${made.length} style frames: nothing was saved. Ask what to change in the directions before drawing again.`, images: sheet.map((url, i) => ({ url, caption: label(i) })) };
    const id = holdTakes(made, { scene: scene.id, frames: meta } satisfies HeldFrames);
    return {
      ops: [], label: `Style frames of ${scene.name}`,
      text: `${made.length} style frames for "${scene.name}" (${made.map((_, i) => `${i + 1}: ${label(i)}`).join('; ')}), held for this session (none saved).${partial} Look at them, judge the strongest against its direction and keep it with style-frames { keep: "${id}:<n>" }: it costs nothing more and becomes the film's target.`,
      images: sheet.map((url, i) => ({ url, caption: `${id}:${i + 1} · ${label(i)}` })),
    };
  },
};

export const STYLE_FRAME_TOOLS: ToolType[] = [styleFrames as unknown as ToolType];
