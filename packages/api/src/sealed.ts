// A signed-in person's provider keys, kept in their workspace in the cloud and
// sealed: AES-GCM 256 under a key derived (HKDF-SHA-256) from the Worker's
// KEYS_SECRET and the workspace's id, so a copy of the bucket reads none of them,
// and one workspace's sealed keys never open with another's.

import type { Bucket } from './bucket.ts';
import { HttpError } from './http.ts';
import { storedKeys, type KeyStore, type StoredKeys } from './keys.ts';

interface Sealed { v: 1; iv: string; data: string }

const encoder = new TextEncoder();
const b64 = (bytes: Uint8Array) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyFor(secret: string, context: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('tramme-keys'), info: encoder.encode(context) },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

/** the keys kept as one object of a bucket (the workspace's view, prefixed.ts), sealed for one context (the workspace's id) */
export function sealedKeyStore(bucket: Bucket, secret: string, context: string, key = 'config/keys.json'): KeyStore {
  if (!secret) throw new HttpError(500, 'KEYS_SECRET is missing: the keys cannot be kept');
  return {
    async load(): Promise<StoredKeys> {
      const o = await bucket.get(key);
      if (!o) return storedKeys(null);
      try {
        const s = JSON.parse(new TextDecoder().decode(await o.arrayBuffer())) as Sealed;
        if (s?.v !== 1) throw new Error('not sealed');
        const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(s.iv) }, await keyFor(secret, context), unb64(s.data));
        return storedKeys(JSON.parse(new TextDecoder().decode(clear)));
      } catch {
        throw new HttpError(500, 'the keys cannot be read');
      }
    },
    async save(keys: StoredKeys) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(secret, context), encoder.encode(JSON.stringify(keys))));
      await bucket.put(key, JSON.stringify({ v: 1, iv: b64(iv), data: b64(data) } satisfies Sealed), { httpMetadata: { contentType: 'application/json' } });
    },
  };
}
