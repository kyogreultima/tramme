// @vitest-environment happy-dom
// The overlays sit over every page, the start page too, where no document is
// open yet: none of them may read the document before it has something to show.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import type { TrammeDoc } from '@tramme/core';

const { Overlays } = await import('../src/ui/shell.tsx');
const { S } = await import('../src/state.ts');
const { multicam } = await import('../src/ui/Multicam.tsx');

let host: HTMLElement, was: TrammeDoc;
beforeEach(() => { host = document.body.appendChild(document.createElement('div')); was = S.doc.peek(); });
afterEach(() => { render(null, host); host.remove(); S.doc.value = was; multicam.value = null; });

describe('the overlays on the start page', () => {
  it('render with no document open', async () => {
    S.doc.value = null as unknown as TrammeDoc;
    await act(() => { render(h(Overlays, {}), host); });
    expect(host.querySelector('.multicam-panel')).toBeNull();
  });

  it('render a multicam panel left open once the document is gone', async () => {
    S.doc.value = null as unknown as TrammeDoc;
    multicam.value = { tracks: ['V1', 'V2'] };
    await act(() => { render(h(Overlays, {}), host); });
    expect(host.querySelector('.multicam-panel')).toBeNull();
  });
});
