// A layer's evaluated corners for authoring tools. Node bounds and project
// expressions run in the project worker when isolation is enabled.
import type { Quad, ToolContext } from '@tramme/core';
import { editorEvaluator } from './evaluator.ts';
import { sandboxedDoc } from './installed.ts';
import { prefs } from './settings.ts';
import { quadAt } from './quad.ts';

export async function sampleQuads(ctx: ToolContext, layerId: string, times: number[]): Promise<Quad[]> {
  if (!times.length || times.length > 4096 || times.some((t) => !Number.isFinite(t))) throw new Error('invalid quad sample times');
  if (!sandboxedDoc(ctx.doc) && !prefs.peek().sandboxPreview) {
    const ev = editorEvaluator(ctx.doc, ctx.registry);
    return times.map((at) => quadAt(ev, ctx.compId, layerId, at));
  }
  const [{ fileProject, requireFileProject }, { preview }, { pluginHost }, { ensureDeclared, ensureSandboxDoc, moduleItemsOf }] = await Promise.all([
    import('./files.ts'), import('./preview.ts'), import('./plugins/index.ts'), import('./plugins/sandbox-draw.ts'),
  ]);
  const project = fileProject(), renderer = preview.renderer;
  if (!renderer) throw new Error('preview is not ready for isolated layer corners');
  const base = new URL(project.docUrl, location.href).href, host = pluginHost(base);
  await ensureDeclared(host, moduleItemsOf(ctx.doc, base));
  requireFileProject(project);
  ensureSandboxDoc(host, { doc: ctx.doc, docUrl: base, loaded: (id) => { try { return renderer.assets.get(id); } catch { return null; } } });
  const out: Quad[] = [];
  for (let i = 0; i < times.length; i += 512) {
    out.push(...await host.sampleQuads(layerId, ctx.compId, times.slice(i, i + 512)));
    requireFileProject(project);
  }
  return out;
}
