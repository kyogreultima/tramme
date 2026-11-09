// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { browserHost } from '../src/plugins/host.ts';

it('closes on a malformed loaded message without throwing in the editor page', () => {
  let frame!: HTMLIFrameElement;
  const append = vi.spyOn(document.body, 'append').mockImplementation((node) => { frame = node as HTMLIFrameElement; });
  const host = browserHost('https://tramme.test/projects/one/document.tramme.json');
  try {
    const message = new MessageEvent('message', { origin: 'null', source: frame.contentWindow,
      data: { kind: 'worker', data: { kind: 'loaded', plugins: null, urls: null } } });
    expect(() => window.dispatchEvent(message)).not.toThrow();
    expect(host.closed()).toBe(true);
  } finally { host.dispose(); append.mockRestore(); }
});
