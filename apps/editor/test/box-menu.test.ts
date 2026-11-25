import { describe, expect, it } from 'vitest';
import { menuPlace } from '../src/ui/BoxMenu.tsx';

describe('where a menu goes beside its box', () => {
  it('keeps the preferred side when it fits', () => {
    expect(menuPlace(200, 300, 900, 'below')).toEqual({ side: 'below', max: 340 });
    expect(menuPlace(700, 800, 900, 'above')).toEqual({ side: 'above', max: 340 });
  });
  it('takes the other side near an edge of the window', () => {
    expect(menuPlace(600, 800, 900, 'below').side).toBe('above');
    expect(menuPlace(60, 160, 900, 'above').side).toBe('below');
  });
  it('never passes the window', () => {
    const { side, max } = menuPlace(150, 250, 500, 'below');
    expect(side).toBe('below');
    expect(250 + max).toBeLessThanOrEqual(500);
  });
});
