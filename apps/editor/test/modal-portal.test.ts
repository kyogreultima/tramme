// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

const { Modal } = await import('../src/ui/controls.tsx');

describe('a dialog opened from a bar of glass', () => {
  it('is drawn on the page itself, not inside the bar (backdrop-filter makes the bar the box of fixed children)', async () => {
    const bar = document.body.appendChild(document.createElement('div'));
    bar.style.backdropFilter = 'blur(20px)';
    await act(() => { render(h(Modal, { title: 'Prompter', onClose: () => {}, children: h('p', null, 'script') }), bar); });
    const back = document.querySelector('.modal-back');
    expect(back).not.toBeNull();
    expect(back!.parentElement).toBe(document.body);
    expect(bar.querySelector('.modal-back')).toBeNull();
    await act(() => { render(null, bar); });
    expect(document.querySelector('.modal-back')).toBeNull();
    bar.remove();
  });

  it('opens the timeline prompter from its glass bar as a full dialog', async () => {
    const { newProject } = await import('@tramme/project');
    const { load } = await import('../src/state.ts');
    const { PrompterButton } = await import('../src/ui/Prompter.tsx');
    const project = newProject({ name: 'Prompter test', width: 1920, height: 1080, fps: 30, duration: 5 });
    load(project.doc, project.manifest, '', '');
    const bar = document.body.appendChild(document.createElement('div'));
    bar.style.backdropFilter = 'blur(20px)';
    await act(() => { render(h(PrompterButton, { size: '' }), bar); });

    await act(() => { (bar.querySelector('button') as HTMLButtonElement).click(); });

    const dialog = document.querySelector('.modal-back');
    expect(dialog?.parentElement).toBe(document.body);
    expect(dialog?.querySelector('.prompter-script')).not.toBeNull();
    expect(bar.querySelector('.modal-back')).toBeNull();
    await act(() => { render(null, bar); });
    bar.remove();
  }, 15000);
});
