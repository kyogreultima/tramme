// The providers' keys, typed in the editor's settings, and never sent back to
// the editor, which only learns which providers are connected. Where they are
// kept depends on where the routes run: in R2 behind Cloudflare Access on the
// private Worker, in the key vault's own storage in the browser (personal
// mode, see apps/editor/src/vault). On the Worker, a secret of the same
// provider (wrangler secret put) still works; a key from the settings comes
// first. Custom providers speak the OpenAI chat format at their own address.
// A provider may take settings of its own next to its key (Hydracept: the
// project the calls are billed to); they come from the same place as the key.
//
//   PUT    /api/keys/:provider        {key, ...fields}      connect a provider (or change its key)
//   DELETE /api/keys/:provider                              disconnect it
//   PUT    /api/keys/custom/:id       {label, base, key?}   add or change a custom provider (key kept when absent)
//   DELETE /api/keys/custom/:id                             remove it
//   DELETE /api/keys                                        forget every key and custom provider
// What is connected comes with GET /api/config (keys).

import type { Bucket } from './bucket.ts';
import { HttpError, json, readJson } from './http.ts';
import KEYED from './keyed-providers.json' with { type: 'json' };

export type KeyedProvider = keyof typeof KEYED;

/** a setting a provider takes next to its key (never a secret: the editor may show it) */
export interface ProviderField { name: string; required?: boolean }
/** each provider: where it answers (its key goes nowhere else) and the settings it takes next to its key;
 * keyed-providers.json, which the desktop app builds in too (apps/desktop/src-tauri/src/keys.rs) */
export const KEYED_PROVIDERS: Record<KeyedProvider, { origin: string; fields?: ProviderField[] }> = KEYED;
export const PROVIDERS = Object.keys(KEYED_PROVIDERS) as KeyedProvider[];
const fieldsOf = (p: KeyedProvider) => KEYED_PROVIDERS[p].fields ?? [];

/** a provider of the OpenAI chat format added by the user: its name, its address (…/v1) and its key, if it takes one */
export interface Custom { id: string; label: string; base: string; key?: string }
export type FieldValues = Partial<Record<KeyedProvider, Record<string, string>>>;
export interface StoredKeys { keys: Partial<Record<KeyedProvider, string>>; fields?: FieldValues; custom: Custom[] }

/** where the keys of the settings are kept */
export interface KeyStore {
  load(): Promise<StoredKeys>;
  save(s: StoredKeys): Promise<void>;
}

/** keys set outside the settings (the Worker's secrets): the key, and the name to set it under */
export interface Secrets {
  read(p: KeyedProvider): string | undefined;
  name(p: KeyedProvider): string;
  /** a setting of the provider set next to its secret (Hydracept: HYDRACEPT_PROJECT) */
  field?(p: KeyedProvider, name: string): string | undefined;
}

/** where the key of a provider comes from: the settings, a Worker secret, or nowhere */
export type KeySource = 'settings' | 'server' | null;
/** what the browser may know: no key, only where each comes from */
export interface KeyStatus { providers: Record<KeyedProvider, KeySource>; fields?: FieldValues; custom: { id: string; label: string; base: string; key: boolean }[] }

const CUSTOM_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const isProvider = (p: string): p is KeyedProvider => (PROVIDERS as readonly string[]).includes(p);

/** a stored value as it should be, whatever was read */
export function storedKeys(j: Partial<StoredKeys> | null | undefined): StoredKeys {
  return { keys: j?.keys && typeof j.keys === 'object' ? j.keys : {}, fields: j?.fields && typeof j.fields === 'object' ? j.fields : {}, custom: Array.isArray(j?.custom) ? j.custom : [] };
}

/** the keys kept as one object of a bucket (R2 on the Worker) */
export function bucketKeyStore(bucket: Bucket, key = 'config/keys.json'): KeyStore {
  return {
    async load() {
      const o = await bucket.get(key);
      if (!o) return storedKeys(null);
      try { return storedKeys(await o.json<Partial<StoredKeys>>()); } catch { return storedKeys(null); }
    },
    async save(s) { await bucket.put(key, JSON.stringify(s), { httpMetadata: { contentType: 'application/json' } }); },
  };
}

/** the keys of a request: read once, then asked by provider */
export interface Keys {
  get(p: KeyedProvider): string | undefined;
  /** a setting of the provider, from where its key comes from */
  field(p: KeyedProvider, name: string): string | undefined;
  /** how to connect the providers named, for a message saying none is: "connect it in Settings, Providers…" */
  how(providers: KeyedProvider[], one?: 'it' | 'one'): string;
  custom(id: string): Custom | undefined;
  status(): KeyStatus;
}

export async function loadKeys(store: KeyStore, secrets?: Secrets): Promise<Keys> {
  const s = await store.load();
  const secret = (p: KeyedProvider) => secrets?.read(p);
  const stored = (p: KeyedProvider, name: string) => s.fields?.[p]?.[name] || undefined;
  const served = (p: KeyedProvider, name: string) => secrets?.field?.(p, name) || undefined;
  // a key counts only with the settings it needs, from the same place
  const whole = (p: KeyedProvider, read: (p: KeyedProvider, name: string) => string | undefined) => fieldsOf(p).every((f) => !f.required || read(p, f.name));
  const source = (p: KeyedProvider): KeySource => (s.keys[p] && whole(p, stored) ? 'settings' : secret(p) && whole(p, served) ? 'server' : null);
  return {
    get: (p) => { const from = source(p); return from === 'settings' ? s.keys[p] : from === 'server' ? secret(p) : undefined; },
    field: (p, name) => { const from = source(p); return from === 'settings' ? stored(p, name) : from === 'server' ? served(p, name) : undefined; },
    how: (providers, one = 'it') => `connect ${one} in Settings, Providers${secrets ? ` (or npx wrangler secret put ${providers.map((p) => secrets.name(p)).join(' or ')})` : ''}`,
    custom: (id) => s.custom.find((c) => c.id === id),
    status: () => ({
      providers: Object.fromEntries(PROVIDERS.map((p) => [p, source(p)])) as KeyStatus['providers'],
      fields: Object.fromEntries(PROVIDERS.filter((p) => s.fields?.[p]).map((p) => [p, { ...s.fields![p] }])) as FieldValues,
      custom: s.custom.map(({ id, label, base, key }) => ({ id, label, base, key: !!key })),
    }),
  };
}

/** a key as typed: one line, without spaces around it */
function keyOf(v: unknown, required: boolean): string | undefined {
  const k = typeof v === 'string' ? v.trim() : '';
  if (!k) { if (required) throw new HttpError(400, 'the key is missing'); return undefined; }
  if (k.length > 1000 || /\s/.test(k)) throw new HttpError(400, 'this does not look like a key (one word, without spaces)');
  return k;
}

/** a setting typed next to a key: one short line */
function fieldOf(v: unknown): string | undefined {
  const k = typeof v === 'string' ? v.trim() : '';
  if (!k) return undefined;
  if (k.length > 200 || /\s/.test(k)) throw new HttpError(400, 'this setting is one word, without spaces');
  return k;
}

/** an address of the chat format, without its trailing slash */
function baseOf(v: unknown): string {
  const raw = typeof v === 'string' ? v.trim().replace(/\/+$/, '') : '';
  let url: URL;
  try { url = new URL(raw); } catch { throw new HttpError(400, 'the address is not a URL (https://…/v1)'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new HttpError(400, 'the address must start with https://');
  return raw;
}

export async function keysRoute(req: Request, store: KeyStore, parts: string[]): Promise<Response> {
  const m = req.method;
  const s = await store.load();
  if (!parts.length || (parts.length === 1 && !parts[0])) {
    if (m === 'DELETE') {
      await store.save(storedKeys(null));
      return json({ deleted: 'all' });
    }
  } else if (parts[0] === 'custom' && parts[1]) {
    const id = parts[1];
    if (!CUSTOM_ID.test(id)) throw new HttpError(400, 'custom provider id: lower case letters, digits and -');
    const before = s.custom.find((c) => c.id === id);
    if (m === 'DELETE') {
      await store.save({ ...s, custom: s.custom.filter((c) => c.id !== id) });
      return json({ deleted: id });
    }
    if (m === 'PUT') {
      const b = await readJson<{ label?: unknown; base?: unknown; key?: unknown }>(req);
      const label = typeof b.label === 'string' ? b.label.trim().slice(0, 40) : '';
      if (!label) throw new HttpError(400, 'the provider needs a name');
      const custom: Custom = { id, label, base: baseOf(b.base), key: keyOf(b.key, false) ?? before?.key };
      if (!custom.key) delete custom.key;
      await store.save({ ...s, custom: before ? s.custom.map((c) => (c.id === id ? custom : c)) : [...s.custom, custom] });
      return json({ id, label: custom.label, base: custom.base, key: !!custom.key });
    }
  } else if (parts[0] && !parts[1]) {
    const p = parts[0];
    if (!isProvider(p)) throw new HttpError(404, `unknown provider: ${p}`);
    if (m === 'DELETE') {
      const { [p]: _, ...rest } = s.keys;
      const { [p]: __, ...fields } = s.fields ?? {};
      await store.save({ ...s, keys: rest, fields });
      return json({ deleted: p });
    }
    if (m === 'PUT') {
      const b = await readJson<Record<string, unknown>>(req);
      const key = keyOf(b.key, true)!;
      const values: Record<string, string> = {};
      for (const f of fieldsOf(p)) {
        const v = fieldOf(b[f.name]);
        if (v) values[f.name] = v;
        else if (f.required) throw new HttpError(400, `${p} needs its ${f.name}`);
      }
      const { [p]: _, ...fields } = s.fields ?? {};
      await store.save({ ...s, keys: { ...s.keys, [p]: key }, fields: Object.keys(values).length ? { ...fields, [p]: values } : fields });
      return json({ provider: p });
    }
  }
  throw new HttpError(404, 'unknown keys route');
}
