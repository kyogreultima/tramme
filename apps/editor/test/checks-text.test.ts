// @vitest-environment happy-dom
// What a proposal's answer says of the checks: the counts and the first warnings, never the notes.
import { describe, expect, it, vi } from 'vitest';
import type { QualityIssue, ToolContext } from '@tramme/core';
import { newProject } from '@tramme/project';

const found = vi.hoisted(() => ({ issues: [] as QualityIssue[] }));
vi.mock('../src/isolated-checks.ts', () => ({ qualityChecksOf: async () => found.issues }));
vi.mock('../src/perception.ts', async (original) => ({ ...(await original<typeof import('../src/perception.ts')>()), analyses: async () => () => null }));

const { checksText } = await import('../src/review.ts');
const { doc } = newProject({ name: 'T', width: 640, height: 360, fps: 30, duration: 4 });
const ctx = { doc, compId: doc.root } as unknown as ToolContext;
const issue = (check: string, severity: 'warning' | 'info', message: string): QualityIssue => ({ check, severity, message } as QualityIssue);

describe('the checks in a proposal answer', () => {
  it('count everything and show the first warnings only', async () => {
    found.issues = [
      ...['a', 'b', 'c', 'd', 'e', 'f'].map((k) => issue(`kind-${k}`, 'warning', `problem ${k}`)),
      issue('crowd', 'info', 'four things appear together'),
    ];
    const text = await checksText(ctx);
    expect(text).toMatch(/^6 warning\(s\), 1 note\(s\)\./);
    expect(text).toContain('problem a');
    expect(text).not.toContain('problem e');
    expect(text).not.toContain('four things appear together');
    expect(text).toContain('(2 more kinds of warning: use_tool "check")');
  });

  it('say so plainly when nothing is found', async () => {
    found.issues = [];
    expect(await checksText(ctx)).toBe('No issue found by the checks.');
  });
});
