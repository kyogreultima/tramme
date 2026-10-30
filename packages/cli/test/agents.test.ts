import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { TOOLS } from '@tramme/assistant';
import { parseModels, serveTools, type Turn } from '../src/agents.ts';

describe("Antigravity's models", () => {
  it('are read from `agy models`, a name and a label per line', () => {
    expect(parseModels('gemini-3.1-pro-high\tGemini 3.1 Pro (High)\r\nclaude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)\n\nFetching available models...\n'))
      .toEqual([['gemini-3.1-pro-high', 'Gemini 3.1 Pro (High)'], ['claude-sonnet-4-6', 'Claude Sonnet 4.6 (Thinking)']]);
  });
});

// the tools as the command lines (Codex, Antigravity) reach them: an MCP server
// whose calls go to the editor (here a stand-in that answers at once)
describe('the tools served to the command lines', () => {
  const sent: Record<string, unknown>[] = [];
  const turn: Turn = {
    send: (ev) => {
      sent.push(ev);
      if (ev.type === 'tool') setTimeout(() => turn.pending.get(String(ev.callId))?.({ content: [{ type: 'text', text: `ran ${ev.name}` }, { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' }] }), 5);
    },
    pending: new Map(), abort: new AbortController(), key: 'k', stop: () => {},
  };
  let server: http.Server, url = '';
  beforeAll(async () => {
    server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const text = Buffer.concat(chunks).toString('utf8');
      await serveTools(turn, req, res, text ? JSON.parse(text) : undefined);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp/k`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('lists every tool of the assistant and relays a call to the editor and back', async () => {
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());
    expect(tools.find((t) => t.name === 'render_still')?.inputSchema.required).toContain('t');
    const r = await client.callTool({ name: 'get_document', arguments: { path: '/tokens' } });
    expect(r.content).toEqual([{ type: 'text', text: 'ran get_document' }, { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' }]);
    expect(sent.find((e) => e.type === 'tool')).toMatchObject({ name: 'get_document', input: { path: '/tokens' } });
    await client.close();
  });
});

describe('what Claude is given for a request without tools', () => {
  it('has no Tramme tools, one turn and no session to resume', async () => {
    const { claudeOptions } = await import('../src/agents.ts');
    const turn = { send: () => {}, abort: new AbortController(), stop: () => {} } as never;
    const request = { prompt: 'Judge.', system: 's', model: 'claude-opus-5-5', images: [], mcpUrl: '', sessionId: 'old' };
    const bare = claudeOptions(turn, { ...request, tools: false }, 'claude-opus-5-5', 'medium');
    expect(bare.mcpServers).toBeUndefined();
    expect(bare.maxTurns).toBe(1);
    expect(bare.resume).toBeUndefined();
    const full = claudeOptions(turn, request, 'claude-opus-5-5', 'medium');
    expect(Object.keys(full.mcpServers ?? {})).toEqual(['tramme']);
    expect(full.maxTurns).toBeUndefined();
    expect(full.resume).toBe('old');
  });
});

describe("Antigravity's agent for a request without tools", () => {
  it('has no tool at all when it brings no picture, view_file for the pictures, and view_file in an ordinary turn', async () => {
    const { antigravityAgent } = await import('../src/agents.ts');
    const base = { prompt: 'p', system: 'SYS', model: '', images: [], mcpUrl: '' };
    expect(antigravityAgent({ ...base, tools: false })).toContain('tools: []');
    expect(antigravityAgent({ ...base, tools: false, images: [{ mediaType: 'image/jpeg', data: 'AA' }] })).toContain('tools: [view_file]');
    expect(antigravityAgent(base)).toContain('tools: [view_file]');
    expect(antigravityAgent(base)).toContain('SYS');
  });
});
