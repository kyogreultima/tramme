import { describe, expect, it } from 'vitest';
import { companionOrigins, companionStart, DESKTOP_ORIGINS } from '@tramme/assistant';
import { parseArgs } from '../src/main.ts';

describe("the companion's command line", () => {
  it('reads the same arguments with `agent` first or without', () => {
    const want = { help: false, version: false, port: 4400, origins: ['https://a.example', 'https://b.example'], renew: true };
    expect(parseArgs(['--port', '4400', '--origin', 'https://a.example,https://b.example', '--renew'])).toEqual(want);
    expect(parseArgs(['agent', '--port', '4400', '--origin', 'https://a.example', '--origin', 'https://b.example', '--renew'])).toEqual(want);
  });

  it('refuses a port that is not one, an option without its value and an unknown argument', () => {
    expect(() => parseArgs(['--port', 'x'])).toThrow('--port');
    expect(() => parseArgs(['--port', '70000'])).toThrow('--port');
    expect(() => parseArgs(['--origin'])).toThrow('--origin expects a value');
    expect(() => parseArgs(['--origin', '--renew'])).toThrow('--origin expects a value');
    expect(() => parseArgs(['--nope'])).toThrow('unknown argument: --nope');
  });

  it('asks for the help and the version', () => {
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-v']).version).toBe(true);
  });
});

describe('the editors the companion pairs by itself', () => {
  it('are the production app and the desktop app, by default', () => {
    expect(companionOrigins({})).toEqual(['https://app.tramme.dev', ...DESKTOP_ORIGINS]);
  });

  it("follow the environment's app", () => {
    expect(companionOrigins({ TRAMME_ENV: 'beta' })[0]).toBe('https://beta.app.tramme.dev');
    expect(companionOrigins({ TRAMME_APP_URL: 'https://branch.example/' })[0]).toBe('https://branch.example');
  });

  it('give the command the editor shows: npx @qualris/tramme for the editors it pairs, the address named for another', () => {
    expect(companionStart('https://app.tramme.dev')).toBe('npx @qualris/tramme');
    expect(companionStart('http://tramme.localhost')).toBe('npx @qualris/tramme');
    expect(companionStart('https://beta.app.tramme.dev')).toBe('npx @qualris/tramme --origin https://beta.app.tramme.dev');
    expect(companionStart('http://localhost:8787')).toBe('pnpm dev');
  });
});
