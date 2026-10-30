import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { joinSystem, systemParts, systemPrompt } from '../src/index.ts';

const REF = '# Reference\n\nThe document format.\n\nMore of the reference.';

/** the paragraphs of a prompt, order aside */
const paragraphs = (s: string) => s.replace(/\r\n/g, '\n').split('\n\n').filter(Boolean).sort();

/** what systemPrompt(REF, 'BRIEF', ['plug: x']) returned before the reference moved ahead of the project's parts (LF, whatever the checkout wrote) */
const BEFORE = fs.readFileSync(new URL('./fixtures/system-before.txt', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('the system prompt in cache order', () => {
  it('the fixed part holds no project', () => {
    const { fixed, variable } = systemParts(REF, 'BRIEF', ['plug: x']);
    expect(fixed).toContain(REF);
    expect(fixed).not.toContain('BRIEF');
    expect(fixed).not.toContain('plug: x');
    expect(variable).toContain('BRIEF');
    expect(variable).toContain('plug: x');
  });

  it('the fixed part is the same for every project', () => {
    expect(systemParts(REF).fixed).toBe(systemParts(REF, 'BRIEF', ['plug: x']).fixed);
    expect(systemParts(REF).variable).toBe('');
  });

  it('says the same words as before, the reference first', () => {
    const p = systemPrompt(REF, 'BRIEF', ['plug: x']);
    expect(paragraphs(p)).toEqual(paragraphs(BEFORE));
    expect(p).not.toBe(BEFORE);
    expect(p.indexOf(REF)).toBeLessThan(p.indexOf('BRIEF'));
    expect(p.indexOf(REF)).toBeLessThan(p.indexOf('plug: x'));
    // the instructions come first, untouched
    expect(p.startsWith(BEFORE.slice(0, BEFORE.indexOf('Plugins installed on this device')).trimEnd())).toBe(true);
  });

  it('joins the two parts, and is the fixed part alone without a project', () => {
    const parts = systemParts(REF, 'BRIEF');
    expect(joinSystem(parts)).toBe(`${parts.fixed}\n\n${parts.variable}`);
    expect(systemPrompt(REF)).toBe(systemParts(REF).fixed);
    expect(systemPrompt(REF, 'BRIEF')).toBe(joinSystem(parts));
  });
});

describe('the film plan in the prompt', () => {
  it('rides in the variable part, and leaves the fixed part to the cache', () => {
    const { fixed, variable } = systemParts(REF, undefined, [], [], 'PLAN TEXT');
    expect(variable).toContain('The film plan of the project (assets/film-plan.json)');
    expect(variable).toContain('PLAN TEXT');
    expect(fixed).not.toContain('PLAN TEXT');
    expect(fixed).toBe(systemParts(REF).fixed);
  });

  it('follows the brief, and is absent without a plan', () => {
    const { variable } = systemParts(REF, 'BRIEF', [], [], 'PLAN TEXT');
    expect(variable.indexOf('BRIEF')).toBeLessThan(variable.indexOf('PLAN TEXT'));
    expect(systemParts(REF, 'BRIEF').variable).not.toContain('film plan');
    expect(systemPrompt(REF, 'BRIEF', [], [], 'PLAN TEXT')).toBe(joinSystem(systemParts(REF, 'BRIEF', [], [], 'PLAN TEXT')));
  });
});

describe('the direction rules', () => {
  const { fixed } = systemParts(REF);
  const direction = fixed.slice(fixed.indexOf('Direction:'), fixed.indexOf('Whole films:'));

  it('sit before the rules of whole films and name the plan, the frames and the target', () => {
    expect(fixed.indexOf('Direction:')).toBeGreaterThan(-1);
    expect(fixed.indexOf('Direction:')).toBeLessThan(fixed.indexOf('Whole films:'));
    for (const word of ['film-plan', 'kinds of picture', 'style-frames', 'target', 'never placed', 'retyped', 'use_tool "compare"']) expect(direction, word).toContain(word);
  });

  it('keep the example as one kind among the others, and name the style frames where the directions are proposed', () => {
    expect(direction).toContain('one kind among the others');
    expect(fixed.slice(fixed.indexOf('Sources:'))).toContain('style-frames');
  });
});

describe('the depth and camera rules', () => {
  const { fixed } = systemParts(REF);
  const depth = fixed.slice(fixed.indexOf('Depth and camera:'), fixed.indexOf('Repetition:'));

  it('sit after the motion rules and name the tilts, the pin, the push, the screens of pieces and the solids', () => {
    expect(fixed.indexOf('Depth and camera:')).toBeGreaterThan(fixed.indexOf('Motion:'));
    for (const word of ['rotationX', 'rotationY', 'pin', 'push-in', 'device-screen', 'screen', 'solid.3d']) expect(depth, word).toContain(word);
  });
});

describe('the material rules', () => {
  const { fixed } = systemParts(REF);
  const material = fixed.slice(fixed.indexOf('Material:'), fixed.indexOf('Clips:'));

  it('sit between the pictures and the clips and name the object, the surface, the libraries, the credits and the yes', () => {
    expect(fixed.indexOf('Material:')).toBeGreaterThan(fixed.indexOf('Pictures:'));
    expect(fixed.indexOf('Material:')).toBeLessThan(fixed.indexOf('Clips:'));
    for (const word of ['object', 'surface', 'stock', 'credits', 'wordmark', "the user's yes", 'solid.3d']) expect(material, word).toContain(word);
  });

  it('leave the pictures to what is drawn from words', () => {
    const pictures = fixed.slice(fixed.indexOf('Pictures:'), fixed.indexOf('Material:'));
    expect(pictures).not.toContain('a texture, an illustration, a prop');
  });
});

describe('the packs\' entries in the prompt', () => {
  const LINE = 'ui.device (UI walkthrough): a phone, browser or window frame around an interface';

  it('ride in the fixed part, after the reference, and not in the variable one', () => {
    const { fixed, variable } = systemParts(REF, 'BRIEF', undefined, [LINE]);
    expect(fixed).toContain(LINE);
    expect(fixed).toContain("Entries of the editor's packs, by need");
    expect(fixed.indexOf(LINE)).toBeGreaterThan(fixed.indexOf(REF));
    expect(variable).not.toContain(LINE);
  });

  it('keep the fixed part the same for every project', () => {
    expect(systemParts(REF, 'ONE', ['plug: x'], [LINE]).fixed).toBe(systemParts(REF, 'TWO', undefined, [LINE]).fixed);
  });

  it('change nothing without packs', () => {
    expect(systemParts(REF, 'BRIEF', ['plug: x'], []).fixed).toBe(systemParts(REF, 'BRIEF', ['plug: x']).fixed);
    expect(systemParts(REF).fixed).not.toContain('Entries of the editor');
  });
});

describe('the finish rules', () => {
  const { fixed } = systemParts(REF);
  const finish = fixed.slice(fixed.indexOf('Finish:'), fixed.indexOf('Motion:'));

  it('say to search the vocabulary before writing a plugin', () => {
    expect(finish).toContain('search the vocabulary');
    expect(finish).toContain('two or three words');
    expect(finish).toContain('what you searched');
  });

  it('say a warning is fixed or raised, never dismissed', () => {
    expect(finish).toContain('never dismissed');
    expect(finish).toContain('fix the cause once');
  });

  it('say how long the speaker may be alone on screen', () => {
    expect(finish).toContain('20 s');
  });

  it('say the plugins written are listed to the user for the library', () => {
    expect(finish).toContain('library');
  });
});

describe('the type rules', () => {
  const { fixed } = systemParts(REF);
  const type = fixed.slice(fixed.indexOf('Type:'), fixed.indexOf('Motion:'));

  it('sit before the motion rules and say never to leave the system font', () => {
    expect(fixed.indexOf('Type:')).toBeGreaterThan(fixed.indexOf('Finish:'));
    expect(fixed.indexOf('Type:')).toBeLessThan(fixed.indexOf('Motion:'));
    expect(type).toContain('never the system font');
  });

  it('say to look for a typeface, look at the specimen, and bring it in', () => {
    for (const word of ['typefaces', 'specimen', 'typeface-use']) expect(type, word).toContain(word);
  });

  it('say to pair a display face with a text face, never more than two', () => {
    expect(type).toContain('display face');
    expect(type).toContain('text face');
    expect(type).toContain('never more than two');
  });
});

describe('the finish rules', () => {
  it('hold the critic, the takes, the rounds and the three things', () => {
    const { fixed } = systemParts(REF);
    const finish = fixed.slice(fixed.indexOf('Finish:'), fixed.indexOf('Type:'));
    for (const word of ['critique', 'three things', 'scene-takes', 'rounds']) expect(finish, word).toContain(word);
  });
});

describe('the scene-by-scene rules', () => {
  it('sit in the whole films and name the end of a scene builder, the scenes built apart, the brief of each scene and the assembly', () => {
    const { fixed } = systemParts(REF);
    const films = fixed.slice(fixed.indexOf('Whole films:'), fixed.indexOf('Dressing a video'));
    for (const word of ['scene-done', 'built apart', 'brief of each scene', 'assemble']) expect(films, word).toContain(word);
  });
});
