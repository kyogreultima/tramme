// The film checked against the reading of its reference, for the critic:
// the structure measured (scenes, lengths, cuts on the beats, slots, moves,
// transitions), the reference's words looked for in the film, and a frame of
// the reference beside the film's at the middle of each scene, so the critic
// judges whether they read as the same video.

import { contentIssues, READINGS_DIR, retime, type StructureIssue, structureIssues, type ToolContext } from '@tramme/core';
import { BRIEF_PATH } from '../brief.ts';
import type { FilmPlan } from '../filmplan.ts';
import { userMusic } from '../filmplan.ts';
import { canvas, loadImage } from '../perception.ts';
import { builtScenes, filmTexts } from './built.ts';
import { openGif, openVideo } from './frames.ts';
import { readingOf } from './tool.ts';

export interface AgainstReference {
  issues: StructureIssue[];
  /** the reference's frame (left) beside the film's (right), per scene, as JPEG data URLs, with their captions */
  pairs: { url: string; caption: string }[];
}

/** at most this many pairs go to the critic */
const PAIRS = 6;

/** the film against its reading; null when the plan follows no reading the project holds */
export async function againstReference(ctx: ToolContext, plan: FilmPlan): Promise<AgainstReference | null> {
  if (!plan.reference) return null;
  const reading = await readingOf(ctx, plan.reference);
  if (!reading) return null;
  const built = builtScenes(ctx.doc, ctx.registry, plan, reading);
  const timing = retime(reading, await userMusic(ctx));
  // the user's own words: the brief and the names of their assets (never a reference's, nor its reading's, named after it)
  const own = [await ctx.readText(BRIEF_PATH).catch(() => null) ?? '', ...Object.values(ctx.doc.assets).filter((a) => !a.reference && !a.src.startsWith(`${READINGS_DIR}/`)).map((a) => a.name ?? '')].join(' ');
  const issues: StructureIssue[] = [
    ...structureIssues(reading, built, timing),
    ...contentIssues(reading.texts, filmTexts(ctx.doc), own).map((line) => ({ line, blocking: true })),
  ];
  // the pairs: a frame of the reference and of the film at the middle of each scene, a few scenes evenly through the film
  const pairs: AgainstReference['pairs'] = [];
  const ref = ctx.doc.assets[reading.source];
  if (ref && reading.from === 'video') {
    const step = Math.max(1, Math.ceil(built.length / PAIRS)), chosen = built.filter((_, i) => i % step === 0).slice(0, PAIRS);
    const w = 320, h = Math.max(1, Math.round((w * reading.height) / reading.width));
    const src = await (/\.gif$/i.test(ref.src) ? openGif(ctx.assetUrl(reading.source)) : openVideo(ctx.assetUrl(reading.source))).catch(() => null);
    if (src) {
      try {
        const times = chosen.map((b) => { const s = reading.scenes.find((x) => x.id === b.follows)!; return (s.start + s.end) / 2; });
        let i = 0;
        for await (const frame of src.frames(times, w, h)) {
          const b = chosen[i++];
          if (!frame) continue;
          const still = await loadImage(await ctx.renderStill((b.start + b.end) / 2, ctx.doc.root)).catch(() => null);
          const { c, g } = canvas(w * 2 + 8, h);
          g.drawImage(frame, 0, 0, w, h);
          if (still) g.drawImage(still, w + 8, 0, w, h);
          pairs.push({ url: c.toDataURL('image/jpeg', 0.82), caption: `${b.follows}: the reference (left), the film (right) at the middle of the scene` });
        }
      } finally { src.dispose(); }
    }
  }
  return { issues, pairs };
}
