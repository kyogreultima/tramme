// @vitest-environment happy-dom
// What the preview says when drawing fails: a limit or a stopped sandbox gets
// a plain sentence; the engine's own words stay in the tooltip.

import { describe, expect, it } from 'vitest';
import { plainRenderMessage } from '../src/render-message.ts';
import { t } from '../src/i18n/index.ts';

describe('the preview error sentence', () => {
  it('says plainly that the project sandbox stopped, and that a limit was reached', () => {
    expect(plainRenderMessage('sandbox: the plugin sandbox stopped: render call timed out after 30 seconds')).toBe(t('viewport.sandboxStopped'));
    expect(plainRenderMessage('sandbox: the isolated project worker did not start')).toBe(t('viewport.sandboxStopped'));
    expect(plainRenderMessage('render: sandbox graphics exceed 256 MB')).toBe(t('viewport.heavyProject'));
    expect(plainRenderMessage('render: title: expression : x is not defined')).toBe('render: title: expression : x is not defined');
  });
});
