// The repository's examples, read at build time: their names, sizes and
// lengths describe the video slots that show them (components/Media.astro).

interface Manifest { name: string; width: number; height: number; duration: number }

const manifests = import.meta.glob<Manifest>('../../../../examples/*/tramme.json', { eager: true, import: 'default' });

export interface Example extends Manifest { id: string }

export const examples: Record<string, Example> = Object.fromEntries(
  Object.entries(manifests).map(([path, m]) => {
    const id = path.split('/').at(-2)!;
    return [id, { id, name: m.name, width: m.width, height: m.height, duration: m.duration }];
  }),
);

export function example(id: string): Example {
  const e = examples[id];
  if (!e) throw new Error(`no example ${id}`);
  return e;
}

/** the examples as the site tells them, in this order */
export const IDS = ['launch-film', 'anime', 'showreel'] as const;
export type ExampleId = (typeof IDS)[number];

/** what each says of itself, and the colours that light its video slot until the clip is there */
export const COPY: Record<ExampleId, { tint: [string, string]; text: string }> = {
  'launch-film': { tint: ['#0b0f12', '#2ec4b6'], text: '45 seconds cut on the beat: compositions inside compositions, a 2.5D camera, motion that follows the music.' },
  anime: { tint: ['#1e2a5c', '#f6a86b'], text: 'Frame-by-frame drawings on an exposure sheet, in three shots.' },
  showreel: { tint: ['#111316', '#ff4f7b'], text: 'Made by the assistant: kinetic type, shapes, a counter, smoke and a camera look.' },
};
