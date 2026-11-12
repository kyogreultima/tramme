// A long menu's search (controls.tsx filterMenu): the entries that match, each under its section.
import { describe, expect, it } from 'vitest';
import { filterMenu, type MenuItem } from '../src/ui/controls.tsx';

const noop = () => {};
const items: MenuItem[] = [
  { section: 'Text' },
  { label: 'Kinetic text · typewriter', onClick: noop },
  { label: 'Neon title', onClick: noop },
  'sep',
  { section: 'Charts' },
  { label: 'Bar chart', onClick: noop },
  { label: 'Donut chart', detail: 'a ring of shares', onClick: noop },
  { section: 'Print' },
  { label: 'Risograph', onClick: noop },
];
const labels = (list: MenuItem[]) => list.map((it) => (it === 'sep' ? '—' : 'section' in it ? `# ${it.section}` : it.label));

describe('the search of a long menu', () => {
  it('keeps every item for an empty query', () => {
    expect(filterMenu(items, '  ')).toBe(items);
  });

  it('keeps the matching entries under their sections, and drops the empty sections and the separators', () => {
    expect(labels(filterMenu(items, 'chart'))).toEqual(['# Charts', 'Bar chart', 'Donut chart']);
    expect(labels(filterMenu(items, 'NEON'))).toEqual(['# Text', 'Neon title']);
  });

  it('reads the detail, and ignores case and accents', () => {
    expect(labels(filterMenu(items, 'ring'))).toEqual(['# Charts', 'Donut chart']);
    expect(labels(filterMenu(items, 'rísógraph'))).toEqual(['# Print', 'Risograph']);
  });

  it('finds nothing when nothing matches', () => {
    expect(filterMenu(items, 'zzz')).toEqual([]);
  });
});
