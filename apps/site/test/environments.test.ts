import { afterEach, describe, expect, it, vi } from 'vitest';
import { ENVIRONMENTS, ENV_NAMES, originsFromEnv, resolveOrigins, siteOfApp } from '../../../brand/environments';

describe('the addresses of an environment', () => {
  it('is production for a build, local for a dev server', () => {
    expect(resolveOrigins()).toMatchObject({ env: 'production', site: 'https://tramme.dev', app: 'https://app.tramme.dev' });
    expect(resolveOrigins({ dev: true })).toMatchObject({ env: 'local', site: 'http://localhost:4321', app: 'http://localhost:8787' });
  });

  it('takes the environment that is named, even in dev', () => {
    expect(resolveOrigins({ env: 'preprod', dev: true }).env).toBe('preprod');
    expect(resolveOrigins({ env: 'beta' }).app).toBe(ENVIRONMENTS.beta.app);
  });

  it('refuses an environment that does not exist, rather than sending visitors to production', () => {
    expect(() => resolveOrigins({ env: 'prodution' })).toThrow(/unknown environment "prodution"/);
  });

  it('lets one address be set by hand, without a trailing slash, and ignores an empty one', () => {
    const o = resolveOrigins({ env: 'local', app: 'http://localhost:8790/', site: ' ' });
    expect(o.app).toBe('http://localhost:8790');
    expect(o.site).toBe(ENVIRONMENTS.local.site);
  });

  it('gives every environment two distinct, well-formed addresses', () => {
    for (const name of ENV_NAMES) {
      const { site, app } = ENVIRONMENTS[name];
      expect(new URL(site).origin, name).toBe(site);
      expect(new URL(app).origin, name).toBe(app);
      expect(site, name).not.toBe(app);
    }
    expect(new Set(ENV_NAMES.map((n) => ENVIRONMENTS[n].app)).size).toBe(ENV_NAMES.length);
  });

  it('tells the site of an app from the address the app is served at', () => {
    for (const name of ENV_NAMES) expect(siteOfApp(ENVIRONMENTS[name].app), name).toBe(ENVIRONMENTS[name].site);
    expect(siteOfApp('https://app.tramme.dev/')).toBe('https://tramme.dev');
    // any localhost is local, whatever its port (the trial server, another dev server)
    expect(siteOfApp('http://localhost:8790')).toBe(ENVIRONMENTS.local.site);
    expect(siteOfApp('http://127.0.0.1:8787')).toBe(ENVIRONMENTS.local.site);
    expect(siteOfApp('https://some-branch.pages.dev')).toBeUndefined();
    expect(siteOfApp('nonsense')).toBeUndefined();
  });

  it('reads the variables of the process (SITE_URL, the site\'s older one, still counts)', () => {
    expect(originsFromEnv({ TRAMME_ENV: 'beta' }, false).site).toBe(ENVIRONMENTS.beta.site);
    expect(originsFromEnv({ SITE_URL: 'https://preview.example/' }, false).site).toBe('https://preview.example');
    expect(originsFromEnv({ SITE_URL: 'https://old.example', TRAMME_SITE_URL: 'https://new.example' }, false).site).toBe('https://new.example');
    expect(originsFromEnv({}, true).env).toBe('local');
  });
});

describe('the site\'s links', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  const links = async (env: Record<string, string>) => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    vi.resetModules();
    return import('../src/lib/links');
  };

  it('lead to the production app by default', async () => {
    const { APP, signUp, logIn, space, appProject } = await links({ TRAMME_ENV: '' });
    expect(APP).toBe('https://app.tramme.dev');
    expect(signUp({ lang: 'fr' })).toBe('https://app.tramme.dev/signup?lang=fr');
    expect(logIn()).toBe('https://app.tramme.dev/login');
    expect(space()).toBe('https://app.tramme.dev/space');
    expect(appProject('a b')).toBe('https://app.tramme.dev/p/a%20b');
  });

  it('lead to the local app on this machine', async () => {
    const { APP, signUp } = await links({ TRAMME_ENV: 'local' });
    expect(APP).toBe('http://localhost:8787');
    expect(signUp({ prompt: 'A film' })).toBe('http://localhost:8787/signup?prompt=A%20film');
  });

  it('follow the environment of a deployment, and an address set by hand', async () => {
    expect((await links({ TRAMME_ENV: 'preprod' })).logIn()).toBe('https://app.preprod.tramme.dev/login');
    expect((await links({ TRAMME_ENV: 'local', TRAMME_APP_URL: 'http://localhost:8790' })).space()).toBe('http://localhost:8790/space');
  });

  it('give the site its own address for its canonical links', async () => {
    vi.stubEnv('TRAMME_ENV', 'beta');
    vi.resetModules();
    const { SITE } = await import('../src/lib/site');
    expect(SITE.url).toBe('https://beta.tramme.dev');
  });
});
