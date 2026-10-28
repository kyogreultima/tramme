// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

const ai = await import('../src/ai/index.ts');
const conversation = await import('../src/ai/conversation.ts');
const queueModule = await import('../src/ai/queue.ts');
const { QueueList } = await import('../src/ui/QueueList.tsx');
const { Composer } = await import('../src/ui/composer.tsx');
const { S, propose } = await import('../src/state.ts');
const { t } = await import('../src/i18n/index.ts');
const { queue, held } = queueModule;

const item = (id: string, text: string) => ({ id, text, context: 'Composition · 0:00', data: {}, at: 0, attachments: [] });
let host: HTMLElement;
const mount = async (node: import('preact').VNode<any>) => { await act(() => { render(node, host); }); };

beforeEach(() => {
  host = document.body.appendChild(document.createElement('div'));
  queue.value = []; held.value = false; conversation.running.value = false; S.proposal.value = null;
  vi.spyOn(ai, 'saveChat').mockResolvedValue(undefined);
});
afterEach(() => { render(null, host); host.remove(); vi.restoreAllMocks(); });

describe('the queue in the message boxes', () => {
  it('shows the queued messages above the box, each with a delete button', async () => {
    queue.value = [item('1', 'first'), item('2', 'second')];
    await mount(h(QueueList, {}));
    const rows = host.querySelectorAll('.queue-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('first');
    await act(() => { (rows[0].querySelector('button') as HTMLButtonElement).click(); });
    expect(host.querySelectorAll('.queue-row')).toHaveLength(1);
    expect(queue.value.map((q) => q.id)).toEqual(['2']);
  });

  it('renders nothing when the queue is empty', async () => {
    await mount(h(QueueList, {}));
    expect(host.innerHTML).toBe('');
  });

  it('says why it waits', async () => {
    queue.value = [item('1', 'first')];
    conversation.running.value = false;
    propose({ id: 'p', label: 'x', ops: [] });
    await mount(h(QueueList, {}));
    expect(host.textContent).toContain(t('assistant.queueWaitsDecision'));
    // a stopped turn: the user sends them now
    S.proposal.value = null; held.value = true;
    const flush = vi.spyOn(queueModule, 'flushQueue').mockResolvedValue(undefined);
    await mount(h(QueueList, {}));
    const now = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(t('assistant.sendNow')))!;
    expect(now).toBeTruthy();
    await act(() => { now.click(); });
    expect(flush).toHaveBeenCalled();
  });

  it('the box accepts a message during a turn', async () => {
    ai.aiStatus.value = { ...ai.aiStatus.value, server: true };
    conversation.running.value = true;
    await mount(h(Composer, { placeholder: 'Ask' }));
    const area = host.querySelector('textarea')!;
    await act(() => { area.value = 'one more thing'; area.dispatchEvent(new Event('input', { bubbles: true })); });
    const send = host.querySelector('button.send:not(.stop)') as HTMLButtonElement;
    expect(send).toBeTruthy();
    expect(send.disabled).toBe(false);
    expect(host.querySelector('button.send.stop')).toBeTruthy();
  });
});
