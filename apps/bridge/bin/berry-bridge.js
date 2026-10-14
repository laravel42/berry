#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const main = fileURLToPath(new URL('../src/main.ts', import.meta.url));
const child = spawn(process.execPath, ['--experimental-strip-types', main, ...process.argv.slice(2)], {
   stdio: 'inherit',
});
child.on('exit', (code, signal) => {
   if (signal) {
      process.kill(process.pid, signal);
      return;
   }
   process.exit(code ?? 1);
});
