// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

await import('../src/ai/index.ts');
const st = await import('../src/studio.ts');
const queueMod = await import('../src/ai/queue.ts');
const { RetouchList, AreaReview, pressPicture, PinChips } = await import('../src/ui/Retouch.tsx');
const { newProject } = await import('@tramme/project');
const { load, S } = await import('../src/state.ts');
const { setPrefs } = await import('../src/settings.ts');

const project = newProject({ name: 'T', width: 1000, height: 500, fps: 30, duration: 10 });
project.doc.compositions[project.doc.root].layers = { a: { type: 'shape.rect', name: 'Card', props: { size: [200, 100] }, transform: { position: [200, 150] } } } as never;
project.doc.compositions[project.doc.root].order = ['a'];
load(project.doc, project.manifest, '', '');

let host: HTMLElement;
beforeEach(() => { st.resetRetouch(); queueMod.queue.value = []; setPrefs({ areaConfirm: 'always' }); host = document.createElement('div'); document.body.appendChild(host); });
afterEach(() => { render(null, host); host.remove(); vi.restoreAllMocks(); });

const mount = async (v: ReturnType<typeof h>) => { await act(() => { render(v, host); }); };
const click = async (el: Element | null | undefined) => { await act(async () => { (el as HTMLElement).click(); }); };

describe('the list of retouches', () => {
  it('shows each item with its numbers and a summary, and moves, removes and sends them', async () => {
    st.addPin({ kind: 'point', at: [0.2, 0.2] });
    st.addPin({ kind: 'path', points: [[0.1, 0.1], [0.9, 0.9]] });
    st.addRetouch('move 1 along 2');
    st.addRetouch('then fade');
    await mount(h(RetouchList, {}));
    const rows = () => [...host.querySelectorAll('li')];
    expect(rows()).toHaveLength(2);
    expect(rows()[0].textContent).toContain('1-2');
    expect(rows()[0].textContent).toContain('1 point · 1 path');
    await click(rows()[1].querySelector('button[title="Move up"]'));
    expect(st.studio.retouches.value.map((r) => r.text)).toEqual(['then fade', 'move 1 along 2']);
    const flush = vi.spyOn(queueMod, 'flushQueue').mockResolvedValue(undefined);
    await click([...host.querySelectorAll('button')].find((b) => /Send all \(2\)/.test(b.textContent ?? '')));
    expect(flush).toHaveBeenCalledOnce();
    expect(queueMod.queue.value).toHaveLength(2);
  });

  it('is nothing when empty', async () => {
    await mount(h(RetouchList, {}));
    expect(host.textContent).toBe('');
  });
});

describe('the area waiting for the user', () => {
  it('shows the layers it may mean, drops one, and makes the pin of those left', async () => {
    const placed = [{ id: 'a', name: 'Card', type: 'shape.rect', box: { x: 100, y: 100, w: 200, h: 100 }, opacity: 1 }, { id: 'b', name: 'Title', type: 'text', box: { x: 320, y: 100, w: 100, h: 100 }, opacity: 1 }];
    st.strokeDone('area', [[0.05, 0.1], [0.5, 0.1], [0.5, 0.6], [0.05, 0.6], [0.06, 0.12]], placed, { w: 1000, h: 500 }, null);
    await mount(h(AreaReview, {}));
    const names = () => [...host.querySelectorAll('.area-layers .chip')].map((c) => c.textContent);
    expect(names()).toEqual(['Card', 'Title']);
    await click(host.querySelectorAll('.area-layers .chip')[1]);
    await click([...host.querySelectorAll('button')].find((b) => /Use 1 layers/.test(b.textContent ?? '')));
    const pin = st.studio.pins.value[0];
    expect(pin.kind === 'area' && pin.layers.map((l) => l.id)).toEqual(['a']);
    expect(host.querySelector('.area-review')).toBeNull();
  });

  it('says it is too wide, and offers the hint', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `l${i}`, name: `L${i}`, type: 'shape.rect', box: { x: 20 + i * 30, y: 100, w: 20, h: 20 }, opacity: 1 }));
    st.strokeDone('area', [[0.01, 0.1], [0.95, 0.1], [0.95, 0.9], [0.01, 0.9], [0.02, 0.12]], many, { w: 1000, h: 500 }, null);
    await mount(h(AreaReview, {}));
    expect(host.textContent).toContain('12 layers: too many');
    await click([...host.querySelectorAll('button')].find((b) => /Use as a hint/.test(b.textContent ?? '')));
    expect(st.studio.pins.value[0]).toMatchObject({ kind: 'area', layers: [] });
  });
});

describe('the gesture on the picture', () => {
  const area = { current: null } as never;
  const toComp = (e: { clientX: number; clientY: number }): [number, number] => [e.clientX, e.clientY];
  const move = (x: number, y: number) => { const e = new Event('pointermove') as Event & { clientX: number; clientY: number }; e.clientX = x; e.clientY = y; dispatchEvent(e); };

  it('a press with the point tool pins a point on the layer under it', () => {
    st.studio.tool.value = 'point';
    pressPicture([250, 100], new Event('pointerdown') as PointerEvent, () => 'a', toComp, area);
    expect(st.studio.pins.value[0]).toMatchObject({ kind: 'point', at: [0.25, 0.2], under: { id: 'a', name: 'Card' } });
  });

  it('a drag with the path tool draws a path, shown while it is drawn, a pin when the finger lifts', () => {
    st.studio.tool.value = 'path';
    pressPicture([100, 400], new Event('pointerdown') as PointerEvent, () => null, toComp, area);
    for (let i = 1; i <= 10; i++) move(100 + i * 70, 400 - i * 30);
    expect(st.studio.drawing.value!.length).toBeGreaterThan(5);
    dispatchEvent(new Event('pointerup'));
    expect(st.studio.drawing.value).toBeNull();
    const p = st.studio.pins.value[0];
    expect(p.kind).toBe('path');
    expect(p.kind === 'path' && p.points.length).toBe(2);
  });

  it('a tap with the path tool is no stroke', () => {
    st.studio.tool.value = 'path';
    pressPicture([100, 400], new Event('pointerdown') as PointerEvent, () => null, toComp, area);
    dispatchEvent(new Event('pointerup'));
    expect(st.studio.pins.value).toEqual([]);
  });

  it('while an area waits, a press on a layer turns it on or off in the proposal', () => {
    st.studio.review.value = { stroke: [[0, 0], [1, 1]], candidates: [{ id: 'a', name: 'Card', type: 'shape.rect', on: true }], tooMany: false, count: 1 };
    pressPicture([250, 100], new Event('pointerdown') as PointerEvent, () => 'a', toComp, area);
    expect(st.studio.review.value!.candidates[0].on).toBe(false);
    expect(st.studio.pins.value).toEqual([]);
  });
});

describe('the chips of the pins', () => {
  it('numbers each pin and takes it away when pressed', async () => {
    st.addPin({ kind: 'point', at: [0.1, 0.1] });
    st.addPin({ kind: 'path', points: [[0, 0], [1, 1]] });
    await mount(h(PinChips, {}));
    expect([...host.querySelectorAll('.ctx-chip')].map((c) => c.textContent)).toEqual(['1 · Point', '2 · Path']);
    await click(host.querySelectorAll('.ctx-chip')[0]);
    expect(st.studio.pins.value).toHaveLength(1);
    void S;
  });
});

describe('the setting of the confirmation', () => {
  it('is on always by default, and the behaviour pane changes it', async () => {
    const { DEFAULT_PREFERENCES, prefs, openSettings } = await import('../src/settings.ts');
    expect(DEFAULT_PREFERENCES.areaConfirm).toBe('always');
    const { SettingsDialog } = await import('../src/ui/Settings.tsx');
    openSettings('behavior');
    await mount(h(SettingsDialog, {}));
    expect(host.textContent).toContain('Selecting layers by drawing');
    const row = () => [...host.querySelectorAll('.set-row')].find((r) => r.textContent?.includes('Selecting layers by drawing'))!;
    await click([...row().querySelectorAll('button')].find((b) => b.textContent === 'Above three'));
    expect(prefs.peek().areaConfirm).toBe('many');
    await click([...row().querySelectorAll('button')].find((b) => b.textContent === 'Never'));
    expect(prefs.peek().areaConfirm).toBe('never');
  });
});
