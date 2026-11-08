// A layer's evaluated corners for authoring tools. Node bounds and project
// expressions run in the project worker when isolation is enabled.
import { sampleAt, type Quad, type ToolContext, type Vec2 } from '@tramme/core';
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

/** Values needed to frame a push, read from one project worker snapshot. */
export async function samplePushScene(ctx: ToolContext, layerId: string, at: number): Promise<{
  quad: Quad; placed: { box: { x: number; y: number; w: number; h: number } | null; textSize?: number }[];
  camera: { zoom: number; pan: Vec2 };
}> {
  if (!Number.isFinite(at)) throw new Error('invalid push sample time');
  const comp = ctx.doc.compositions[ctx.compId];
  if (!sandboxedDoc(ctx.doc) && !prefs.peek().sandboxPreview) {
    const ev = editorEvaluator(ctx.doc, ctx.registry);
    const camera = ev.frame(at, ctx.compId).camera;
    return { quad: quadAt(ev, ctx.compId, layerId, at), placed: sampleAt(ev, ctx.compId, at).layers,
      camera: { zoom: camera?.zoom ?? 1, pan: camera?.pan ?? [0, 0] } };
  }
  const [{ fileProject, requireFileProject }, { preview }, { pluginHost }, { ensureDeclared, ensureSandboxDoc, moduleItemsOf }] = await Promise.all([
    import('./files.ts'), import('./preview.ts'), import('./plugins/index.ts'), import('./plugins/sandbox-draw.ts'),
  ]);
  const project = fileProject(), renderer = preview.renderer;
  if (!renderer) throw new Error('preview is not ready for isolated push framing');
  const base = new URL(project.docUrl, location.href).href, host = pluginHost(base);
  await ensureDeclared(host, moduleItemsOf(ctx.doc, base));
  requireFileProject(project);
  ensureSandboxDoc(host, { doc: ctx.doc, docUrl: base, loaded: (id) => { try { return renderer.assets.get(id); } catch { return null; } } });
  const [quad] = await host.sampleQuads(layerId, ctx.compId, [at]);
  requireFileProject(project);
  const placed = await host.samplePlaced(at, ctx.compId);
  requireFileProject(project);
  let zoom = 1, pan: Vec2 = [0, 0];
  if (comp.camera) {
    const value = await host.evaluateValue('$comp.camera.zoom', at, ctx.compId);
    requireFileProject(project);
    const position = await host.evaluateValue('$comp.camera.pan', at, ctx.compId);
    requireFileProject(project);
    if (typeof value !== 'number' || !Number.isFinite(value) || !Array.isArray(position) || position.length !== 2 || !position.every(Number.isFinite)) throw new Error('invalid sandbox camera response');
    zoom = value; pan = position as Vec2;
  }
  return { quad, placed, camera: { zoom, pan } };
}
