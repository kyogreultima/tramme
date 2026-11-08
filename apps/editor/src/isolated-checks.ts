// Quality checks run with the document evaluator in its isolated project worker.
import { runChecks, type QualityIssue, type ToolContext } from '@tramme/core';
import { sandboxedDoc } from './installed.ts';
import { prefs } from './settings.ts';

export async function qualityChecksOf(ctx: ToolContext, compId: string, data: (id: string) => unknown = () => undefined): Promise<QualityIssue[]> {
  if (!sandboxedDoc(ctx.doc) && !prefs.peek().sandboxPreview) return runChecks(ctx.doc, ctx.registry, compId, { data });
  const [{ fileProject, requireFileProject }, { preview }, { pluginHost }, { ensureDeclared, ensureSandboxDoc, moduleItemsOf }] = await Promise.all([
    import('./files.ts'), import('./preview.ts'), import('./plugins/index.ts'), import('./plugins/sandbox-draw.ts'),
  ]);
  const project = fileProject(), renderer = preview.renderer;
  if (!renderer) throw new Error('preview is not ready for isolated quality checks');
  const base = new URL(project.docUrl, location.href).href, host = pluginHost(base);
  await ensureDeclared(host, moduleItemsOf(ctx.doc, base));
  requireFileProject(project);
  ensureSandboxDoc(host, { doc: ctx.doc, docUrl: base, loaded: (id) => { try { return renderer.assets.get(id) ?? data(id); } catch { return data(id); } } });
  const values = await host.qualityChecks(compId);
  requireFileProject(project);
  return values;
}
