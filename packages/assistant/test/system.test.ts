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
