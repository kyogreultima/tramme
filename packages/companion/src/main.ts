// The companion's command line, the same for `npx @qualris/tramme` and `tramme` (the published package) and the
// repository's `pnpm tramme agent`:
//   tramme [agent] [--origin https://app.example,…] [--port 4317] [--renew]
// The editor of this environment and the desktop app are paired by themselves (companionOrigins);
// --origin adds others.

import { COMPANION_PACKAGE, COMPANION_PORT, companionOrigins } from '@tramme/assistant';
import { startCompanion } from './companion.ts';

const HELP = `Tramme companion: the editor's assistant with the agents of this computer,
each on its own login (Claude Code, Codex, Antigravity).

  tramme [agent] [--origin <url>,…] [--port ${COMPANION_PORT}] [--renew]

  --origin  another editor paired by itself (the Tramme app and the desktop app always are)
  --port    the port it listens on, on 127.0.0.1
  --renew   a new pairing token (the editors are paired again)
`;

export interface CompanionArgs { help: boolean; version: boolean; port?: number; origins: string[]; renew: boolean }

/** the arguments of the command line, `agent` first or not */
export function parseArgs(argv: string[]): CompanionArgs {
  const args: CompanionArgs = { help: false, version: false, origins: [], renew: false };
  const list = argv[0] === 'agent' ? argv.slice(1) : argv;
  for (let i = 0; i < list.length; i++) {
    const a = list[i], value = () => {
      const v = list[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} expects a value`);
      return v;
    };
    if (a === '--help' || a === '-h' || a === 'help') args.help = true;
    else if (a === '--version' || a === '-v') args.version = true;
    else if (a === '--renew') args.renew = true;
    else if (a === '--origin') args.origins.push(...value().split(',').map((o) => o.trim()).filter(Boolean));
    else if (a === '--port') {
      const port = Number(value());
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port expects a port number');
      args.port = port;
    } else throw new Error(`unknown argument: ${a}\n\n${HELP}`);
  }
  return args;
}

export async function companionCommand(argv: string[], version = '') {
  const args = parseArgs(argv);
  if (args.help) { process.stdout.write(HELP); return; }
  if (args.version) { console.log(version || 'development'); return; }
  await startCompanion({ port: args.port, origins: [...new Set([...companionOrigins(process.env), ...args.origins])], renew: args.renew });
  // started through npx: the short command, once it is installed
  if (process.env.npm_command === 'exec') console.log(`to start it with \`tramme\` from now on: npm install -g ${COMPANION_PACKAGE}`);
}
