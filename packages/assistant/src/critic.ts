// The critic: a review of a film by a model that did not make it, in a fresh
// context. Its instructions hold a grid of the level of finish asked, scored
// on axes written in words that hold for any style; its answer is strict
// JSON, parsed here: done only when every axis reaches the bar.

export const CRITIC_SYSTEM = `You review a motion design film made by another assistant. You have not seen it being made.
You are given facts, measures, the plan with timed motion direction, overview rows across the film, detail rows around selected events, and sometimes a target frame. Each row has four labelled frames; time spacing varies. Use the labels to judge the sampled motion. Do not claim to see motion between samples or to hear audio that was not supplied.

Be a harsh director, not a proud author. Most films you see are not finished: "competent", "clean" and "acceptable" are not done. Done means a professional studio or a top channel would put it out as it is.

Judge the level of finish, never the look: a film in any style, palette or genre can reach it. Never ask for a look you prefer, and never reward resemblance to any one style. When a target frame is given, the film reaches its level of finish, not its content: the same subject matter is not asked for. The brief and kept direction say what the film is about and how it should feel; within them, score each axis from 1 to 10:
- idea: one visual idea carries the film and comes back (a motif, a transformation, a device), rather than one literal illustration per sentence.
- composition: every frame is composed on purpose: a clear dominant element, deliberate placement, the frame used to its edges. A small subject lost in a large empty frame is a fault, unless the emptiness is the point and is designed.
- scale: sizes are set against each other within a frame and from one shot to the next: close and wide, huge type and small detail, crops past the edge.
- material: there is something to look at: pictures, objects, textures, real interfaces, light and depth, or graphic work drawn with precision. Plates and words alone score low.
- rhythm: something new happens every 2 to 4 s (a move, a change of scale, a new element, a cut); holds are short and chosen; no dead time. A frame where nothing moves for 4 s or more is a defect.
- motion: moves have weight and ease, overlap, lead and follow; nothing slides linearly or pops without reason.
- finish: no overlap, collision, clipping, blank or flash frame, unreadable or provisional text; the ending lands.
When the film dresses a filmed video (a speaker, footage), also judge it on these axes: the inserts show what is being said at that moment, their forms vary (a logo, footage, a diagram, a number, an interface, words on screen), the speaker's framing changes, and the speaker is never alone on screen for long.
Compare planned beats with their sampled start, peak, destination and settled hold. Name observed timing, framing, overshoot or reading problems at exact timestamps or frames. Do not invent a defect because no sample covers the moment. Sound is optional: judge it only from supplied measurements, never from these images. Measured defects are facts: never argue with them.

Answer with strict JSON and nothing else:
{ "verdict": "done" | "not yet", "score": 1-10, "axes": { "idea": 1-10, "composition": 1-10, "scale": 1-10, "material": 1-10, "rhythm": 1-10, "motion": 1-10, "finish": 1-10 }, "fixes": [{ "scene": "<name>", "what": "<the change, concrete>", "why": "<what it gains>" }] }
The score is the lowest axis. Say "done" only when every axis is 8 or more and you would put the film out as it is: then there is no fix. Otherwise "not yet" with at most three fixes, aimed at the lowest axes, the most important first. Each fix names the observed frame or timestamp, the subject, and a change that can be done in one move. No fix that imposes a look the brief leaves open. When takes of a scene are given, name the best one in "what" of the first fix and say why it beats the others.`;

/** the critic's instructions with the faults it is to name when it sees them (their titles, one line each) */
export const criticSystem = (faults: string[]): string => (faults.length ? `${CRITIC_SYSTEM}\n\nFaults to name when you see them:\n${faults.map((f) => `- ${f}`).join('\n')}` : CRITIC_SYSTEM);

export interface Fix { scene?: string; what: string; why: string }
/** the axes the critic scores, each from 1 to 10 */
export const CRITIC_AXES = ['idea', 'composition', 'scale', 'material', 'rhythm', 'motion', 'finish'] as const;
export type Axis = (typeof CRITIC_AXES)[number];
/** a film is done only when every axis it was scored on reaches this */
export const DONE_BAR = 8;
export interface Verdict { verdict: 'done' | 'not yet'; score: number | null; fixes: Fix[]; axes?: Partial<Record<Axis, number>>; raw?: string }

/** the first JSON object in a text that parses, a fenced block first */
function jsonIn(text: string): Record<string, unknown> | null {
  const candidates: string[] = [];
  for (const m of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) candidates.push(m[1]);
  candidates.push(text);
  for (const c of candidates) {
    for (let start = c.indexOf('{'); start >= 0; start = c.indexOf('{', start + 1)) {
      let depth = 0, inString = false;
      for (let i = start; i < c.length; i++) {
        const ch = c[i];
        if (inString) { if (ch === '\\') i++; else if (ch === '"') inString = false; continue; }
        if (ch === '"') inString = true;
        else if (ch === '{') depth++;
        else if (ch === '}' && --depth === 0) {
          try {
            const parsed = JSON.parse(c.slice(start, i + 1));
            if (parsed && typeof parsed === 'object' && 'verdict' in parsed) return parsed as Record<string, unknown>;
          } catch { /* not this one */ }
          break;
        }
      }
    }
  }
  return null;
}

/**
 * The critic's answer as a verdict. A done verdict that still lists a fix, or
 * with an axis under the bar, is "not yet" (a done film has nothing left to
 * fix); more than three fixes are cut to three; a score is held to 1 to 10,
 * and is the lowest axis when axes are given. An answer with no JSON, "done"
 * in prose included, is "not yet" with the prose kept.
 */
export function parseVerdict(text: string): Verdict {
  const j = jsonIn(text);
  if (!j) return { verdict: 'not yet', score: null, fixes: [], raw: text.trim() };
  const fixes: Fix[] = (Array.isArray(j.fixes) ? j.fixes : [])
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object' && typeof (f as { what?: unknown }).what === 'string' && !!(f as { what: string }).what.trim())
    .slice(0, 3)
    .map((f) => ({ ...(typeof f.scene === 'string' && f.scene ? { scene: f.scene } : {}), what: String(f.what).trim(), why: typeof f.why === 'string' ? f.why.trim() : '' }));
  const clamp = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : null);
  const given = j.axes && typeof j.axes === 'object' ? (j.axes as Record<string, unknown>) : {};
  const axes: Partial<Record<Axis, number>> = {};
  for (const a of CRITIC_AXES) { const n = clamp(given[a]); if (n !== null) axes[a] = n; }
  const scored = Object.values(axes);
  const score = scored.length ? Math.min(...scored) : clamp(j.score);
  const done = typeof j.verdict === 'string' && j.verdict.trim().toLowerCase() === 'done' && fixes.length === 0 && scored.every((n) => n >= DONE_BAR);
  return { verdict: done ? 'done' : 'not yet', score, fixes, ...(scored.length ? { axes } : {}) };
}
