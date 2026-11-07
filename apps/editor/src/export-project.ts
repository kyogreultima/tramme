import { S } from './state.ts';
import { t } from './i18n/index.ts';

export interface ExportProject { id: string; docUrl: string }

export const exportProject = (): ExportProject => ({ id: S.project.peek().id, docUrl: S.docUrl.peek() });
export const sameExportProject = (project: ExportProject): boolean => S.project.peek()?.id === project.id && S.docUrl.peek() === project.docUrl;
export const requireExportProject = (project: ExportProject): void => {
  if (!sameExportProject(project)) throw new Error(t('topbar.projectChangedDuringExport'));
};
export async function waitExportProject<T>(project: ExportProject, pending: Promise<T>): Promise<T> {
  const result = await pending;
  requireExportProject(project);
  return result;
}
