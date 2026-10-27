// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

describe('the home page box', () => {
  it('offers the commands', async () => {
    // the shipped packs' index, as the page fetches it
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    const { DirectionBox } = await import('../src/ui/Home.tsx');
    const host = document.body.appendChild(document.createElement('div'));
    await act(() => { render(h(DirectionBox, { busy: false, onStart: () => {} }), host); });
    const area = host.querySelector('textarea')!;
    await act(() => { area.value = '/'; area.dispatchEvent(new Event('input', { bubbles: true })); });
    const rows = [...host.querySelectorAll('.command-row')];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => /captions/.test(r.textContent ?? ''))).toBe(true);
  });
});
