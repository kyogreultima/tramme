// What the accounts backend (apps/server) is started with, when it runs as a
// container behind the Worker. The container has no environment of its own:
// the Worker gives it one, from its own settings and secrets (wrangler.jsonc's
// vars, `wrangler secret put`), by the names the backend reads (start/env.ts).

import type { Env } from './http.ts';

/** what the container always runs with: how it listens, where its state goes, who it trusts */
const FIXED: Record<string, string> = {
  NODE_ENV: 'production',
  TZ: 'UTC',
  HOST: '0.0.0.0',
  PORT: '3333',
  // only the Worker reaches it: its own address, and the sign-in it throttles by the visitor's address that the Worker passes
  APP_URL: 'http://localhost:3333',
  TRUST_PROXY: 'true',
  // sessions in the cookie, the rate limits in Postgres: the container can be stopped and started at any time
  SESSION_DRIVER: 'cookie',
  LIMITER_STORE: 'database',
};

/** the settings and secrets of the Worker that the backend is given, as it names them; the ones not set are left out */
export const BACKEND_VARIABLES = [
  'APP_ORIGIN', 'APP_KEY', 'DATABASE_URL', 'EDGE_SECRET', 'INTERNAL_SECRET',
  'MAIL_MAILER', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USERNAME', 'SMTP_PASSWORD', 'MAIL_FROM_NAME', 'MAIL_FROM_ADDRESS',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET',
  'BILLING_PROVIDER', 'BILLING_WEBHOOK_SECRET', 'WELCOME_CREDITS', 'LOG_LEVEL',
] as const satisfies readonly (keyof Env)[];

/** the environment of the container */
export function backendEnv(env: Env): Record<string, string> {
  const out: Record<string, string> = { LOG_LEVEL: 'info', MAIL_MAILER: 'smtp', ...FIXED };
  for (const name of BACKEND_VARIABLES) {
    const value = env[name];
    if (value !== undefined && value !== '') out[name] = String(value);
  }
  // what the container is told is not for a setting of the Worker to override
  return { ...out, ...FIXED };
}
