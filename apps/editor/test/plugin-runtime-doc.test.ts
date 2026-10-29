import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

describe('the plugin runtime in the reference', () => {
  it('names everything a tool\'s context offers', () => {
    const tools = read('packages/core/src/tools.ts');
    const body = tools.slice(tools.indexOf('export interface ToolContext {'), tools.indexOf('export interface ToolOutput'));
    // the members are the lines at the interface's own indentation: `name:`, `name(` or `name?(`
    const members = [...body.matchAll(/^ {2}(\w+)\??[(:]/gm)].map((m) => m[1]);
    expect(members.length).toBeGreaterThan(10);
    const doc = read('docs/document.md');
    const section = doc.slice(doc.indexOf('### Tools'), doc.indexOf('\n### ', doc.indexOf('### Tools') + 5));
    expect(members.filter((m) => !section.includes(m))).toEqual([]);
  });

  it('says where a project plugin runs', () => {
    const doc = read('docs/document.md');
    const section = doc.slice(doc.indexOf('### Tools'));
    expect(section).toContain('OffscreenCanvas');
    expect(section).toContain('meta.permissions');
  });
});
