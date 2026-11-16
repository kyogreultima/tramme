#!/usr/bin/env node
// `npx @qualris/tramme`, or `tramme` once installed: the companion started from the published package (built by build.ts into dist/bin/).

import fs from 'node:fs';
import { isMainThread, workerData } from 'node:worker_threads';
import { companionCommand } from './main.ts';

/** the package's version: its package.json sits one folder up, built or not */
function version(): string {
  try { return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version ?? ''; } catch { return ''; }
}

// bundled, this file is also the module Whisper's thread starts (speech.ts): there it hears, nothing else
if (!isMainThread && (workerData as { role?: string } | null)?.role === 'tramme-whisper') await import('./speech.ts');
else {
  companionCommand(process.argv.slice(2), version()).catch((e: NodeJS.ErrnoException) => {
    console.error(e.code === 'EADDRINUSE' ? 'The port is already taken: a Tramme companion probably runs already (or give another with --port).' : e.message);
    process.exit(1);
  });
}
