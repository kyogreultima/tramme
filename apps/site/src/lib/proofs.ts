// What a feature does, shown on real footage rather than claimed
// (docs/proofs-roadmap.md). Each proof is a manifest, proofs/<id>/proof.json:
// its texts, its source and licence, how the after was made. The script
// `node scripts/proofs.ts <id>` makes its files from it: the two stills in
// src/assets/proofs/, the clip in src/videos/ (proof-<id>), the two sounds
// in src/audio/ for a sound proof. The features page shows them
// (Proofs.astro), in the manifests' order; a proof whose files are not made
// yet is left out.

import type { ImageMetadata } from 'astro';
import type { Localised } from './i18n';

export interface Proof {
  id: string;
  order: number;
  /** a picture compared with a line, or a sound compared with a switch */
  kind: 'picture' | 'sound';
  /** the view a proof opens on: the picture (by default), or the clip when the change shows in motion (a 2.5D move) */
  view?: 'picture' | 'video';
  /** the clip keeps the sound of the after (captions heard as they are said): a button turns it on */
  sound?: boolean;
  /** how the clip compares: a line sweeping across, the two side by side, or the after alone full frame (captions to read) */
  compare: 'sweep' | 'side' | 'after';
  name: Localised<string>;
  text: Localised<string>;
  where: Localised<string>;
  settings?: Localised<string>;
  /** what was measured, in plain words */
  measure?: Localised<string>;
  beforeLabel: Localised<string>;
  afterLabel: Localised<string>;
  videoLabel?: Localised<string>;
  source: { page: string; author: string; licence: string; licenceUrl: string; duration: number; width?: number; height?: number };
  before: ImageMetadata;
  after: ImageMetadata;
  /** a sound proof's two sounds */
  sounds?: { before: string; after: string };
  /** a proof kept out of the site, and why (a source or a tool that did not hold) */
  draft?: string;
  /** made by the assistant: the bench brief whose run it shows */
  bench?: string;
  /** whether its clip is made */
  clip: boolean;
}

const manifests = import.meta.glob<Omit<Proof, 'before' | 'after' | 'sounds' | 'clip'>>('../../proofs/*/proof.json', { eager: true, import: 'default' });
const stills = import.meta.glob<ImageMetadata>('../assets/proofs/*.jpg', { eager: true, import: 'default' });
const audio = import.meta.glob<string>('../audio/*.mp3', { eager: true, query: '?url', import: 'default' });
const clips = import.meta.glob('../videos/proof-*.{webm,mp4}');

export const PROOFS: Proof[] = Object.values(manifests)
  .map((p) => {
    const before = stills[`../assets/proofs/${p.id}-before.jpg`], after = stills[`../assets/proofs/${p.id}-after.jpg`];
    const sb = audio[`../audio/proof-${p.id}-before.mp3`], sa = audio[`../audio/proof-${p.id}-after.mp3`];
    const clip = !!(clips[`../videos/proof-${p.id}.webm`] || clips[`../videos/proof-${p.id}.mp4`]);
    return before && after ? { ...p, before, after, clip, ...(sb && sa ? { sounds: { before: sb, after: sa } } : {}) } : null;
  })
  .filter((p): p is Proof => !!p && !p.draft && (p.kind !== 'sound' || !!p.sounds))
  .sort((a, b) => a.order - b.order);

/** the section's name in the features page's index */
export const PROOFS_NAME: Localised<string> = { en: 'Before and after', fr: 'Avant et après' };
