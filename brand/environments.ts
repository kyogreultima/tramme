// Where Tramme lives, by environment: the website and the app. The links from
// the site to the app (sign up, log in, open the editor) and from the app to
// the site (the terms) are written from these, never as a fixed address, so
// that every environment sends its visitors to its own other half.
//
//   local        what runs on this machine: `pnpm site` (4321) and `pnpm dev` (8787)
//   beta         the beta deployment
//   production   the public one
//
// The choice is TRAMME_ENV, read when the site or the editor is built or
// started. Without it: `local` while a dev server runs, `production` for a
// build. TRAMME_SITE_URL and TRAMME_APP_URL set one address by hand (another
// port, a branch deployment); the site's older SITE_URL still counts.
//
// The addresses of beta follow the production ones' pattern, the app on a
// subdomain of the site's; where the deployments really are is decided where
// they are created: change them here.

export const ENVIRONMENTS = {
  local: { site: 'http://localhost:4321', app: 'http://localhost:8787' },
  beta: { site: 'https://beta.tramme.dev', app: 'https://beta.app.tramme.dev' },
  production: { site: 'https://tramme.dev', app: 'https://app.tramme.dev' },
} as const;

export type EnvName = keyof typeof ENVIRONMENTS;
export const ENV_NAMES = Object.keys(ENVIRONMENTS) as EnvName[];

export interface Origins {
  env: EnvName;
  /** the website, without a trailing slash */
  site: string;
  /** the app (the editor), without a trailing slash */
  app: string;
}

const bare = (url: string) => url.trim().replace(/\/+$/, '');

/**
 * The addresses of an environment. `env` and the two overrides come from the
 * variables above (empty ones count as absent); `dev` says a dev server runs.
 * An environment that does not exist is an error: a typo must not quietly send
 * visitors to production.
 */
export function resolveOrigins(input: { env?: string; site?: string; app?: string; dev?: boolean } = {}): Origins {
  const name = input.env?.trim() || (input.dev ? 'local' : 'production');
  if (!(name in ENVIRONMENTS)) throw new Error(`unknown environment "${name}": one of ${ENV_NAMES.join(', ')}`);
  const base = ENVIRONMENTS[name as EnvName];
  return { env: name as EnvName, site: bare(input.site?.trim() || base.site), app: bare(input.app?.trim() || base.app) };
}

/**
 * The website that goes with an app, from the address the app is served at: the
 * app of an environment has that environment's site, and any `localhost` is the
 * local one (whatever its port). Nothing for an address it does not know. This
 * is what lets one built editor tell where it is, whatever it was built for.
 */
export function siteOfApp(origin: string): string | undefined {
  const o = bare(origin);
  for (const name of ENV_NAMES) if (ENVIRONMENTS[name].app === o) return ENVIRONMENTS[name].site;
  try {
    const host = new URL(o).hostname;
    if (host === 'localhost' || host === '127.0.0.1') return ENVIRONMENTS.local.site;
  } catch { /* not an address */ }
  return undefined;
}

/** the same, from the process's variables (the site's config and the editor's build) */
export function originsFromEnv(vars: Record<string, string | undefined>, dev: boolean): Origins {
  return resolveOrigins({ env: vars.TRAMME_ENV, site: vars.TRAMME_SITE_URL || vars.SITE_URL, app: vars.TRAMME_APP_URL, dev });
}
