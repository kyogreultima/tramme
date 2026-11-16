// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { Manifest } from '@tramme/project';

let release: () => void = () => {};
const calls: string[][] = [];
vi.mock('../src/bring.ts', async (original) => ({
  ...(await original<typeof import('../src/bring.ts')>()),
  bring: vi.fn(async (projects: Manifest[], progress: (done: number, total: number, name: string) => void) => {
    calls.push(projects.map((p) => p.id));
    progress(0, projects.length, projects[0].name);
    await new Promise<void>((r) => { release = r; });
    progress(1, projects.length, projects[1]?.name ?? '');
    const failed = projects.filter((p) => p.id === 'b').map((p) => ({ id: p.id, name: p.name, error: 'quota' }));
    return { brought: projects.filter((p) => p.id !== 'b'), failed };
  }),
}));

const { bringing, bringInBackground } = await import('../src/ui/BringDialog.tsx');

const m = (id: string) => ({ id, name: id.toUpperCase() }) as Manifest;

describe('bringing projects into the account behind the page', () => {
  it('says where it is, keeps what failed, and tries those again', async () => {
    const done = vi.fn();
    bringInBackground([m('a'), m('b')], done);
    expect(bringing.value.at).toEqual({ done: 0, total: 2, name: 'A' });
    // a second ask while one runs waits for it
    bringInBackground([m('c')]);
    expect(calls).toEqual([['a', 'b']]);

    release();
    await vi.waitFor(() => expect(bringing.value.at).toBeNull());
    expect(bringing.value.failed.map((p) => p.id)).toEqual(['b']);
    expect(done).toHaveBeenCalledOnce();

    bringInBackground(bringing.value.failed);
    expect(calls).toEqual([['a', 'b'], ['b']]);
    release();
    await vi.waitFor(() => expect(bringing.value.at).toBeNull());
    // the list is shown again after a retry too
    expect(done).toHaveBeenCalledTimes(2);
  });
});
