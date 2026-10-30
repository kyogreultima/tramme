// A long film, scene by scene: each scene of the plan is built in a turn of its
// own, with no history, that inherits the brief, the plan and the document.
// The planner and the runner here take a function that runs one such turn, so
// they work on any route and are tested without one.

import type { Usage } from '@tramme/assistant';
import type { TrammeDoc } from '@tramme/core';
import type { AiEvent, TurnUsage } from '../api.ts';
import { setStatus, todoScenes, type FilmPlan, type PlanScene } from '../filmplan.ts';

/** what a scene builder is told: its scene, its composition, its brief and its neighbours' names, nothing of the other scenes */
export function scenePrompt(plan: FilmPlan, scene: PlanScene, doc: TrammeDoc): string {
  const i = plan.scenes.findIndex((s) => s.id === scene.id);
  const before = plan.scenes[i - 1], after = plan.scenes[i + 1];
  const comp = doc.compositions[scene.comp ?? ''];
  return [
    `Build one scene of the film, apart from the others: "${scene.name}" (id ${scene.id}), a scene of kind ${scene.kind}.`,
    `Its idea: ${scene.idea}`,
    `Its brief: ${scene.brief?.trim() || 'nothing beyond the plan'}.`,
    `Build it in the composition "${scene.comp}"${comp ? ` (${+comp.duration.toFixed(2)} s, ${comp.width} x ${comp.height})` : ''}: it exists already, the root plays it.`,
    before ? `It follows "${before.name}": take up what that scene leaves (a colour, a shape, a movement).` : 'It opens the film.',
    after ? `"${after.name}" follows it: leave it something to start from.` : 'It closes the film.',
    plan.target ? `Build to the kept style frame (${plan.target}) and the direction in the plan: its level of finish, its type, its palette, its light.` : 'Build to the direction in the plan.',
    `The other scenes are built apart by others: change nothing outside "${scene.comp}" (a proposal that does is refused). You may add assets, tokens and files of your own.`,
    `Propose your changes, look at the result (use_tool "check" on your composition, and look at stills), fix what matters, then call scene-done with scene "${scene.id}" and answer in one short line, with no summary for the user.`,
  ].join('\n');
}

export interface RunScenes {
  plan: FilmPlan;
  /** the document as it is now, a pending proposal included (the director's root and compositions are in it) */
  doc: () => TrammeDoc;
  /** one fresh turn for one scene; its usage events are added up into the scene's line */
  turn: (prompt: string, scene: PlanScene) => AsyncGenerator<AiEvent>;
  /** the plan as the files hold it now (the scene builder's scene-done writes it) */
  read: () => Promise<FilmPlan | null>;
  save: (plan: FilmPlan) => Promise<void>;
  /** the usage line of a scene's turn */
  line: (scene: PlanScene, usage: Usage, ms: number) => TurnUsage;
  signal: AbortSignal;
}

export interface ScenesResult { built: string[]; failed: { id: string; why: string }[]; skipped: { id: string; why: string }[] }

/**
 * Builds the scenes still to do, one after another. Each scene's items carry
 * its name (`building`) and its turn ends with its own usage line. After each,
 * the plan holds its state: built when its turn called scene-done, else failed.
 * A turn that throws fails its scene and the next one starts; a stop ends the run.
 */
export async function* runScenes(o: RunScenes): AsyncGenerator<AiEvent, ScenesResult> {
  const { run, skipped } = todoScenes(o.plan, o.doc());
  const out: ScenesResult = { built: [], failed: [], skipped: skipped.filter((s) => s.scene.status !== 'built').map((s) => ({ id: s.scene.id, why: s.why })) };
  let plan = o.plan;
  for (const scene of run) {
    if (o.signal.aborted) break;
    const started = Date.now();
    let used: Usage | null = null, why = '';
    try {
      for await (const ev of o.turn(scenePrompt(plan, scene, o.doc()), scene)) {
        if (ev.type === 'usage') { used = used ? { requests: used.requests + ev.usage.requests, input: used.input + ev.usage.input, cacheRead: used.cacheRead + ev.usage.cacheRead, cacheWrite: used.cacheWrite + ev.usage.cacheWrite, cacheWrite1h: used.cacheWrite1h + ev.usage.cacheWrite1h, output: used.output + ev.usage.output } : ev.usage; continue; }
        if (ev.type === 'error') { why = ev.message; continue; }
        yield ev.type === 'item' ? { ...ev, item: { ...ev.item, building: scene.name } } : ev;
      }
    } catch (e) {
      if (o.signal.aborted) break;
      why = (e as Error).message;
    }
    if (used) yield { type: 'item', item: { id: `scene-${scene.id}-usage`, role: 'assistant', building: scene.name, usage: o.line(scene, used, Date.now() - started) } };
    if (o.signal.aborted) break;
    // the scene's own state is in the file its scene-done wrote
    const now = (await o.read()) ?? plan;
    if (now.scenes.find((s) => s.id === scene.id)?.status === 'built' && !why) { plan = now; out.built.push(scene.id); continue; }
    plan = setStatus(now, scene.id, 'failed');
    await o.save(plan);
    out.failed.push({ id: scene.id, why: why || 'it ended without calling scene-done' });
  }
  return out;
}

/** the director's last prompt: what was built, what was not, and the assembly */
export function assemblyNote(r: ScenesResult): string {
  const lines = [
    `The scenes were built apart, each in its own context. Built: ${r.built.length ? r.built.join(', ') : 'none'}.`,
    ...(r.failed.length ? [`Failed (left as they are): ${r.failed.map((f) => `${f.id} (${f.why})`).join('; ')}. Raise them in your summary, or build them yourself if they matter.`] : []),
    ...(r.skipped.length ? [`Not run: ${r.skipped.map((f) => `${f.id} (${f.why})`).join('; ')}.`] : []),
    'Now assemble the film: the transitions between the scenes, the sound (music on the beats, the effects), then have it reviewed (use_tool "critique") and fix what it names, then the summary for the user.',
  ];
  return lines.join('\n');
}
