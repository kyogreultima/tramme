import { Evaluator, type EvaluatorOptions, type Registry, type TrammeDoc } from '@tramme/core';
import { sandboxedDoc } from './installed.ts';

/** Trusted editor-side reads never execute an isolated project's expressions. */
export function editorEvaluator(doc: TrammeDoc, registry: Registry, opts: Omit<EvaluatorOptions, 'allowExpressions'> = {}): Evaluator {
  return new Evaluator(doc, registry, { ...opts, allowExpressions: !sandboxedDoc(doc) });
}
