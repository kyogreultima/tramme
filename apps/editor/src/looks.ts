// A look matched on a clip: colour wheels (fx.wheels) put on it, the effect's
// own properties set to what matchGrade found, so the user can still change
// them. (looks-run.ts reads the pictures.)

import { pointer, type Op, type TrammeDoc, type WheelsParams } from '@tramme/core';

/** the operations putting these wheels on a clip: its own wheels' properties replaced when it has some, a new effect otherwise */
export function matchLookOps(doc: TrammeDoc, compId: string, id: string, p: WheelsParams): Op[] {
  const l = doc.compositions[compId]?.layers[id];
  if (!l) return [];
  const props = { lift: p.lift, liftLevel: p.liftLevel, gamma: p.gamma, gammaLevel: p.gammaLevel, gain: p.gain, gainLevel: p.gainLevel };
  const lp = pointer('compositions', compId, 'layers', id), effects = l.effects ?? [], at = effects.findIndex((e) => e.type === 'fx.wheels');
  if (at >= 0) return [{ op: 'replace', path: `${lp}/effects/${at}`, value: { ...effects[at], props } }];
  const fx = { id: 'wheels', type: 'fx.wheels', props };
  return [l.effects ? { op: 'add', path: `${lp}/effects/-`, value: fx } : { op: 'add', path: `${lp}/effects`, value: [fx] }];
}
