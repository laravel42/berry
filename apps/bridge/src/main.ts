import { parseArgv, helpText } from './cli.ts';
import { BRIDGE_VERSION } from './version.ts';

const command = parseArgv(process.argv.slice(2));
if (command.name === 'help') {
   process.stdout.write(`${helpText()}\n`);
   process.exit(command.name === 'help' && process.argv.slice(2)[0] === 'up' ? 1 : 0);
}
if (command.name === 'version') {
   process.stdout.write(`${BRIDGE_VERSION}\n`);
   process.exit(0);
}
if (command.name === 'up') {
   const { runCompanion } = await import('./companion.ts');
   const stop = new AbortController();
   process.once('SIGTERM', () => stop.abort());
   process.once('SIGINT', () => stop.abort());
   await runCompanion({ url: command.url, token: command.token }, stop.signal);
   process.exit(0);
}

const { runHost } = await import('../../../server-ts/src/agents/runtime/workstation/host.ts');
await runHost();
