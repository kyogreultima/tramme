import { describe, expect, it } from 'vitest';
import { queuedPrompt, userPrompt, type TurnContext } from '../src/index.ts';

const ctx = (marks: TurnContext['marks']): TurnContext => ({ compId: 'main', time: 2, frame: 60, marks });

describe('the marks a message is drawn with', () => {
  it('say a point as before: where it is and the layer under it', () => {
    const p = userPrompt('bigger', ctx([{ n: 1, kind: 'point', at: [0.5, 0.25], under: { id: 'title', name: 'Title', type: 'text' } }]), []);
    expect(p).toContain('Mark 1: a point at 50 % across and 25 % down');
    expect(p).toContain('the layer Title (title, text)');
  });

  it('say a path as a line to follow: its ends and the points between, in fractions of the frame', () => {
    const p = userPrompt('follow this', ctx([{ n: 1, kind: 'path', points: [[0.1, 0.8], [0.3, 0.5], [0.7, 0.2], [0.9, 0.2]], under: { id: 'ball', name: 'Ball', type: 'shape.ellipse' } }]), []);
    expect(p).toContain('Mark 1: a path drawn on the picture');
    expect(p).toContain('from (0.1, 0.8) to (0.9, 0.2)');
    expect(p).toContain('(0.3, 0.5)');
    expect(p).toContain('starts on the layer Ball (ball, shape.ellipse)');
    expect(p).toMatch(/the movement to follow/);
  });

  it('say an area as the layers the user confirmed, and as a hint only when they chose none', () => {
    const chosen = userPrompt('group', ctx([{ n: 2, kind: 'area', points: [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5]], layers: [{ id: 'a', name: 'A', type: 'text' }, { id: 'b', name: 'B', type: 'image' }] }]), []);
    expect(chosen).toContain('Mark 2: a selection of these layers, chosen by the user: A (a, text), B (b, image)');
    expect(chosen).toMatch(/nothing else/);
    const hint = userPrompt('group', ctx([{ n: 2, kind: 'area', points: [[0.1, 0.1], [0.5, 0.5]], layers: [] }]), []);
    expect(hint).toMatch(/Mark 2: an area drawn on the picture/);
    expect(hint).toMatch(/did not choose layers/);
  });

  it('number several marks of one message, and each message of a list its own', () => {
    const p = queuedPrompt([
      { text: 'one', ctx: ctx([{ n: 1, kind: 'point', at: [0.1, 0.1] }, { n: 2, kind: 'point', at: [0.9, 0.9] }]) },
      { text: 'two', ctx: ctx([{ n: 3, kind: 'point', at: [0.5, 0.5] }]) },
    ], []);
    expect(p).toContain('Mark 1');
    expect(p).toContain('Mark 2');
    expect(p.indexOf('Mark 3')).toBeGreaterThan(p.indexOf('two') - 80);
  });

  it('keep the old single pin working', () => {
    expect(userPrompt('x', { compId: 'main', time: 1, frame: 30, point: [0.5, 0.5] }, [])).toContain('Note pinned on the picture at 50 % across');
  });
});
