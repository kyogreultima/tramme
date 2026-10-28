// What the media panel and the timeline share when an asset goes from one to
// the other: the drag's type, and the asset chosen in the panel (what the
// comma and the full stop put on the timeline).

import { signal } from '@preact/signals';

/** the drag data type of an asset of the project */
export const ASSET_MIME = 'application/x-tramme-asset';

export const chosenAsset = signal<string | null>(null);
