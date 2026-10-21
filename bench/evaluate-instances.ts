// The Evaluator alone on the load case of many instances (docs/performance-roadmap.md,
// step 3): 400 instances of a component, read through a distribution and a
// time field, frame after frame, without drawing. node bench/evaluate-instances.ts
// prints the milliseconds a frame takes; node --cpu-prof profiles it.

import { Evaluator, instanceTime, type Instance, type Placement } from '@tramme/core';
import { builtinRegistry } from '@tramme/nodes';
import { loadCases } from './load/cases.ts';
const c = loadCases().find((x) => x.id === 'instances')!;
const ev = new Evaluator(c.doc, builtinRegistry());
const run = (t: number) => {
  const L = ev.layerAt('grid', t, 'main');
  for (const one of L.props.$instances as ({ instance: Instance } & Placement)[]) ev.frame(instanceTime(t, one, 2), 'card', one.instance);
};
for (let f = 0; f < 10; f++) run(f / 30);
const t0 = performance.now(), n = 120;
for (let f = 0; f < n; f++) run((f % 60) / 30);
console.log('EVAL ms/frame', ((performance.now() - t0) / n).toFixed(2));
