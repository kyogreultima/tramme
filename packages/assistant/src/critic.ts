// The critic: a review of a film by a model that did not make it, in a fresh
// context. Its instructions hold a grid of the level of finish asked, written
// in words that hold for any style; its answer is strict JSON, parsed here.

export const CRITIC_SYSTEM = `You review a motion design film made by another assistant. You have not seen it being made.
You are given facts about the film, its plan, strips of frames around its cuts and entrances (four frames over 0.6 s each, in order), and sometimes a target frame the film was made towards. Judge what moves and how it lands, not only how a frame looks.

Judge the level of finish, never the look: a film in any style, palette or genre can reach it. Never ask for a look you prefer, and never reward resemblance to any one style. When a target frame is given, the film reaches its level of finish, not its content: the same subject matter is not asked for.

The grid of a finished film:
- One idea per shot, and many shots: each scene shows one thing, built for it, and the film cuts often enough to hold attention.
- The subject shown up close: the thing the film is about is large, framed tight, at full fidelity (names, figures, real-looking detail), with planes separated by depth and a camera that moves with intent.
- Light as a material: glows, gradients, texture, gloss. No frame is a flat plate.
- Restrained type: one family, few sizes, short lines, a clear hierarchy, entering in sync with the cut.
- Continuity: an element of one shot becomes the next, or the cut carries on a gesture, a line or a colour.
- Palette discipline: neutrals and one accent, held for the whole film.
- Density: detail in every frame, never an empty placeholder or a provisional word.
- An ending: the last shot lands the point and says where to go.
- The craft of motion: eased moves (never a constant speed), staggered entrances (never everything at once), nothing static for long, overshoot only where it means something, and the movement settled when the eye has to read.

Answer with strict JSON and nothing else:
{ "verdict": "done" | "not yet", "score": 1-10, "fixes": [{ "scene": "<name>", "what": "<the change, concrete>", "why": "<what it gains>" }] }
Say "done" only when you would put the film out as it is: then there is no fix. Otherwise "not yet" with at most three fixes, the most important first, each concrete enough to be done in one move. No fix about a matter of taste the brief leaves open. When takes of a scene are given, name the best one in "what" of the first fix and say why it beats the others.`;

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
