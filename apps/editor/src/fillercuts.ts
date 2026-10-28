// The list of hesitations the fillers tool cut (assets/fillers/<media>.json),
// read for the panel that puts each back by its number.

export interface FillerCut { n: number; from: number; to: number; word?: string }

/** the cuts a fillers list holds, or null when the text is not one */
export function cutsOf(text: string): { asset: string; cuts: FillerCut[] } | null {
  try {
    const j = JSON.parse(text) as { kind?: string; asset?: unknown; cuts?: unknown };
    if (j?.kind !== 'fillers' || typeof j.asset !== 'string' || !Array.isArray(j.cuts)) return null;
    return { asset: j.asset, cuts: j.cuts as FillerCut[] };
  } catch { return null; }
}

/** what the fillers tool is asked to put one cut back */
export const restoreInput = (asset: string, n: number) => ({ video: asset, restore: [n] });
