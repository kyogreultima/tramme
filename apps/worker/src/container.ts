// The accounts backend (AdonisJS, in the private platform repository) as a container behind the
// Worker. It has no address of its own: the only way to it is the Durable
// Object binding `ACCOUNTS`, which the Worker calls for the account routes
// (accounts.ts). One instance serves everyone; it sleeps when nobody asks, and
// wakes at the next request, running its migrations first (the image's
// entrypoint).

import { Container } from '@cloudflare/containers';
import { backendEnv } from './backend-env.ts';
import type { Env } from './http.ts';

export class AccountsContainer extends Container<Env> {
  defaultPort = 3333;
  // a quiet hour: the next visitor waits for the start, a person signing in minutes later does not
  sleepAfter = '1h';
  // the backend answers here once it is up (routes.ts), and the container is held until it does
  pingEndpoint = 'localhost/api/health';

  constructor(ctx: ConstructorParameters<typeof Container>[0], env: Env) {
    super(ctx, env);
    this.envVars = backendEnv(env);
  }
}

/**
 * The renderer: the command line's renders (Chrome and ffmpeg) in a container of its own (apps/renderer), for the
 * exports in the cloud (renders.ts). The queue sends it one project at a time; it sleeps when nobody exports.
 */
export class RendererContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = '10m';
  pingEndpoint = 'localhost/health';
}
