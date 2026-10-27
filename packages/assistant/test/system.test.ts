import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { joinSystem, systemParts, systemPrompt } from '../src/index.ts';

const REF = '# Reference\n\nThe document format.\n\nMore of the reference.';

/** the paragraphs of a prompt, order aside */
const paragraphs = (s: string) => s.replace(/\r\n/g, '\n').split('\n\n').filter(Boolean).sort();

/** what systemPrompt(REF, 'BRIEF', ['plug: x']) returned before the reference moved ahead of the project's parts */
const BEFORE = fs.readFileSync(new URL('./fixtures/system-before.txt', import.meta.url), 'utf8');

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
