// The critic: a review of a film by a model that did not make it, in a fresh
// context. Its instructions hold a grid of the level of finish asked, written
// in words that hold for any style; its answer is strict JSON, parsed here.

export const CRITIC_SYSTEM = `You review a motion design film made by another assistant. You have not seen it being made.
You are given facts, the plan with timed motion direction, overview rows across the film, detail rows around selected events, and sometimes a target frame. Each row has four labelled frames; time spacing varies. Use the labels to judge the sampled motion. Do not claim to see motion between samples or to hear audio that was not supplied.

Judge the level of finish, never the look: a film in any style, palette or genre can reach it. Never ask for a look you prefer, and never reward resemblance to any one style. When a target frame is given, the film reaches its level of finish, not its content: the same subject matter is not asked for.

The brief and kept direction define success; they outrank any general craft preference:
- Each shot communicates its intended idea. A single shot or a long hold is valid when it serves that idea.
- Subjects, framing, light and materials match the requested treatment. Flat graphics and empty space are valid; do not prescribe depth, gloss, texture, density or camera motion as universal requirements.
- Type communicates a readable hierarchy through size, weight, position or timing; do not require a particular family count.
- Palette and continuity follow the direction. A rich palette, a hard cut, simultaneous motion or constant speed can be intentional.
- Compare planned beats with their sampled start, peak, destination and settled hold. Name observed timing, framing, overshoot or reading problems at exact timestamps or frames. Do not invent a defect because no sample covers the moment.
- Sound is optional. Judge it only from supplied measurements, never from these images.
- The ending serves the piece: a loop returns to its opening; other films may end on a hold rather than a call to action.
- Missing media, provisional content and measured unreadable text are defects in any style.

Answer with strict JSON and nothing else:
{ "verdict": "done" | "not yet", "score": 1-10, "fixes": [{ "scene": "<name>", "what": "<the change, concrete>", "why": "<what it gains>" }] }
Say "done" only when you would put the film out as it is: then there is no fix. Otherwise "not yet" with at most three fixes, the most important first. Each fix names the observed frame or timestamp, the subject, and a measurable change that can be done in one move. No fix about a matter of taste the brief leaves open. When takes of a scene are given, name the best one in "what" of the first fix and say why it beats the others.`;

/** the critic's instructions with the faults it is to name when it sees them (their titles, one line each) */
export const criticSystem = (faults: string[]): string => (faults.length ? `${CRITIC_SYSTEM}\n\nFaults to name when you see them:\n${faults.map((f) => `- ${f}`).join('\n')}` : CRITIC_SYSTEM);

export interface Fix { scene?: string; what: string; why: string }
export interface Verdict { verdict: 'done' | 'not yet'; score: number | null; fixes: Fix[]; raw?: string }

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
 * The critic's answer as a verdict. A done verdict that still lists a fix is
 * "not yet" (a done film has nothing left to fix); more than three fixes are
 * cut to three; a score is held to 1 to 10. An answer with no JSON, "done" in
 * prose included, is "not yet" with the prose kept.
 */
export function parseVerdict(text: string): Verdict {
  const j = jsonIn(text);
  if (!j) return { verdict: 'not yet', score: null, fixes: [], raw: text.trim() };
  const fixes: Fix[] = (Array.isArray(j.fixes) ? j.fixes : [])
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object' && typeof (f as { what?: unknown }).what === 'string' && !!(f as { what: string }).what.trim())
    .slice(0, 3)
    .map((f) => ({ ...(typeof f.scene === 'string' && f.scene ? { scene: f.scene } : {}), what: String(f.what).trim(), why: typeof f.why === 'string' ? f.why.trim() : '' }));
  const score = typeof j.score === 'number' && Number.isFinite(j.score) ? Math.min(10, Math.max(1, j.score)) : null;
  const done = typeof j.verdict === 'string' && j.verdict.trim().toLowerCase() === 'done' && fixes.length === 0;
  return { verdict: done ? 'done' : 'not yet', score, fixes };
}
