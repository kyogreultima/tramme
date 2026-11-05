// What the Worker is given, and small helpers of its own (the shared ones
// come from @tramme/api).

export { HttpError, json, readJson } from '@tramme/api';

export interface Env {
  /** the editor's static build (and the key vault's page) */
  ASSETS: Fetcher;
  /** 'personal': no storage, no keys on the server, everything in the visitor's browser; otherwise private (see docs/deploy.md) */
  MODE?: string;
  /** private mode: projects, libraries and the keys of the settings, under projects/<id>/<path>, library/, config/ */
  FILES?: R2Bucket;
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

export function cookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}
