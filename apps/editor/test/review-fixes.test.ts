// @vitest-environment happy-dom
// What the review of the branch found in the interface: a delete that goes
// round a lock, a number key that also jumps to a marker.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TrammeDoc } from '@tramme/core';

const { deleteSelection } = await import('../src/ui/LeftPanel.tsx');
const { S, load, select } = await import('../src/state.ts');
const { newProject } = await import('@tramme/project');
const { markerJump } = await import('../src/ui/timeline/shortcuts.ts');

function open(locked: boolean) {
  const project = newProject({ name: 'T', width: 640, height: 360, fps: 30, duration: 10 });
  const doc = project.doc as TrammeDoc, c = doc.compositions[doc.root];
  c.kind = 'sequence'; c.tracks = [{ id: 'V1', kind: 'video', magnetic: true, ...(locked ? { locked: true } : {}) }];
  c.layers = { a: { type: 'shape.rect', track: 'V1', in: 0, out: 3 }, b: { type: 'shape.rect', track: 'V1', in: 3, out: 6 } } as never;
  c.order = ['a', 'b'];
  load(doc, project.manifest, 'http://localhost/api/projects/test/files/document.json', '');
  select(['a']);
}
const layers = () => Object.keys(S.doc.peek().compositions[S.compId.peek()].layers);

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { select([]); });

describe('deleting a clip', () => {
  it('on a locked track does nothing, whatever way the key goes', () => {
    open(true);
    deleteSelection();
    expect(layers()).toEqual(['a', 'b']);
  });

  it('on a track that is not locked removes it', () => {
    open(false);
    deleteSelection();
    expect(layers()).toEqual(['b']);
  });
});

describe('the number keys', () => {
  const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });

  it('jump to the marker of that number', () => {
    expect(markerJump(key('3'))).toBe(3);
    expect(markerJump(key('9'))).toBe(9);
  });

  it('do not, with Alt (the cameras of a multicam), Ctrl or Cmd, nor for other keys', () => {
    expect(markerJump(key('2', { altKey: true }))).toBeNull();
    expect(markerJump(key('2', { ctrlKey: true }))).toBeNull();
    expect(markerJump(key('2', { metaKey: true }))).toBeNull();
    expect(markerJump(key('0'))).toBeNull();
    expect(markerJump(key('a'))).toBeNull();
  });
});
