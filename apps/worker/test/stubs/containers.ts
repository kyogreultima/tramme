// @cloudflare/containers needs the Workers runtime (it imports cloudflare:workers): the tests that import the
// Worker's entry get this stand-in, which holds what the class sets and starts nothing.
export class Container<Env = unknown> {
  envVars: Record<string, string> = {};
  ctx: unknown;
  env: Env;
  constructor(ctx: unknown, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
