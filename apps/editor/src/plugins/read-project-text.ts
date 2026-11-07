// A sandboxed tool may read a project text file, but its response must be
// bounded before the browser turns the stream into one string.
import { api, ApiError } from '../api.ts';
import { readLimitedBody } from './host.ts';

const MAX_TEXT_BYTES = 8 * 1024 * 1024;

export async function readProjectText(id: string, path: string): Promise<string | null> {
  const response = await fetch(api.fileUrl(id, path), { cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) throw new ApiError(response.status, `could not read ${path} (HTTP ${response.status})`);
  return new TextDecoder().decode(await readLimitedBody(response, MAX_TEXT_BYTES, 'project text'));
}
