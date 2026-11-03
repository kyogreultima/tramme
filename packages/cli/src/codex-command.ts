import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * npm's Windows shim starts Node, which starts codex.exe without windowsHide.
 * Hiding the shim cannot hide that second spawn: run the native binary directly.
 * Resolve before even asking --version, since that probe also flashes a console.
 */
export function codexOnPath(opts: { platform?: NodeJS.Platform; arch?: string; env?: NodeJS.ProcessEnv } = {}): string {
  if ((opts.platform ?? process.platform) !== 'win32') return 'codex';
  const env = opts.env ?? process.env;
  const value = (name: string) => Object.entries(env).find(([key]) => key.toUpperCase() === name)?.[1];
  const extensions = (value('PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  let command: string | undefined;
  for (const dir of (value('PATH') ?? '').split(';').filter(Boolean)) {
    command = extensions.map((ext) => path.join(dir.replace(/^"|"$/g, ''), `codex${ext.toLowerCase()}`)).find((file) => {
      try { return fs.statSync(file).isFile(); } catch { return false; }
    });
    if (command) break;
  }
  if (!command) return 'codex';
  if (!/\.(cmd|bat)$/i.test(command)) return command;
  const arch = opts.arch ?? process.arch;
  if (arch !== 'x64' && arch !== 'arm64') return command;
  try {
    // Only bypass npm's own wrapper; a user's custom command must keep its behavior.
    const shim = fs.readFileSync(command, 'utf8').replace(/\\/g, '/');
    if (!shim.includes('/@openai/codex/bin/codex.js')) return command;
    const fromShim = createRequire(path.join(path.dirname(command), 'package.json'));
    const manifest = fromShim.resolve('@openai/codex/package.json');
    let vendor: string;
    try {
      const platformPackage = createRequire(manifest).resolve(`@openai/codex-win32-${arch}/package.json`);
      vendor = path.join(path.dirname(platformPackage), 'vendor');
    } catch { vendor = path.join(path.dirname(manifest), 'vendor'); }
    const target = arch === 'x64' ? 'x86_64-pc-windows-msvc' : 'aarch64-pc-windows-msvc';
    for (const folder of ['bin', 'codex']) {
      const binary = path.join(vendor, target, folder, 'codex.exe');
      if (fs.statSync(binary, { throwIfNoEntry: false })?.isFile()) return binary;
    }
  } catch { /* an unknown or incomplete install: keep the original command */ }
  return command;
}
