// Bounded placed-layer samples for authoring and review reads.
import type { ToolContext } from '@tramme/core';
import type { PlacedSample } from './plugins/protocol.ts';

export async function samplePlacedTimes(ctx: ToolContext, compId: string, times: number[]): Promise<PlacedSample[][]> {
  if (times.length > 512 || times.some((t) => !Number.isFinite(t))) throw new Error('invalid placed sample times');
  if (!times.length) return [];
  const [{ fileProject, requireFileProject }, { preview }, { pluginHost }, { ensureDeclared, ensureSandboxDoc, moduleItemsOf }] = await Promise.all([
    import('./files.ts'), import('./preview.ts'), import('./plugins/index.ts'), import('./plugins/sandbox-draw.ts'),
  ]);
  const project = fileProject(), renderer = preview.renderer;
  if (!renderer) throw new Error('preview is not ready for isolated placed samples');
  const base = new URL(project.docUrl, location.href).href, host = pluginHost(base);
  await ensureDeclared(host, moduleItemsOf(ctx.doc, base));
  requireFileProject(project);
  ensureSandboxDoc(host, { doc: ctx.doc, docUrl: base, loaded: (id) => { try { return renderer.assets.get(id); } catch { return null; } } });
  const out: PlacedSample[][] = [];
  for (const at of times) {
    out.push(await host.samplePlaced(at, compId));
    requireFileProject(project);
  }
  return out;
}
