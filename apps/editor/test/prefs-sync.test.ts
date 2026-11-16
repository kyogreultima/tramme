// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

const { account } = await import('../src/accounts.ts');
const { prefs, setPrefs, DEFAULT_PREFERENCES } = await import('../src/settings.ts');
const { merged, shared, startPrefsSync } = await import('../src/prefs-sync.ts');

const user = { id: 'u1', email: 'ada@example.com', name: 'Ada' } as never;
const sent: unknown[] = [];
let kept: Record<string, unknown> | null = null;

function answer(body: unknown) { return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }); }

vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
  if (path !== '/api/account/preferences') return new Response('{}', { status: 404 });
  if (init?.method === 'PUT') { const b = JSON.parse(String(init.body)); sent.push(b.preferences); kept = b.preferences; return answer({ updatedAt: 'now' }); }
  return answer({ preferences: kept, updatedAt: kept ? 'then' : null });
}));

afterEach(() => { vi.useRealTimers(); });

describe('the preferences of the account', () => {
  it('keeps what belongs to this device out of the account', () => {
    const p = { ...DEFAULT_PREFERENCES, quickLauncher: true, lastUpdateCheck: 42, theme: 'paper' as const };
    expect(shared(p)).not.toHaveProperty('quickLauncher');
    expect(shared(p)).not.toHaveProperty('lastUpdateCheck');
    expect(shared(p).theme).toBe('paper');
    const back = merged(p, { theme: 'carbon', quickLauncher: false, lastUpdateCheck: 0 });
    expect(back.theme).toBe('carbon');
    expect(back.quickLauncher).toBe(true);
    expect(back.lastUpdateCheck).toBe(42);
    // what the account holds is checked as this browser's is
    expect(merged(p, { theme: 'nonsense' as never }).theme).toBe(DEFAULT_PREFERENCES.theme);
  });

  it('gives an account without any this device\'s, takes the account\'s after, and sends a change back once', async () => {
    startPrefsSync();
    setPrefs({ theme: 'linen' });
    account.value = { status: 'in', user };
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect((sent[0] as { theme: string }).theme).toBe('linen');

    // another device changed them: a new sign-in takes the account's
    kept = { ...kept, theme: 'dusk' };
    account.value = { status: 'out' };
    account.value = { status: 'in', user };
    await vi.waitFor(() => expect(prefs.value.theme).toBe('dusk'));
    expect(sent).toHaveLength(1);

    vi.useFakeTimers();
    setPrefs({ view: 'atelier' });
    setPrefs({ view: 'studio' });
    setPrefs({ view: 'atelier' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(sent).toHaveLength(2);
    expect((sent[1] as { view: string; theme: string })).toMatchObject({ view: 'atelier', theme: 'dusk' });
  });
});

describe('the dictation setting', () => {
  it('is Automatic by default, and a Downloaded model saved before Automatic existed (never picked) becomes Automatic', async () => {
    const { checked } = await import('../src/settings.ts');
    expect(DEFAULT_PREFERENCES.dictation).toBe('auto');
    expect(checked({ dictation: 'local' }).dictation).toBe('auto');
    expect(checked({ dictation: 'local', dictationPicked: true }).dictation).toBe('local');
    expect(checked({ dictation: 'companion' }).dictation).toBe('companion');
  });
});
