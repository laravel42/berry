import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CliRejected, cliRequestFrom, runCli } from '../src/cli.ts';

describe('runCli', () => {
   it('runs an executable and returns its output', async () => {
      const result = await runCli({
         command: process.execPath,
         args: ['-e', 'process.stdout.write("ok")'],
      });
      assert.equal(result.code, 0);
      assert.equal(result.stdout, 'ok');
      assert.equal(result.timedOut, false);
      assert.equal(result.truncated, false);
   });

   it('refuses a shell line', () => {
      assert.throws(() => runCli({ command: 'echo hi' }), CliRejected);
      assert.throws(() => runCli({ command: 'echo|tee' }), CliRejected);
      assert.throws(() => runCli({ command: 'relative/tool' }), CliRejected);
   });

   it('stops a command that exceeds the timeout', async () => {
      const result = await runCli({
         command: process.execPath,
         args: ['-e', 'setTimeout(() => {}, 60_000)'],
         timeoutMs: 50,
      });
      assert.equal(result.timedOut, true);
      assert.notEqual(result.code, 0);
   });
});

describe('cliRequestFrom', () => {
   it('accepts a command object and rejects a bare string', () => {
      assert.deepEqual(cliRequestFrom({ command: 'claude', args: ['--version'] }), {
         command: 'claude',
         args: ['--version'],
      });
      assert.throws(() => cliRequestFrom('claude --version'), CliRejected);
   });
});
