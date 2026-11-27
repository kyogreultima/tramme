// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { Manifest } from '@tramme/project';
import { t } from '../src/i18n/index.ts';
import { S } from '../src/state.ts';

let release: () => void = () => {};
const calls: string[][] = [];
const movedHere: string[] = [];
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
  stillThere: vi.fn(async (project: Manifest) => project.id !== 'gone'),
  moveHere: vi.fn(async (project: Manifest, resume?: boolean) => {
    movedHere.push(resume ? `${project.id} resumed` : project.id);
    if (project.id === 'cloud-b') throw new Error('disk full');
    return project;
  }),
}));

const { bringing, bringInBackground, isMoving, moveInBackground, resumeMoves } = await import('../src/ui/BringDialog.tsx');

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

  it('moves an account project to the computer without keeping a modal open', async () => {
    const done = vi.fn();
    moveInBackground({ ...m('cloud-a'), cloud: true } as Manifest, done);

    expect(bringing.value.at).toEqual({ done: 0, total: 1, name: 'CLOUD-A' });
    await vi.waitFor(() => expect(bringing.value.at).toBeNull());
    expect(movedHere).toEqual(['cloud-a']);
    expect(bringing.value.failed).toEqual([]);
    expect(done).toHaveBeenCalledOnce();
  });

  it('keeps a failed account-to-computer move available for retry', async () => {
    moveInBackground({ ...m('cloud-b'), cloud: true } as Manifest);

    await vi.waitFor(() => expect(bringing.value.at).toBeNull());
    expect(bringing.value.failed.map((project) => project.id)).toEqual(['cloud-b']);
  });

  it('keeps what it moves for the next page, which takes it up, and never opens it meanwhile', async () => {
    moveInBackground({ ...m('cloud-a'), cloud: true } as Manifest);
    expect(JSON.parse(sessionStorage.getItem('tramme.moving')!).map((p: Manifest) => p.id)).toEqual(['cloud-a']);
    expect(isMoving('cloud-a')).toBe(true);
    await vi.waitFor(() => expect(bringing.value.at).toBeNull());
    expect(sessionStorage.getItem('tramme.moving')).toBeNull();
    expect(isMoving('cloud-a')).toBe(false);

    sessionStorage.setItem('tramme.moving', JSON.stringify([{ ...m('cloud-c'), cloud: true }, { ...m('gone'), cloud: true }]));
    await resumeMoves();
    await vi.waitFor(() => expect(bringing.value.at).toBeNull());
    expect(movedHere.at(-1)).toBe('cloud-c resumed');
  });

  it('tells what can be done next: open the moved project, or try again', async () => {
    S.toasts.value = [];
    moveInBackground({ ...m('cloud-a'), cloud: true } as Manifest);
    await vi.waitFor(() => expect(S.toasts.value.at(-1)?.action?.label).toBe(t('common.open')));
    moveInBackground({ ...m('cloud-b'), cloud: true } as Manifest);
    await vi.waitFor(() => expect(S.toasts.value.at(-1)?.action?.label).toBe(t('account.bring.retry')));
  });
});
