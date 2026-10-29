// tramme check: the picture checks of a document, read the way the assistant
// reads them in the editor (issues folded by cause, ranked, capped). The
// sound checks, the analyses of the media and the contact sheet need the
// editor; this is what a project says about itself without opening it.

import { groupIssues, reportHead, reportLines, runChecks, type Registry, type TrammeDoc } from '@tramme/core';

export async function checkReport(doc: TrammeDoc, registry: Registry, compId = doc.root): Promise<string> {
  if (!doc.compositions[compId]) throw new Error(`unknown composition: ${compId}`);
  const issues = await runChecks(doc, registry, compId);
  const { lines } = reportLines(groupIssues(issues), { doc, compId });
  return [reportHead(issues), ...lines, 'The picture checks only: the sound checks and the analyses of the media (subjects, space) need the editor.'].join('\n');
}
