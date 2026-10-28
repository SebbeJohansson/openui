#!/usr/bin/env node
// Launcher for the published package: maps the documented env vars and flags onto
// the Nitro server built into .output/ and starts it.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: openui [--port <n>]

Environment:
  OPENCODE_URL         OpenCode server the UI connects to (default: ask in the UI)
  EXPERIMENTAL_CLAUDE  Set to "true" to enable the Claude Code routes
  VIS_PORT / PORT      Port to listen on (default 3000)
  NUXT_CLAUDE_BIN      Path to the claude binary (default: auto-detect)`);
  process.exit(0);
}

if (args[0] === 'proxy') {
  console.error('`openui proxy` was removed in 0.3.0. Run `npx openui` to serve the UI locally.');
  process.exit(1);
}

const portFlag = args.indexOf('--port');
const port = portFlag !== -1 ? args[portFlag + 1] : undefined;
process.env.PORT ??= port ?? process.env.NITRO_PORT ?? process.env.VIS_PORT ?? '3000';
process.env.NODE_ENV ??= 'production';

if (process.env.OPENCODE_URL && !process.env.NUXT_OPENCODE_URL) {
  process.env.NUXT_OPENCODE_URL = process.env.OPENCODE_URL;
}
if (process.env.EXPERIMENTAL_CLAUDE === 'true' && !process.env.NUXT_CLAUDE_ENABLED) {
  process.env.NUXT_CLAUDE_ENABLED = 'true';
}

if (process.env.NUXT_OPENCODE_URL) {
  console.log(`Auto-configuring UI to connect to OpenCode at ${process.env.NUXT_OPENCODE_URL}`);
} else {
  console.log('No OPENCODE_URL set; the server URL is entered in the UI.');
  console.log('  To auto-configure: OPENCODE_URL=http://localhost:4096 npx openui');
}

const here = dirname(fileURLToPath(import.meta.url));
await import(join(here, '..', '.output', 'server', 'index.mjs'));
