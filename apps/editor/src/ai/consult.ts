// One request in a fresh context: no tools, no history, whichever route the
// turn runs on. The critic is made with it: a model that did not make the
// work reads the evidence and answers once. It never touches the conversation
// (the server's messages, the companion's session) or the tool runner.

import { addUsage, engineOf, NO_USAGE, type Effort, type Engine, type Usage } from '@tramme/assistant';
import type { AiEvent, TurnUsage } from '../api.ts';
import { companionTurn, type CompanionLink } from './companion.ts';
import { ServerSession, type ChatTarget } from './server.ts';
import type { ToolRunner } from './tools.ts';

/** the model that reviews on the routes that have the strongest one: the rest review with the turn's own */
const CRITIC = 'claude-opus-5-5';

export type ConsultRoute = 'companion' | 'server' | 'remote' | 'local';

/** where a consult goes: the route and what it needs, as the turn would have used them */
export interface Via {
  route: ConsultRoute;
  /** the model the request is made to (the companion's engine takes its own name for it) */
  model: string;
  /** remote and local routes: the chat server */
  target?: ChatTarget;
  /** the companion: the agent that answers, and where it runs */
  engine?: Engine;
  link?: CompanionLink;
  effort?: Effort;
}

export interface ConsultRequest {
  system: string;
  text: string;
  images: { mediaType: string; data: string }[];
  /** instead of the route's model */
  model?: string;
  effort?: Effort;
  signal: AbortSignal;
}

/** Opus 5.5 on the server and with the companion's Claude, the turn's own model on every other route */
export function criticModel(route: ConsultRoute, turnModel: string): string {
  return route === 'server' || (route === 'companion' && engineOf(turnModel) === 'claude') ? CRITIC : turnModel;
}

/** whether a model takes pictures: every one does but a local one that does not say it sees (llava, vision, vl) */
export function seesPictures(model: string): boolean {
  return !model.startsWith('local:') || /llava|vision|vl/i.test(model.slice('local:'.length));
}

/** a turn's usage with one more consult added, counted apart from the turn's own */
export function addConsult(usage: TurnUsage, u: Usage, model: string): TurnUsage {
  const { n = 0, model: _, ...had } = usage.consults ?? { n: 0, model, ...NO_USAGE };
  return { ...usage, consults: { ...addUsage({ ...NO_USAGE, ...had }, u), n: n + 1, model } };
}

/** a runner that has no tools: a request in a fresh context offers none, and a model that calls one anyway is answered by an error */
const NO_TOOLS = { run: async () => { throw new Error('no tools in a consult'); } } as unknown as ToolRunner;

/** what an answer said and what it cost */
async function collect(events: AsyncGenerator<AiEvent>): Promise<{ text: string; usage: Usage }> {
  const texts = new Map<string, string>();
  let usage = NO_USAGE;
  for await (const ev of events) {
    if (ev.type === 'item' && ev.item.text !== undefined) texts.set(ev.item.id, ev.item.text);
    else if (ev.type === 'text') texts.set(ev.id, (texts.get(ev.id) ?? '') + ev.delta);
    else if (ev.type === 'usage') usage = addUsage(usage, ev.usage);
    else if (ev.type === 'error') throw new Error(ev.message);
  }
  return { text: [...texts.values()].join('').trim(), usage };
}

/** one request, one answer; throws with the route's message when it fails */
export function consult(req: ConsultRequest, via: Via): Promise<{ text: string; usage: Usage }> {
  const model = req.model ?? via.model, effort = req.effort ?? via.effort;
  if (via.route === 'companion') {
    if (!via.link || !via.engine) throw new Error('the companion is not reachable');
    return collect(companionTurn(via.link, { engine: via.engine, prompt: req.text, system: req.system, model, effort, images: req.images, tools: false }, NO_TOOLS, req.signal, () => {}));
  }
  return collect(new ServerSession().turn(req.text, model, req.system, NO_TOOLS, req.signal, { images: req.images, target: via.target, effort, tools: false }));
}
