// A file put into a project on a Tramme server, from Node (the bench, the
// proofs): in one request up to LIMITS.file, a media file larger than that in
// parts, as the editor sends it (apps/editor/src/api.ts, writeAny).

import { isMedia, LIMITS } from '@tramme/project';

export async function uploadProjectFile(base: string, projectId: string, path: string, bytes: Uint8Array): Promise<void> {
  const P = `${base.replace(/\/+$/, '')}/api/projects/${encodeURIComponent(projectId)}`;
  const enc = path.split('/').map(encodeURIComponent).join('/');
  const ok = async (r: Response, what: string) => { if (!r.ok) throw new Error(`${what}: HTTP ${r.status} ${await r.text().catch(() => '')}`.trim()); return r; };
  if (bytes.byteLength <= LIMITS.file || !isMedia(path)) {
    await ok(await fetch(`${P}/files/${enc}`, { method: 'PUT', body: new Blob([bytes as Uint8Array<ArrayBuffer>]) }), path);
    return;
  }
  const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const { uploadId, partSize } = await (await ok(await fetch(`${P}/uploads`, json('POST', { path, size: bytes.byteLength })), path)).json() as { uploadId: string; partSize: number };
  const q = `path=${encodeURIComponent(path)}`;
  try {
    const parts: { partNumber: number; etag: string }[] = [];
    for (let n = 1; (n - 1) * partSize < bytes.byteLength; n++) {
      const body = new Blob([bytes.subarray((n - 1) * partSize, Math.min(bytes.byteLength, n * partSize)) as Uint8Array<ArrayBuffer>]);
      parts.push(await (await ok(await fetch(`${P}/uploads/${uploadId}?${q}&part=${n}`, { method: 'PUT', body }), `${path} part ${n}`)).json() as { partNumber: number; etag: string });
    }
    await ok(await fetch(`${P}/uploads/${uploadId}/complete`, json('POST', { path, parts })), path);
  } catch (e) {
    await fetch(`${P}/uploads/${uploadId}?${q}`, { method: 'DELETE' }).catch(() => {});
    throw e;
  }
}
