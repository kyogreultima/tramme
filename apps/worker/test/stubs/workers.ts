// cloudflare:workers exists only in the Workers runtime: the tests that import the Worker's entry get this
// stand-in for the Durable Object base class, which holds its state and environment and runs nothing.
export class DurableObject<Env = unknown> {
  ctx: unknown;
  env: Env;
  constructor(ctx: unknown, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
