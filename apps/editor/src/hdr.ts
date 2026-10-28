// Whether a canvas of this browser can hold HDR: half floats in the PQ colour
// space. Where it cannot (the browsers of this machine, in 2026, refuse
// `rec2100-pq`), the exports stay SDR, with 10 bits where the encoder has
// them; HDR waits for it (docs/editing-roadmap.md, step 14).

type CanvasLike = { getContext(kind: string, options: object): unknown };

/** a canvas made by `make` is asked for float16 in rec2100-pq: true only when it gives it */
export function hdrCapability(make: () => CanvasLike = () => document.createElement('canvas')): boolean {
  try {
    const g = make().getContext('2d', { colorType: 'float16', colorSpace: 'rec2100-pq' }) as { getContextAttributes?: () => { colorType?: string; colorSpace?: string } } | null;
    const a = g?.getContextAttributes?.();
    return a?.colorType === 'float16' && (a.colorSpace === 'rec2100-pq' || a.colorSpace === 'rec2100-hlg');
  } catch { return false; }
}
