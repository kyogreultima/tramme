// What the media panel and the timeline share when an asset goes from one to
// the other: the drag's type, and the asset chosen in the panel (what the
// comma and the full stop put on the timeline).

import { signal } from '@preact/signals';

/** the drag data type of an asset of the project */
export const ASSET_MIME = 'application/x-tramme-asset';
/** the drag data type of a composition of the project (put on a track, it plays as one clip) */
export const COMP_MIME = 'application/x-tramme-comp';

export const chosenAsset = signal<string | null>(null);

/** the asset open in the source monitor, if any */
export const sourceOpen = signal<string | null>(null);
