import { describe, expect, it } from 'vitest';
import { CRITIC_SYSTEM, parseVerdict } from '../src/index.ts';

const fix = (n: number) => ({ scene: `Scene ${n}`, what: `change ${n}`, why: `gain ${n}` });

describe('the critic\'s instructions', () => {
  it('start by saying the critic did not make the film, and ask for the level of finish, never the look', () => {
    expect(CRITIC_SYSTEM.split('\n')[0]).toBe('You review a motion design film made by another assistant. You have not seen it being made.');
    expect(CRITIC_SYSTEM).toContain('never the look');
    expect(CRITIC_SYSTEM).toContain('never reward resemblance to any one style');
    expect(CRITIC_SYSTEM).toContain('at most three');
  });

  it('hold the grid: one idea per shot, the subject close, light, restrained type, continuity, palette, density, an ending, and the craft of motion', () => {
    for (const word of ['one idea per shot', 'up close', 'light', 'restrained', 'continuity', 'palette', 'density', 'ending', 'eased', 'staggered']) expect(CRITIC_SYSTEM.toLowerCase(), word).toContain(word);
  });

  it('say the target frame is a level of finish to reach, not content to copy, and ask for strict JSON', () => {
    expect(CRITIC_SYSTEM).toMatch(/target/);
    expect(CRITIC_SYSTEM).toMatch(/not its content/);
    expect(CRITIC_SYSTEM).toContain('"verdict": "done" | "not yet"');
    expect(CRITIC_SYSTEM).toContain('"fixes"');
  });

  it('never name the reference film the level was read from', () => {
    expect(CRITIC_SYSTEM.toLowerCase()).not.toContain('marketing');
    expect(CRITIC_SYSTEM.toLowerCase()).not.toContain('axiom');
  });
});

describe('the verdict', () => {
  it('reads the JSON inside a fenced block', () => {
    const v = parseVerdict(`Here is my review.\n\`\`\`json\n${JSON.stringify({ verdict: 'not yet', score: 6, fixes: [fix(1), fix(2)] })}\n\`\`\``);
    expect(v).toEqual({ verdict: 'not yet', score: 6, fixes: [fix(1), fix(2)] });
  });

  it('reads bare JSON, and JSON after a sentence', () => {
    expect(parseVerdict('{"verdict":"done","score":9,"fixes":[]}')).toEqual({ verdict: 'done', score: 9, fixes: [] });
    expect(parseVerdict('Verdict: {"verdict":"not yet","score":4,"fixes":[{"what":"a","why":"b"}]} thanks').fixes).toEqual([{ what: 'a', why: 'b' }]);
  });

  it('keeps the first three of five fixes, and clamps a score to 1 to 10', () => {
    const v = parseVerdict(JSON.stringify({ verdict: 'not yet', score: 12, fixes: [1, 2, 3, 4, 5].map(fix) }));
    expect(v.fixes.map((f) => f.what)).toEqual(['change 1', 'change 2', 'change 3']);
    expect(v.score).toBe(10);
    expect(parseVerdict('{"verdict":"not yet","score":-3,"fixes":[]}').score).toBe(1);
  });

  it('takes prose with no JSON as not yet, holding the prose', () => {
    const v = parseVerdict('It looks done to me, nice work.');
    expect(v).toEqual({ verdict: 'not yet', score: null, fixes: [], raw: 'It looks done to me, nice work.' });
  });

  it('takes a done verdict with fixes as not yet: a done film has nothing left to fix', () => {
    const v = parseVerdict(JSON.stringify({ verdict: 'done', score: 8, fixes: [fix(1)] }));
    expect(v.verdict).toBe('not yet');
    expect(v.fixes).toHaveLength(1);
  });

  it('drops a fix with no change in it, and keeps the scene it names when it names one', () => {
    const v = parseVerdict(JSON.stringify({ verdict: 'not yet', fixes: [{ scene: 'A', why: 'no what' }, { scene: 'B', what: 'do it', why: 'because' }] }));
    expect(v.fixes).toEqual([{ scene: 'B', what: 'do it', why: 'because' }]);
    expect(v.score).toBeNull();
  });
});
