// Authoring tools ask for finite media-clock samples. The worker keeps the
// evaluator and its expression callbacks; only plain times cross the bridge.
import { layerClock, type ToolContext } from '@tramme/core';
import { editorEvaluator } from './evaluator.ts';
import { sandboxedDoc } from './installed.ts';
import { prefs } from './settings.ts';
import type { ClockSample } from './plugins/protocol.ts';

export async function sampleLayerClock(ctx: ToolContext, layerId: string, compTimes: number[], fileTimes: number[]): Promise<ClockSample> {
  if (compTimes.length + fileTimes.length > 4096 || [...compTimes, ...fileTimes].some((t) => !Number.isFinite(t))) throw new Error('too many layer clock samples');
  if (!sandboxedDoc(ctx.doc) && !prefs.peek().sandboxPreview) {
    const sampled = layerClock(editorEvaluator(ctx.doc, ctx.registry), ctx.compId, layerId);
    return { clock: sampled.clock, fileTimes: compTimes.map(sampled.fileTime), moments: fileTimes.map(sampled.moments) };
  }
  const [{ fileProject, requireFileProject }, { preview }, { pluginHost }, { ensureDeclared, ensureSandboxDoc, moduleItemsOf }] = await Promise.all([
    import('./files.ts'), import('./preview.ts'), import('./plugins/index.ts'), import('./plugins/sandbox-draw.ts'),
  ]);
  const project = fileProject(), renderer = preview.renderer;
  if (!renderer) throw new Error('preview is not ready for isolated layer clock');
  const base = new URL(project.docUrl, location.href).href, host = pluginHost(base);
  await ensureDeclared(host, moduleItemsOf(ctx.doc, base));
  requireFileProject(project);
  ensureSandboxDoc(host, { doc: ctx.doc, docUrl: base, loaded: (id) => { try { return renderer.assets.get(id); } catch { return null; } } });
  let clock: ClockSample['clock'] = {};
  const mapped: number[] = [], moments: number[][] = [];
  const take = async (times: number[], files: number[]) => {
    const result = await host.sampleClock(layerId, ctx.compId, times, files);
    requireFileProject(project);
    clock = result.clock;
    mapped.push(...result.fileTimes);
    moments.push(...result.moments);
  };
  if (compTimes.length + fileTimes.length <= 512) await take(compTimes, fileTimes);
  else {
    for (let i = 0; i < compTimes.length; i += 256) await take(compTimes.slice(i, i + 256), []);
    for (let i = 0; i < fileTimes.length; i += 256) await take([], fileTimes.slice(i, i + 256));
  }
  return { clock, fileTimes: mapped, moments };
}
