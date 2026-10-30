// The engines the companion runs a turn with, each on the user's own login:
// Claude (the Agent SDK, the Claude Code login), Codex (the Codex CLI, a
// ChatGPT login) and Antigravity (the Antigravity CLI, a Google login). Whatever the
// engine, the editor sees the same events (text, thinking, tool calls, errors)
// and runs the same tools: Claude gets them in process, the two command lines
// reach them as an MCP server the companion serves for the turn. Each engine
// gets Tramme's tools and nothing else: no shell, no files, no web.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import spawn from 'cross-spawn';
import { createSdkMcpServer, query, tool, type Options, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ADAPTIVE, DEFAULT_EFFORT, EFFORTS, ENGINES, MODELS, TOOLS, UsageMeter, type Effort, type Engine, type ToolResult } from '@tramme/assistant';

type Out = Record<string, unknown>;

/** one turn, whatever the engine: how it talks to the editor and how it stops */
export interface Turn {
  send: (ev: Out) => void;
  /** tool calls waiting for the editor's result */
  pending: Map<string, (r: ToolResult) => void>;
  abort: AbortController;
  /** the key of this turn's MCP address (the command lines reach the tools through it) */
  key: string;
  /** stops the engine (the Agent SDK's query, a command line's process) */
  stop: () => void;
}

export interface TurnRequest {
  prompt: string;
  system: string;
  /** the engine's model; empty: its own default */
  model: string;
  effort?: string;
  sessionId?: string;
  images: { mediaType: string; data: string }[];
  /** where the command lines reach Tramme's tools this turn */
  mcpUrl: string;
  /** false: no Tramme tools, one answer, no earlier session (a request in a fresh context) */
  tools?: boolean;
}

const TOOL_TIMEOUT = 15 * 60_000;
/** where the command lines run: a folder of their own, so their sessions are found again */
const WORKDIR = path.join(os.homedir(), '.tramme', 'engines');
/** Antigravity's home of its own (the login stays in the system keyring): none of the user's plugins, skills, MCP servers or settings */
const AGY_HOME = path.join(WORKDIR, 'antigravity', 'home');
const AGY_ENV = { HOME: AGY_HOME, USERPROFILE: AGY_HOME };

/** a tool call handed to the editor, which runs it and posts the result back */
export async function callEditor(t: Turn, name: string, input: unknown): Promise<ToolResult> {
  const callId = crypto.randomUUID();
  t.send({ type: 'tool', callId, name, input });
  return new Promise<ToolResult>((resolve) => {
    const timer = setTimeout(() => { t.pending.delete(callId); resolve({ content: [{ type: 'text', text: 'the editor did not answer' }], isError: true }); }, TOOL_TIMEOUT);
    t.pending.set(callId, (x) => { clearTimeout(timer); resolve(x); });
  });
}

/** a tool's result in MCP's words (both SDKs take this shape) */
const asMcp = (r: ToolResult) => ({
  content: r.content.map((c) => (c.type === 'image' ? { type: 'image' as const, data: c.data, mimeType: c.mimeType } : { type: 'text' as const, text: c.text })),
  isError: !!r.isError,
});

/** Tramme's tools as an MCP server over HTTP, for one request of a command line (stateless: a server per request) */
export async function serveTools(t: Turn, req: http.IncomingMessage, res: http.ServerResponse, body: unknown) {
  const server = new McpServer({ name: 'tramme', version: '1.0.0' });
  for (const def of TOOLS) server.registerTool(def.name, { description: def.description, inputSchema: def.schema.shape }, async (input: unknown) => asMcp(await callEditor(t, def.name, input)));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

// ── which engines this machine has ───────────────────────────

/** agy where its installer puts it, for a companion started from a terminal older than the install (its PATH without it) */
const AGY_INSTALLED = process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'agy', 'bin', 'agy.exe')
  : path.join(os.homedir(), '.local', 'bin', 'agy');
const COMMAND: Record<Exclude<Engine, 'claude'>, string> = { codex: 'codex', antigravity: fs.existsSync(AGY_INSTALLED) ? AGY_INSTALLED : 'agy' };

/**
 * The Codex programs that Codex's own installs leave, for a machine where `codex` is not on the PATH
 * (the app and the editors' extension do not put it there): the app's folder, its newest build first,
 * then the extension of VS Code and of the editors made from it, the newest version first.
 */
export function codexInstalls(opts: { home?: string; localAppData?: string; platform?: NodeJS.Platform } = {}): string[] {
  const home = opts.home ?? os.homedir();
  const local = 'localAppData' in opts ? opts.localAppData : process.env.LOCALAPPDATA;
  const exe = (opts.platform ?? process.platform) === 'win32' ? 'codex.exe' : 'codex';
  const folders = (dir: string) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } };
  const modified = (dir: string) => { try { return fs.statSync(dir).mtimeMs; } catch { return 0; } };
  const found: string[] = [];
  if (local) {
    const bin = path.join(local, 'OpenAI', 'Codex', 'bin');
    for (const build of folders(bin).sort((a, b) => modified(path.join(bin, b)) - modified(path.join(bin, a)))) found.push(path.join(bin, build, exe));
  }
  for (const editor of ['.vscode', '.vscode-insiders', '.cursor', '.windsurf']) {
    const root = path.join(home, editor, 'extensions');
    for (const extension of folders(root).filter((n) => n.startsWith('openai.chatgpt-')).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) {
      const bin = path.join(root, extension, 'bin');
      for (const platform of folders(bin)) found.push(path.join(bin, platform, exe));
    }
  }
  return found.filter((f) => fs.existsSync(f));
}

/** a version as numbers, and its prerelease identifiers ('codex-cli 0.164.0-alpha.11.1'); null when there is none to read */
function readVersion(v: string): { numbers: number[]; pre: string[] | null } | null {
  const m = /(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.]+))?/.exec(v);
  return m ? { numbers: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split('.') : null } : null;
}

/** positive when `a` is the newer: the numbers first, a release before its own prereleases, then the prerelease identifiers as semver orders them */
function compareVersions(a: string, b: string): number {
  const x = readVersion(a), y = readVersion(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (let i = 0; i < 3; i++) if (x.numbers[i] !== y.numbers[i]) return x.numbers[i] - y.numbers[i];
  if (!x.pre || !y.pre) return x.pre ? -1 : y.pre ? 1 : 0;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1;
    const bothNumbers = /^\d+$/.test(p) && /^\d+$/.test(q);
    const order = bothNumbers ? Number(p) - Number(q) : p < q ? -1 : p > q ? 1 : 0;
    if (order) return order;
  }
  return 0;
}

/**
 * Which Codex to use when several answer: the newest, since the models it offers depend on
 * its version (the app's 0.153 lists six, the extension's 0.164 ten); the first of equals, so the one
 * on the PATH; null when none answers.
 */
export function newestCodex(found: { command: string; version: string }[]): string | null {
  let best: { command: string; version: string } | null = null;
  for (const f of found) if (!best || compareVersions(f.version, best.version) > 0) best = f;
  return best?.command ?? null;
}

/** the program that answers `--version` among the candidates, which the turns then run (for Codex the newest one); its version, null when none does */
async function locate(engine: Exclude<Engine, 'claude'>): Promise<string | null> {
  const candidates = engine === 'codex' ? ['codex', ...codexInstalls()] : [COMMAND[engine]];
  const answers = (await Promise.all(candidates.map(async (command) => ({ command, version: await version(command) }))))
    .filter((a): a is { command: string; version: string } => a.version !== null);
  const command = newestCodex(answers);
  if (!command) return null;
  COMMAND[engine] = command;
  return answers.find((a) => a.command === command)!.version;
}

/** what a command line prints, null when it fails or is not there */
function output(command: string, args: string[], env?: Record<string, string>): Promise<string | null> {
  return new Promise((resolve) => {
    let out = '';
    let child: ReturnType<typeof spawn>;
    try { child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }); } catch { resolve(null); return; }
    const timer = setTimeout(() => { kill(child); resolve(null); }, 15_000);
    child.stdout?.on('data', (c: Buffer) => { out += c.toString('utf8'); });
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', (code) => { clearTimeout(timer); resolve(code === 0 ? out : null); });
  });
}

/** whether a command line answers, and its version */
const version = (command: string) => output(command, ['--version']).then((out) => (out === null ? null : out.trim().split(/\r?\n/).pop() || '?'));

/** the engines installed here (Claude always: the Agent SDK ships with the companion), looked for again at most once a minute */
let found: { at: number; engines: Promise<Record<Engine, string | null>> } | null = null;
export function engines(): Promise<Record<Engine, string | null>> {
  if (!found || Date.now() - found.at > 60_000) {
    found = {
      at: Date.now(),
      engines: Promise.all([locate('codex'), locate('antigravity')]).then(([codex, antigravity]) => ({ claude: 'agent-sdk', codex, antigravity })),
    };
  }
  return found.engines;
}

/** the models of `agy models`: a name and a label per line */
export const parseModels = (out: string): [id: string, label: string][] => out.split(/\r?\n/)
  .map((line) => line.split('\t').map((s) => s.trim()))
  .filter((p): p is [string, string] => p.length === 2 && !!p[0] && !!p[1]);

/** the models Antigravity offers this login, for the editor's model menu; looked for again at most every ten minutes */
let listed: { at: number; models: Promise<[string, string][]> } | null = null;
export function antigravityModels(): Promise<[string, string][]> {
  if (!listed || Date.now() - listed.at > 10 * 60_000) {
    fs.mkdirSync(AGY_HOME, { recursive: true });
    const models = output(COMMAND.antigravity, ['models'], AGY_ENV).then((out) => parseModels(out ?? ''));
    // an empty listing (offline, signed out) is asked again next time
    models.then((m) => { if (!m.length) listed = null; });
    listed = { at: Date.now(), models };
  }
  return listed.models;
}

/** the models of `codex debug models` (its catalogue as JSON): the listed ones, in the order Codex gives them, a name and a label each */
export function parseCodexModels(out: string): [id: string, label: string][] {
  let catalogue: { models?: unknown };
  try { catalogue = JSON.parse(out); } catch { return []; }
  if (!Array.isArray(catalogue?.models)) return [];
  return (catalogue.models as { slug?: unknown; display_name?: unknown; visibility?: unknown; priority?: unknown }[])
    .filter((m) => typeof m?.slug === 'string' && m.slug !== '' && m.visibility === 'list')
    .sort((a, b) => (typeof a.priority === 'number' ? a.priority : Infinity) - (typeof b.priority === 'number' ? b.priority : Infinity))
    .map((m) => [m.slug as string, typeof m.display_name === 'string' && m.display_name ? m.display_name : (m.slug as string)]);
}

/** the models Codex offers this login, for the editor's model menu; looked for again at most every ten minutes, or at once when another Codex is used */
let codexListed: { at: number; command: string; models: Promise<[string, string][]> } | null = null;
export function codexModels(): Promise<[string, string][]> {
  if (!codexListed || codexListed.command !== COMMAND.codex || Date.now() - codexListed.at > 10 * 60_000) {
    const models = output(COMMAND.codex, ['debug', 'models']).then((out) => parseCodexModels(out ?? ''));
    // an empty listing (signed out, offline) is asked again next time
    models.then((m) => { if (!m.length) codexListed = null; });
    codexListed = { at: Date.now(), command: COMMAND.codex, models };
  }
  return codexListed.models;
}

/** a process and its children stopped (on Windows, the command line runs under cmd.exe) */
function kill(child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  else child.kill('SIGTERM');
}

// ── Claude: the Agent SDK ────────────────────────────────────

/** what Claude Code is given for a request: only Tramme's tools, run by the editor, unless the request asks for none */
export function claudeOptions(t: Turn, r: TurnRequest, model: string, effort: Effort): Options {
  const tools = r.tools !== false;
  return {
    model,
    systemPrompt: r.system,
    // only Tramme's tools, run by the editor: no files, no shell, no settings, no account connectors
    tools: [] as string[],
    ...(tools ? {
      mcpServers: {
        tramme: createSdkMcpServer({
          name: 'tramme', version: '1.0.0', alwaysLoad: true,
          tools: TOOLS.map((def) => tool(def.name, def.description, def.schema.shape, async (input: unknown) => asMcp(await callEditor(t, def.name, input)))),
        }),
      },
    } : { maxTurns: 1 }),
    strictMcpConfig: true,
    settingSources: [] as never[],
    canUseTool: async (name: string, input: Record<string, unknown>) => (name.startsWith('mcp__tramme__') && tools
      ? { behavior: 'allow' as const, updatedInput: input }
      : { behavior: 'deny' as const, message: `Tool ${name} is not available in Tramme.` }),
    // thinking shown to the user as it goes (summarized)
    ...(ADAPTIVE.has(model) ? { thinking: { type: 'adaptive' as const, display: 'summarized' as const }, effort } : {}),
    includePartialMessages: true,
    abortController: t.abort,
    cwd: os.tmpdir(),
    ...(r.sessionId && tools ? { resume: r.sessionId } : {}),
  };
}

async function runClaude(t: Turn, r: TurnRequest) {
  const model = MODELS.some(([id]) => id === r.model) ? r.model : MODELS[0][0];
  const effort: Effort = EFFORTS.find((e) => e === r.effort) ?? DEFAULT_EFFORT;
  // images joined to the message: one user message of image blocks and the text
  const prompt = r.images.length
    ? (async function* () {
      yield {
        type: 'user' as const,
        parent_tool_use_id: null,
        message: { role: 'user' as const, content: [...r.images.map((i) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: i.mediaType as 'image/jpeg', data: i.data } })), { type: 'text' as const, text: r.prompt }] },
      } as SDKUserMessage;
    })()
    : r.prompt;
  const q = query({ prompt, options: claudeOptions(t, r, model, effort) });
  t.stop = () => { t.abort.abort(); q.interrupt().catch(() => {}); };
  let message = 0;
  const thinking = new Set<string>();
  // the turn's tokens, from its own requests (the SDK's totals carry the whole session)
  const meter = new UsageMeter();
  for await (const m of q as AsyncIterable<SDKMessage>) {
    const msg = m as any;
    if (msg.type === 'system' && msg.subtype === 'init') t.send({ type: 'session', id: msg.session_id, model });
    else if (msg.parent_tool_use_id) continue;
    else if (msg.type === 'stream_event') {
      const ev = msg.event;
      meter.event(ev);
      if (ev.type === 'message_start') message++;
      const key = `${message}:${ev.index}`;
      if (ev.type === 'content_block_start' && ev.content_block?.type === 'text') t.send({ type: 'text-start', key, text: ev.content_block.text ?? '' });
      else if (ev.type === 'content_block_start' && /thinking/.test(ev.content_block?.type ?? '')) { thinking.add(key); t.send({ type: 'thinking-start', key }); }
      else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') t.send({ type: 'text', key, delta: ev.delta.text });
      else if (ev.type === 'content_block_delta' && ev.delta?.type === 'thinking_delta') t.send({ type: 'thinking', key, delta: ev.delta.thinking });
      else if (ev.type === 'content_block_stop' && thinking.delete(key)) t.send({ type: 'thinking-stop', key });
    } else if (msg.type === 'result' && msg.subtype !== 'success') {
      t.send({ type: 'error', message: (msg.errors ?? []).join('\n') || `Claude stopped (${msg.subtype})` });
    } else if (msg.type === 'result' && msg.is_error) {
      // a turn ended on an API error (a session limit, an overloaded server, a login refused) comes as a "success" whose result is the error
      t.send({ type: 'error', message: String(msg.result || `Claude stopped (${msg.api_error_status ?? 'API error'})`) });
    }
  }
  if (meter.usage.requests) t.send({ type: 'usage', usage: meter.usage });
}

// ── the command lines: Codex and Antigravity ─────────────────

/** a fresh folder for the turn's files (system prompt, settings, images), removed after it */
function turnFolder(engine: string): string {
  const dir = path.join(WORKDIR, engine, 'turns', crypto.randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** the images joined to the message, as files */
function writeImages(dir: string, images: TurnRequest['images']): string[] {
  return images.slice(0, 20).map((img, i) => {
    const file = path.join(dir, `image-${i + 1}.${img.mediaType === 'image/png' ? 'png' : 'jpg'}`);
    fs.writeFileSync(file, Buffer.from(img.data, 'base64'));
    return file;
  });
}

/**
 * Runs a command line: the prompt on its standard input, its JSON lines read
 * as they come. Its last error lines say what went wrong when it fails (not
 * logged in, unknown model).
 */
function runLines(t: Turn, command: string, args: string[], opts: { cwd: string; env?: Record<string, string>; input: string; onLine: (j: any) => void }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    t.stop = () => { t.abort.abort(); kill(child); };
    let buf = '', errors = '';
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('{')) continue;
        try { opts.onLine(JSON.parse(line)); } catch { /* a line that is not an event */ }
      }
    });
    child.stderr!.on('data', (c: Buffer) => { errors = (errors + c.toString('utf8')).slice(-4000); });
    child.on('error', (e) => reject(new Error(`${command}: ${e.message}`)));
    child.on('close', (code) => {
      if (t.abort.signal.aborted || code === 0) resolve();
      else reject(new Error(errors.trim().split(/\r?\n/).filter(Boolean).slice(-6).join('\n') || `${command} stopped (code ${code})`));
    });
    child.stdin!.end(opts.input);
  });
}

/** a TOML string for a -c value (Windows paths keep their backslashes) */
const toml = (s: string) => `'${s.replace(/'/g, '')}'`;

async function runCodex(t: Turn, r: TurnRequest) {
  const dir = turnFolder('codex');
  try {
    const instructions = path.join(dir, 'instructions.md');
    fs.writeFileSync(instructions, r.system);
    const images = writeImages(dir, r.images).flatMap((f) => ['-i', f]);
    const level = EFFORTS.find((e) => e === r.effort);
    const config = [
      // Tramme's instructions instead of a coding agent's, Tramme's tools instead of the shell and the web
      `model_instructions_file=${toml(instructions)}`,
      'features.shell_tool=false', 'web_search="disabled"', 'approval_policy="never"',
      ...(r.tools === false ? [] : [`mcp_servers.tramme.url=${toml(r.mcpUrl)}`, 'mcp_servers.tramme.tool_timeout_sec=900', 'mcp_servers.tramme.default_tools_approval_mode="approve"']),
      'model_reasoning_summary="auto"',
      ...(level ? [`model_reasoning_effort="${level}"`] : []),
    ].flatMap((c) => ['-c', c]);
    const common = ['--json', '--skip-git-repo-check', '--ignore-user-config', '-s', 'read-only', '-C', path.join(WORKDIR, 'codex'), ...(r.model ? ['-m', r.model] : [])];
    // images first: -i takes every value up to the next option
    const args = r.sessionId && r.tools !== false
      ? ['exec', ...common, 'resume', r.sessionId, ...images, ...config, '-']
      : ['exec', ...images, ...common, ...config, '-'];
    let n = 0;
    await runLines(t, COMMAND.codex, args, {
      cwd: path.join(WORKDIR, 'codex'), input: r.prompt,
      onLine: (ev) => {
        if (ev.type === 'thread.started' && ev.thread_id) t.send({ type: 'session', id: ev.thread_id, model: r.model || 'codex' });
        else if (ev.type === 'item.completed' && ev.item) {
          const kind = ev.item.type ?? ev.item.item_type, text = String(ev.item.text ?? '');
          const key = `codex:${++n}`;
          if ((kind === 'agent_message' || kind === 'assistant_message') && text) t.send({ type: 'text-start', key, text });
          else if (kind === 'reasoning' && text) { t.send({ type: 'thinking-start', key }); t.send({ type: 'thinking', key, delta: text }); t.send({ type: 'thinking-stop', key }); }
          else if (kind === 'error' && ev.item.message) t.send({ type: 'error', message: String(ev.item.message) });
        } else if (ev.type === 'turn.completed' && ev.usage) {
          // its input counts the cached part
          const u = ev.usage, cached = Number(u.cached_input_tokens) || 0;
          t.send({ type: 'usage', usage: { requests: 0, input: Math.max(0, (Number(u.input_tokens) || 0) - cached), cacheRead: cached, cacheWrite: 0, cacheWrite1h: 0, output: Number(u.output_tokens) || 0 } });
        } else if (ev.type === 'turn.failed') t.send({ type: 'error', message: String(ev.error?.message ?? 'Codex stopped') });
        else if (ev.type === 'error' && ev.message) t.send({ type: 'error', message: String(ev.message) });
      },
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** Antigravity's agent file: its body is the system prompt; of the built-in tools, view_file alone for the images, and none for a request that asks for no tools and brings no picture (one answer, nothing to loop on) */
export function antigravityAgent(r: TurnRequest): string {
  const tools = r.tools === false && !r.images.length ? '[]' : '[view_file]';
  return `---\nname: tramme\ndescription: The assistant of the Tramme editor\ntools: ${tools}\nsubagent: false\n---\n${r.system}\n`;
}

async function runAntigravity(t: Turn, r: TurnRequest) {
  const dir = turnFolder('antigravity');
  const root = path.join(WORKDIR, 'antigravity'), workspace = path.join(root, 'workspace');
  try {
    // its home's permissions: Tramme's tools and the turn's images only; headless, any other call is refused without asking
    const settings = path.join(AGY_HOME, '.gemini', 'antigravity-cli');
    fs.mkdirSync(settings, { recursive: true });
    fs.writeFileSync(path.join(settings, 'settings.json'), JSON.stringify({
      permissions: {
        allow: ['mcp(tramme/*)', `read_file(${path.join(root, 'turns')})`],
        deny: ['command(*)', 'write_file(*)', 'read_url(*)', 'execute_url(*)', 'unsandboxed(*)'],
      },
    }, null, 2));
    // the workspace: Tramme's agent (its body is the system prompt; of the built-in tools, view_file alone, for the images) and the turn's MCP address
    const agents = path.join(workspace, '.agents');
    fs.mkdirSync(path.join(agents, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(agents, 'mcp_config.json'), JSON.stringify({ mcpServers: r.tools === false ? {} : { tramme: { serverUrl: r.mcpUrl } } }, null, 2));
    fs.writeFileSync(path.join(agents, 'agents', 'tramme.md'), antigravityAgent(r));
    // images: files of the turn, named in the message (its input takes text only)
    const images = writeImages(dir, r.images);
    const text = images.length ? `Images joined to this message (open them with view_file):\n${images.join('\n')}\n\n${r.prompt}` : r.prompt;
    const level = EFFORTS.find((e) => e === r.effort);
    const args = ['--agent', 'tramme', '--input-format', 'stream-json', '--output-format', 'stream-json',
      ...(r.sessionId && r.tools !== false ? ['--conversation', r.sessionId] : []), ...(r.model ? ['--model', r.model] : []), ...(level ? ['--effort', level] : [])];
    const open = new Set<number>();
    let failed = false;
    await runLines(t, COMMAND.antigravity, args, {
      cwd: workspace, env: AGY_ENV,
      input: JSON.stringify({ event: 'user', message: { role: 'user', content: text } }) + '\n',
      onLine: (ev) => {
        if (ev.event === 'init' && ev.conversation_id) t.send({ type: 'session', id: ev.conversation_id, model: ev.init?.model ?? (r.model || 'antigravity') });
        else if (ev.event === 'step_update' && ev.step_update?.step_type === 'agent_response' && ev.step_update.text_delta) {
          // each step's answer comes in pieces; a tool call in between is another step
          const s = ev.step_update, key = `antigravity:${s.step_index}`;
          if (open.has(s.step_index)) t.send({ type: 'text', key, delta: String(s.text_delta) });
          else { open.add(s.step_index); t.send({ type: 'text-start', key, text: String(s.text_delta) }); }
        } else if (ev.event === 'result' && ev.result?.status === 'ERROR') {
          failed = true;
          t.send({ type: 'error', message: String(ev.result.error || 'Antigravity stopped') });
        }
      },
    // its error already told, the exit code says nothing more
    }).catch((e) => { if (!failed) throw e; });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const RUN: Record<Engine, (t: Turn, r: TurnRequest) => Promise<void>> = { claude: runClaude, codex: runCodex, antigravity: runAntigravity };

/** a turn with the engine asked; the editor reads its events as they come */
export async function runEngine(engine: Engine, t: Turn, r: TurnRequest) {
  if (!ENGINES.includes(engine)) throw new Error(`unknown engine: ${engine}`);
  if (engine !== 'claude' && !(await engines())[engine]) throw new Error(`${COMMAND[engine]} is not installed on this computer (or not on its PATH)`);
  fs.mkdirSync(path.join(WORKDIR, engine), { recursive: true });
  await RUN[engine](t, r);
}
