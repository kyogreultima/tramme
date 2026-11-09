import { pathIssue } from '@tramme/project';
import { approvedProjectResource } from './plugins/host.ts';

/** A document media path approved for a read in the open project's assets. */
export function projectAssetUrl(src: string, docUrl: string): string {
  if (pathIssue(src) || /[%#]/.test(src) || !src.startsWith('assets/')) throw new Error(`${src}: media must be a project asset`);
  const base = new URL(docUrl, location.href), root = new URL('./', base), url = new URL(src, base);
  if (!approvedProjectResource(url, root.pathname, root.origin, root.protocol)) throw new Error(`${src}: media must belong to this project`);
  return url.href;
}
