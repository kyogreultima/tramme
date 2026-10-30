// The craft's references, in words: principles of what makes a frame or a cut
// work and the faults to avoid. A hand-written catalogue shipped as a static
// file of the editor (apps/editor/data/references.json) and loaded on first use.
// An entry is a principle, never a look to copy, and holds no media.

import { dataLoader } from '../data.ts';

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

/** the catalogue, fetched once; a failed read is not kept, so the next call tries again */
export const loadReferences = dataLoader<Reference[]>('/references/catalogue.json', 'the reference library');
