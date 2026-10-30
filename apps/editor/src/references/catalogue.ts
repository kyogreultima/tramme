// The craft's references, in words: principles of what makes a frame or a cut
// work and the faults to avoid. A hand-written catalogue shipped as a static
// file of the editor (apps/editor/data/references.json) and loaded on first use.
// An entry is a principle, never a look to copy, and holds no media.

export const REF_TAGS = [
  // craft
  'composition', 'hierarchy', 'type', 'contrast', 'colour', 'light', 'material', 'depth', 'camera', 'rhythm', 'cut', 'transition', 'continuity', 'sound', 'density', 'ending', 'opening', 'pacing', 'legibility',
  // kinds of picture
  'interface', 'kinetic-type', 'object', 'data', 'diagram', 'photo', '3d', 'character', 'map',
  // kinds of film
  'launch', 'explainer', 'dressing', 'data-story', 'teaser', 'ad', 'announcement', 'tutorial',
] as const;

export interface Reference {
  id: string;
  kind: 'principle' | 'fault';
  title: string;
  tags: string[];
  text: string;
  /** how to spot it in a film */
  see?: string;
  /** a fault: what to do about it */
  fix?: string;
}

const FILE = '/references/catalogue.json';
let loaded: Promise<Reference[]> | null = null;

/** the catalogue, fetched once; a failed read is not kept, so the next call tries again */
export function loadReferences(): Promise<Reference[]> {
  loaded ??= (async () => {
    const r = await fetch(FILE, { signal: AbortSignal.timeout(20000) }).catch((e: Error) => { throw new Error(`the reference library (${FILE}) could not be read: ${e.message}`); });
    if (!r.ok) throw new Error(`the reference library could not be read (HTTP ${r.status})`);
    return (await r.json()) as Reference[];
  })().catch((e) => { loaded = null; throw e; });
  return loaded;
}
