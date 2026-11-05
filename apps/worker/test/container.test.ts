import { describe, expect, it } from 'vitest';
import { backendEnv } from '../src/backend-env.ts';
import { AccountsContainer } from '../src/container.ts';
import type { Env } from '../src/http.ts';

const env = (over: Partial<Env> = {}) => ({ ASSETS: {}, ...over }) as unknown as Env;

describe('the environment of the accounts backend container', () => {
  it('gives it how to listen, where its state goes, and whom to trust', () => {
    const e = backendEnv(env());
    expect(e).toMatchObject({ NODE_ENV: 'production', HOST: '0.0.0.0', PORT: '3333', SESSION_DRIVER: 'cookie', LIMITER_STORE: 'database', TRUST_PROXY: 'true' });
  });

  it('copies the settings and the secrets of the Worker, by the names the backend reads, and leaves out what is not set', () => {
    const e = backendEnv(env({ APP_KEY: 'k', DATABASE_URL: 'postgres://x', EDGE_SECRET: 'e', INTERNAL_SECRET: 'i', APP_ORIGIN: 'https://app.example', SMTP_PORT: '465', GITHUB_CLIENT_ID: 'gh', GOOGLE_CLIENT_ID: '' }));
    expect(e).toMatchObject({ APP_KEY: 'k', DATABASE_URL: 'postgres://x', EDGE_SECRET: 'e', INTERNAL_SECRET: 'i', APP_ORIGIN: 'https://app.example', SMTP_PORT: '465', GITHUB_CLIENT_ID: 'gh' });
    expect('GOOGLE_CLIENT_ID' in e).toBe(false);
    expect('BILLING_PROVIDER' in e).toBe(false);
  });

  it('keeps what the container is told apart from the Worker\'s settings: nothing there can turn the trust off', () => {
    const e = backendEnv(env({ ...({ TRUST_PROXY: 'false', PORT: '1', NODE_ENV: 'development' } as object) }));
    expect(e.TRUST_PROXY).toBe('true');
    expect(e.PORT).toBe('3333');
    expect(e.NODE_ENV).toBe('production');
  });

  // that every name it passes is one the backend reads, and that none the backend needs is missing, is checked
  // by the platform repository (test/backend-env.test.ts), which holds the backend
});

describe('the container', () => {
  it('runs the backend on its port, is held until it answers, and is started with the environment above', () => {
    const c = new AccountsContainer({} as ConstructorParameters<typeof AccountsContainer>[0], env({ APP_KEY: 'k', EDGE_SECRET: 'e' }));
    expect(c.defaultPort).toBe(3333);
    expect(c.pingEndpoint).toBe('localhost/api/health');
    expect(c.envVars).toMatchObject({ APP_KEY: 'k', EDGE_SECRET: 'e', TRUST_PROXY: 'true' });
  });
});
