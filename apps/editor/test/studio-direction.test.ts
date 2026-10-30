// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { newProject } from '@tramme/project';
import type { FilmPlan } from '../src/filmplan.ts';
import type { Manifest } from '../src/api.ts';

const { api } = await import('../src/api.ts');
const { stageOf } = await import('../src/studio.ts');
const { studio } = await import('../src/studio.ts');
const { draft } = await import('../src/attachments.ts');
const { Direction } = await import('../src/ui/Direction.tsx');
const { FILM_PLAN_PATH, PICTURE_KINDS } = await import('../src/filmplan.ts');
const { S } = await import('../src/state.ts');
const { t } = await import('../src/i18n/index.ts');

const plan = (o: Partial<FilmPlan> = {}): FilmPlan => ({
  version: 1, kind: 'film-plan', updated: '', idea: 'A launch film for a note app.', kinds: ['type', 'interface', 'data'],
  scenes: [{ id: 'noise', name: 'The noise', kind: 'type', idea: 'one huge word' }, { id: 'app', name: 'The app', kind: 'interface', idea: 'the editor' }, { id: 'proof', name: 'The proof', kind: 'data', idea: 'a counter' }],
  directions: [], ...o,
});

let host: HTMLElement;
const mount = async () => { await act(() => { render(h(Direction, {}), host); }); await act(async () => { await Promise.resolve(); }); };
const reading = (film: FilmPlan | null) => {
  vi.spyOn(api, 'readText').mockImplementation(async (_id: string, path: string) => (path === FILM_PLAN_PATH && film ? ({ text: JSON.stringify(film) } as never) : null));
  vi.spyOn(api, 'info').mockResolvedValue({ files: [] } as never);
};

const was = { doc: S.doc.peek(), project: S.project.peek() };
beforeEach(() => {
  host = document.body.appendChild(document.createElement('div'));
  S.project.value = { id: 'p1' } as Manifest;
  S.doc.value = newProject({ name: 'Plan', width: 1920, height: 1080, fps: 30, duration: 10 }).doc;
});
afterEach(() => { render(null, host); host.remove(); vi.restoreAllMocks(); S.doc.value = was.doc; S.project.value = was.project; });

describe('the stages of the film plan', () => {
  it('count the film plan and the style frames as directing', () => {
    expect(stageOf({ tool: { name: 'use_tool', summary: '', use: 'style-frames' } } as never)).toBe('direct');
    expect(stageOf({ tool: { name: 'use_tool', summary: '', use: 'film-plan' } } as never)).toBe('direct');
    expect(stageOf({ tool: { name: 'use_tool', summary: '', use: 'check' } } as never)).toBe('review');
  });
});

describe('the direction panel', () => {
  it('shows the target, the idea and each scene with its kind', async () => {
    reading(plan({ target: 'assets/frames/the-app-ink.jpg' }));
    await mount();
    const img = host.querySelector('.dir-plan img') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe(api.fileUrl(S.project.peek().id, 'assets/frames/the-app-ink.jpg'));
    expect(host.textContent).toContain('A launch film for a note app.');
    const rows = [...host.querySelectorAll('.dir-scenes li')];
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('The noise');
    expect(rows[0].textContent).toContain(t('studio.kinds.type'));
    expect(rows[1].textContent).toContain(t('studio.kinds.interface'));
  });

  it('shows the plan without a target when no frame is kept', async () => {
    reading(plan());
    await mount();
    expect(host.querySelector('.dir-plan')).toBeTruthy();
    expect(host.querySelector('.dir-plan img')).toBeNull();
  });

  it('is absent without a plan', async () => {
    reading(null);
    await mount();
    expect(host.querySelector('.dir-plan')).toBeNull();
    expect(host.querySelector('.dir-section')).toBeTruthy();
  });

  it('puts the words for other frames in the direction bar', async () => {
    reading(plan());
    await mount();
    await act(() => { (host.querySelector('.dir-plan button') as HTMLButtonElement).click(); });
    expect(draft.value).toBe(t('studio.direction.otherFramesWords'));
    expect(studio.panel.value).toBe('notes');
  });

  it('names every kind of picture in both languages', () => {
    for (const kind of PICTURE_KINDS) expect(t(`studio.kinds.${kind}`), kind).not.toBe(`studio.kinds.${kind}`);
  });
});

describe('the scenes built apart, in the notes', () => {
  const item = (id: string, extra: object): import('../src/api.ts').ChatItem => ({ id, role: 'assistant', ...extra }) as never;
  const usage = { requests: 1, input: 1, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 1, tools: 0, images: 0, ms: 1, model: 'm', route: 'server' as const };
  const tool = (id: string, building: string | undefined, done: boolean) => item(id, { tool: { name: 'propose_changes', summary: 'adding', done }, building });

  it('liveScene is the scene being built now, and null once its usage line came', async () => {
    const { liveScene } = await import('../src/studio.ts');
    expect(liveScene([tool('a', 'Price', false)])).toBe('Price');
    expect(liveScene([tool('a', 'Price', true), item('u', { usage: { ...usage, scene: 'Price' }, building: 'Price' })])).toBeNull();
    expect(liveScene([tool('a', undefined, false)])).toBeNull();
    expect(liveScene([tool('a', 'Price', true), item('u', { usage: usage, building: 'Price' }), tool('b', 'Proof', false)])).toBe('Proof');
  });

  it('the thread shows a heading per scene, its name alone, in order, and the plain work as before', async () => {
    const { Work } = await import('../src/ui/thread.tsx');
    const work = [
      item('t0', { text: 'The plan is written.' }),
      tool('a', 'Price', true), item('ta', { text: 'price built', building: 'Price' }), item('ua', { usage: { ...usage, scene: 'Price' }, building: 'Price' }),
      tool('b', 'Proof', true), item('ub', { usage: { ...usage, scene: 'Proof' }, building: 'Proof' }),
    ];
    await act(() => { render(h(Work, { work, live: false }), host); });
    const heads = [...host.querySelectorAll('.scene-name')].map((e) => e.textContent);
    expect(heads).toEqual(['Price', 'Proof']);
    expect(host.textContent).toContain('The plan is written.');
    await act(() => { render(h(Work, { work: [item('x', { text: 'hello' })], live: false }), host); });
    expect(host.querySelectorAll('.scene-name')).toHaveLength(0);
  });
});
