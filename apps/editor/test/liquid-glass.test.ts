// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installGlassLight } from '../src/theme/liquid-glass.ts';

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('glass lighting', () => {
  const setup = (reduced = false) => {
    const queries: { matches: boolean; changed?: () => void }[] = [];
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => {
      const entry = { matches: query === '(pointer: fine)' || reduced, changed: undefined as (() => void) | undefined };
      queries.push(entry);
      return { get matches() { return entry.matches; }, addEventListener: (_: string, listener: () => void) => { entry.changed = listener; }, removeEventListener: vi.fn() } as unknown as MediaQueryList;
    });
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length; });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    document.body.innerHTML = '<button class="btn"><span>Action</span></button><canvas></canvas>';
    const button = document.querySelector('button')!;
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, width: 100, height: 40 } as DOMRect);
    const move = (target: Element, x: number) => target.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: x, clientY: 40 }));
    return { queries, frames, cancel, button, move };
  };

  it('coalesces pointer movement and lights the control rather than its label', () => {
    const { button, move, frames } = setup();
    const dispose = installGlassLight(document);
    move(button.firstElementChild!, 25);
    move(button.firstElementChild!, 85);
    expect(frames).toHaveLength(1);
    frames[0](0);
    expect(button.style.getPropertyValue('--glass-x')).toBe('75%');
    expect(button.style.getPropertyValue('--glass-y')).toBe('50%');
    dispose();
    expect(button.style.getPropertyValue('--glass-x')).toBe('');
  });

  it('does not animate canvas editing, touch input or drag gestures', () => {
    const { button, move, frames } = setup();
    const dispose = installGlassLight(document);
    move(document.querySelector('canvas')!, 80);
    button.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'touch' }));
    button.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', buttons: 1 }));
    expect(frames).toHaveLength(0);
    dispose();
  });

  it('cancels pending work and clears lighting when the theme is disposed', () => {
    const { button, move, frames, cancel } = setup();
    const dispose = installGlassLight(document);
    move(button, 60);
    dispose();
    expect(cancel).toHaveBeenCalledWith(1);
    move(button, 80);
    expect(frames).toHaveLength(1);
    expect(button.style.getPropertyValue('--glass-x')).toBe('');
  });

  it('does not add reflections to disabled or semantic actions', () => {
    const { button, move, frames } = setup();
    const dispose = installGlassLight(document);
    for (const cls of ['btn primary', 'btn danger', 'btn danger-solid']) {
      button.className = cls;
      move(button, 60);
    }
    button.className = 'btn';
    button.disabled = true;
    move(button, 60);
    expect(frames).toHaveLength(0);
    dispose();
  });

  it('honors reduced motion initially and when it changes while open', () => {
    const initial = setup(true);
    const first = installGlassLight(document);
    initial.move(initial.button, 80);
    expect(initial.frames).toHaveLength(0);
    first();
    vi.restoreAllMocks();
    const { button, move, frames, queries } = setup();
    const dispose = installGlassLight(document);
    move(button, 60);
    frames[0](0);
    queries[1].matches = true;
    // The real MediaQueryList is live; the mock's getter follows this entry.
    queries[1].changed?.();
    expect(button.style.getPropertyValue('--glass-x')).toBe('');
    move(button, 80);
    expect(frames).toHaveLength(1);
    dispose();
  });
});
