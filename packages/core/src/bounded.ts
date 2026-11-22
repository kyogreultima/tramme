// A response read with a ceiling: the bytes stop at `max`, and a larger body
// is cancelled as soon as it passes it rather than buffered whole. Shared by
// the editor's host, the renderer's asset loader and the exporters' readers.

/** the body of `response`, or an error naming `label` once it passes `max` bytes */
export async function readBounded(response: Response, max: number, label: string): Promise<Uint8Array> {
  const tooLarge = () => new Error(`${label} exceeds ${max / (1024 * 1024)} MB`);
  const length = response.headers.get('content-length');
  if (length && Number(length) > max) { await response.body?.cancel().catch(() => {}); throw tooLarge(); }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) throw tooLarge();
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}
