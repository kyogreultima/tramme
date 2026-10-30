// A static data file of the editor (a catalogue shipped beside it), fetched once
// on first use: a failed read is not kept, so the next call tries again.

/** a loader for the JSON file at `file`; `what` names it in the error ("the typeface catalogue") */
export function dataLoader<T>(file: string, what: string): () => Promise<T> {
  let loaded: Promise<T> | null = null;
  return () => (loaded ??= (async () => {
    // offline or stalled: an answer naming the file, not a wait
    const r = await fetch(file, { signal: AbortSignal.timeout(20000) }).catch((e: Error) => { throw new Error(`${what} (${file}) could not be read: ${e.message}`); });
    if (!r.ok) throw new Error(`${what} could not be read (HTTP ${r.status})`);
    return (await r.json()) as T;
  })().catch((e) => { loaded = null; throw e; }));
}
