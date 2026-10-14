import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { BRIDGE_VERSION } from './version.ts';

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));

function run(args: string[], stdin?: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
   return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--experimental-strip-types', MAIN, ...args], {
         stdio: ['pipe', 'pipe', 'pipe'],
      });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
      child.on('error', reject);
      child.on('close', (code) => {
         resolve({
            code,
            stdout: Buffer.concat(out).toString('utf8'),
            stderr: Buffer.concat(err).toString('utf8'),
         });
      });
      child.stdin.end(stdin ?? '');
   });
}

test('--help and --version do not read a host request', async () => {
   const help = await run(['--help']);
   assert.equal(help.code, 0);
   assert.match(help.stdout, /berry-bridge/);
   const version = await run(['--version']);
   assert.equal(version.code, 0);
   assert.equal(version.stdout.trim(), BRIDGE_VERSION);
});

test('unreadable stdin is a protocol failure, not a hang', async () => {
   const result = await run([], 'not-json');
   assert.equal(result.code, 1);
   const event = JSON.parse(result.stdout.trim().split('\n')[0] ?? '{}') as { type?: string; failure?: { code?: string } };
   assert.equal(event.type, 'task.failed');
   assert.equal(event.failure?.code, 'RUNTIME_PROTOCOL');
});
