// The phone's fetch (device.ts carryBodies): a body to the app's own origin goes through the
// IPC first, in parts, and the request leaves without it, naming it; the rest is left alone.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fromBase64 } from '@tramme/interop';

const invoke = vi.fn(async (_cmd: string, _args?: Record<string, unknown>) => undefined);
vi.mock('../src/tauri.ts', () => ({ platform: 'android', tauri: { core: { invoke } } }));

const { carriesBody, carryBodies, withoutBody } = await import('../src/device.ts');

const ORIGIN = 'http://tramme.localhost';
let sent: { url: string; init?: RequestInit }[];

beforeEach(() => {
  sent = [];
  invoke.mockClear();
  vi.stubGlobal('location', { origin: ORIGIN });
  vi.stubGlobal('window', { fetch: async (url: string, init?: RequestInit) => { sent.push({ url, init }); return new Response('{}'); } });
  carryBodies();
});
afterEach(() => vi.unstubAllGlobals());

/** the bytes the IPC was given for a token, put back together */
const laid = (token: string) => {
  const parts = invoke.mock.calls.filter(([cmd, a]) => cmd === 'device_body' && a?.token === token).map(([, a]) => fromBase64(a!.part as string));
  return Buffer.concat(parts.map((p) => Buffer.from(p)));
};

describe('the bodies of the phone app\'s requests', () => {
  it('a POST to the app carries its JSON through the IPC and names it', async () => {
    await window.fetch(`${ORIGIN}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"film"}' });
    const [{ init }] = sent;
    const headers = new Headers(init!.headers);
    const token = headers.get('x-tramme-body')!;
    expect(token).toBeTruthy();
    expect(init!.method).toBe('POST');
    expect(init!.body).toBeUndefined();
    expect(headers.get('content-type')).toBe('application/json');
    expect(laid(token).toString()).toBe('{"name":"film"}');
  });

  it('a large body goes in several parts, in order', async () => {
    const big = new Uint8Array(9 << 20).map((_, i) => i % 251);
    await window.fetch(`${ORIGIN}/api/device/exports/a.mp4?at=0`, { method: 'PUT', body: big });
    const token = new Headers(sent[0].init!.headers).get('x-tramme-body')!;
    expect(invoke.mock.calls.length).toBe(3);
    expect(laid(token).equals(Buffer.from(big))).toBe(true);
  });

  it('a GET, an empty body and another origin go as they are', async () => {
    await window.fetch(`${ORIGIN}/api/config`);
    await window.fetch(`${ORIGIN}/api/device/exports/a.mp4?at=0`, { method: 'PUT', body: new Uint8Array(0) });
    await window.fetch('https://api.openverse.org/v1/x', { method: 'POST', body: 'x' });
    expect(invoke).not.toHaveBeenCalled();
    expect(sent.map((s) => new Headers(s.init?.headers).get('x-tramme-body'))).toEqual([null, null, null]);
    expect(sent[1].init!.method).toBe('PUT');
  });
});

describe('which requests move their body', () => {
  it('only the ones with a method that has one, to the app itself', () => {
    expect(carriesBody(new Request(`${ORIGIN}/api/x`, { method: 'DELETE' }), ORIGIN)).toBe(true);
    expect(carriesBody(new Request(`${ORIGIN}/api/x`), ORIGIN)).toBe(false);
    expect(carriesBody(new Request('https://example.com/x', { method: 'POST', body: 'x' }), ORIGIN)).toBe(false);
  });

  it('the request that leaves keeps its method and headers, without a token when there is none', () => {
    const init = withoutBody(new Request(`${ORIGIN}/api/x`, { method: 'PATCH', headers: { 'if-match': '"1"' } }));
    expect(init.method).toBe('PATCH');
    expect(new Headers(init.headers).get('if-match')).toBe('"1"');
    expect(new Headers(init.headers).has('x-tramme-body')).toBe(false);
  });
});
