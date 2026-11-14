// A long run of samples cut in overlapping segments, for a network that
// takes a fixed length at a time (the tiles of a frame too large for RIFE in
// one pass), and the weight of each sample, rising and falling over the
// overlaps: added back with these weights and divided by their sum, the
// pieces blend with no seam.

/** a segment: where it starts and how long it is, in samples (or pixels) */
export interface Segment { from: number; length: number }

/** the segments covering `total` samples, `size` long, overlapping by `overlap` of a segment; the last one ends at the end */
export function segmentsOf(total: number, size: number, overlap = 0.25): Segment[] {
  if (total <= size) return [{ from: 0, length: total }];
  const step = Math.max(1, Math.round(size * (1 - overlap))), out: Segment[] = [];
  for (let from = 0; ; from += step) {
    if (from + size >= total) { out.push({ from: Math.max(0, total - size), length: Math.min(size, total) }); break; }
    out.push({ from, length: size });
  }
  return out;
}

/** the weight of a segment's sample `i`: rising over the overlap at its start (but the first's), falling over the overlap at its end (but the last's) */
export function weightAt(i: number, length: number, fade: number, first: boolean, last: boolean): number {
  let w = 1;
  if (!first && fade > 0 && i < fade) w = Math.min(w, (i + 0.5) / fade);
  if (!last && fade > 0 && i >= length - fade) w = Math.min(w, (length - i - 0.5) / fade);
  return w;
}
