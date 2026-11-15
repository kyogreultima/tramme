// What the Worker is given, and small helpers of its own (the shared ones
// come from @tramme/api).

export { cookieOf as cookie, HttpError, json, readJson } from '@tramme/api';

/**
 * A file of the editor's build, for a page the Worker rewrites (the editor's page in each mode): asked without the
 * browser's conditions, so a copy it kept of the page in another mode is never confirmed by a 304, and answered
 * without the build's ETag, which named the file before it was rewritten.
 */
export async function pageAsset(env: Env, req: Request): Promise<Response> {
  // the other files (scripts, pictures) keep their conditions: they are the same in every mode
  const page = req.headers.get('sec-fetch-dest') === 'document' || (req.headers.get('accept') ?? '').includes('text/html');
  if (!page) return env.ASSETS.fetch(req);
  const headers = new Headers(req.headers);
  headers.delete('if-none-match');
  headers.delete('if-modified-since');
  return env.ASSETS.fetch(new Request(req, { headers }));
}

/** the headers of a page the Worker rewrote: no length, no validator, never kept by a cache */
export function rewrittenHeaders(from: Headers): Headers {
  const headers = new Headers(from);
  for (const h of ['content-length', 'etag', 'last-modified']) headers.delete(h);
  headers.set('cache-control', 'no-store');
  return headers;
}

export interface Env {
  /** the editor's static build (and the key vault's page) */
  ASSETS: Fetcher;
  /** 'personal': no storage, no keys on the server, everything in the visitor's browser; otherwise private (see docs/deploy.md) */
  MODE?: string;
  /** private mode: projects, libraries and the keys of the settings, under projects/<id>/<path>, library/, config/;
   * with accounts, the files of every signed-in person, each workspace under w/<workspace>/ (cloud.ts) */
  FILES?: R2Bucket;
  /** accounts: the secret the keys kept in a workspace are sealed with (`openssl rand -hex 32`); without it, no cloud */
  KEYS_SECRET?: string;
  /** private mode, secrets: keys of the providers (optional; a key from the settings comes first, see @tramme/api keys.ts) */
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  ZAI_API_KEY?: string;
  GLM_API_KEY?: string;
  ELEVENLABS_API_KEY?: string;
  PEXELS_API_KEY?: string;
  /** Hydracept: its key, and the project (cpr_...) and environment the key belongs to */
  HYDRACEPT_API_KEY?: string;
  HYDRACEPT_PROJECT?: string;
  HYDRACEPT_ENVIRONMENT?: string;
  /** private mode, Workers AI: speech to text (Whisper) */
  AI?: Ai;
  /** private mode, Cloudflare Access: team domain (equipe.cloudflareaccess.com) and application audience tag */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** '1' only from `wrangler dev` on this machine: no Access check */
  DEV_OPEN?: string;
  /** accounts: the backend (the private platform repository) as a container behind this Worker, with no address of its own (container.ts) */
  ACCOUNTS?: DurableObjectNamespace;
  /** accounts, in development: the address of a backend started on this machine; neither this nor ACCOUNTS: no accounts */
  ACCOUNTS_URL?: string;
  /** accounts: what the backend container is started with (backend-env.ts); the secrets by `wrangler secret put` */
  APP_KEY?: string;
  DATABASE_URL?: string;
  EDGE_SECRET?: string;
  INTERNAL_SECRET?: string;
  MAIL_MAILER?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USERNAME?: string;
  SMTP_PASSWORD?: string;
  MAIL_FROM_NAME?: string;
  MAIL_FROM_ADDRESS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  BILLING_PROVIDER?: string;
  BILLING_WEBHOOK_SECRET?: string;
  WELCOME_CREDITS?: string;
  LOG_LEVEL?: string;
  /** personal mode: the editor's address and the key vault's, another origin of the same site (https://tramme.app, https://cles.tramme.app) */
  APP_ORIGIN?: string;
  VAULT_ORIGIN?: string;
  /** personal mode: how many requests a visitor may send through the relay (rate limiting binding) */
  RELAY_LIMIT?: RateLimit;
}
