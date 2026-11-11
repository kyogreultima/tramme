// @vitest-environment happy-dom
// A proposal's answer carries the picture's quality checks of its composition,
// so the model reads what is wrong without another call; checks that cannot run
// leave the answer as it was.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrammeDoc } from '@tramme/core';

const checks = vi.hoisted(() => ({ text: vi.fn(async () => '1 warning.\n- "title" is cut at the right edge') }));
vi.mock('../src/review.ts', async (original) => ({ ...(await original<typeof import('../src/review.ts')>()), checksText: checks.text }));

await import('../src/ai/index.ts'); // first: the engine and the runner import each other
const { ToolRunner } = await import('../src/ai/tools.ts');
const { load } = await import('../src/state.ts');
const { newProject } = await import('@tramme/project');

function open() {
  const project = newProject({ name: 'T', width: 640, height: 360, fps: 30, duration: 4 });
  load(project.doc as TrammeDoc, project.manifest, 'http://localhost/api/projects/p/files/document.tramme.json', '');
}
const add = { label: 'a box', ops: [{ op: 'add', path: '/compositions/main/layers/a', value: { type: 'shape.rect' } }, { op: 'add', path: '/compositions/main/order/-', value: 'a' }] };
const said = (r: { content: { type: string; text?: string }[] }) => r.content[0].text ?? '';

afterEach(() => checks.text.mockClear());

describe("a proposal's answer", () => {
  it('carries the checks of its composition', async () => {
    open();
    const runner = new ToolRunner();
    const out = await runner.run('propose_changes', add);
    expect(out.isError).toBeFalsy();
    expect(said(out)).toMatch(/^Proposal "a box" ready/);
    expect(said(out)).toContain('Checks of "main" with it: 1 warning.\n- "title" is cut at the right edge');
    runner.dispose();
  });

  it('stays as it was when the checks cannot run, and is not checked when refused', async () => {
    open();
    const runner = new ToolRunner();
    checks.text.mockRejectedValueOnce(new Error('no preview'));
    const out = await runner.run('propose_changes', add);
    expect(out.isError).toBeFalsy();
    expect(said(out)).not.toContain('Checks of');
    checks.text.mockClear();
    const refused = await runner.run('propose_changes', { label: 'bad', ops: [{ op: 'replace', path: '/nowhere/at/all', value: 1 }] });
    expect(refused.isError).toBe(true);
    expect(checks.text).not.toHaveBeenCalled();
    runner.dispose();
  });
});
