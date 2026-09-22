import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StateStore, type ToolContext } from '@strands-agents/sdk';
import type { ExecutionSession } from '../../execution/driver.ts';
import { WORKDIR_KEY } from './command-tool.ts';
import { repositoryTools } from './repository-tools.ts';

/**
 * The read-only way into a checkout. The session is a fake that answers by
 * command, so what is pinned is the contract: paths stay inside the checkout,
 * a run without a checkout says so, and a listing is bounded.
 */

function fakeSession(answer: (command: string, cwd?: string) => { stdout: string; exitCode: number }) {
   const commands: Array<{ command: string; cwd?: string }> = [];
   const session = {
      id: 'run-1',
      exec: async (command: string, options?: { cwd?: string }) => {
         commands.push({ command, ...(options?.cwd ? { cwd: options.cwd } : {}) });
         const result = answer(command, options?.cwd);
         return { stdout: result.stdout, stderr: '', exitCode: result.exitCode };
      },
      stream: () => ({ async *[Symbol.asyncIterator]() {} }),
      writeFile: async () => undefined,
      readFile: async () => '',
      stop: async () => undefined,
      destroy: async () => undefined,
   } satisfies ExecutionSession;
   return { session, commands };
}

async function call(name: 'browse_repository' | 'read_repository_file', session: ExecutionSession, args: object, workdir?: string) {
   const tool = repositoryTools(async () => session).find((candidate) => candidate.name === name)!;
   const appState = new StateStore();
   if (workdir) appState.set(WORKDIR_KEY, workdir);
   const context = { agent: { appState } } as unknown as ToolContext;
   const invoke = (tool as unknown as { invoke: (a: object, c?: unknown) => Promise<unknown> }).invoke;
   return (await invoke.call(tool, args, context)) as Record<string, unknown>;
}

test('a run without a checkout is told so, not shown an empty directory', async () => {
   const { session, commands } = fakeSession(() => ({ stdout: '', exitCode: 0 }));
   const result = await call('browse_repository', session, {});
   assert.match(String(result.error), /no repository checkout/);
   assert.equal(commands.length, 0);
});

test('a listing runs inside the checkout and is typed and bounded', async () => {
   const { session, commands } = fakeSession(() => ({
      stdout: 'd src\nf src/app.ts\nf README.md\n',
      exitCode: 0,
   }));
   const result = await call('browse_repository', session, { path: '.', depth: 2 }, '/work/repo');
   assert.equal(commands[0]?.cwd, '/work/repo');
   assert.match(commands[0]?.command ?? '', /-maxdepth 2/);
   assert.match(commands[0]?.command ?? '', /node_modules/);
   assert.deepEqual(result.entries, [
      { path: 'src', type: 'directory' },
      { path: 'src/app.ts', type: 'file' },
      { path: 'README.md', type: 'file' },
   ]);
   assert.equal(result.truncated, false);
});

test('a path that leaves the checkout is refused before any command runs', async () => {
   const { session, commands } = fakeSession(() => ({ stdout: '', exitCode: 0 }));
   for (const path of ['../secrets', '/etc/passwd', 'src/../../x']) {
      const listed = await call('browse_repository', session, { path }, '/work/repo');
      assert.match(String(listed.error), /outside the repository/, path);
      const read = await call('read_repository_file', session, { path }, '/work/repo');
      assert.equal(read.found, false, path);
   }
   assert.equal(commands.length, 0);
});

test('a file is read by its path from the root, with its size', async () => {
   const { session, commands } = fakeSession((command) => {
      if (command.startsWith('test -f')) return { stdout: '5\n', exitCode: 0 };
      if (command.includes('base64')) return { stdout: Buffer.from('hello').toString('base64'), exitCode: 0 };
      return { stdout: '', exitCode: 1 };
   });
   const result = await call('read_repository_file', session, { path: './README.md' }, '/work/repo');
   assert.equal(result.found, true);
   assert.equal(result.content, 'hello');
   assert.equal(result.sizeBytes, 5);
   assert.ok(commands.every((entry) => entry.cwd === '/work/repo'));
});

test('a missing file is found: false, and a huge one is named rather than dumped', async () => {
   const missing = fakeSession(() => ({ stdout: '', exitCode: 1 }));
   assert.equal((await call('read_repository_file', missing.session, { path: 'nope.ts' }, '/w')).found, false);
   const huge = fakeSession(() => ({ stdout: `${10 * 1024 * 1024}\n`, exitCode: 0 }));
   const result = await call('read_repository_file', huge.session, { path: 'big.bin' }, '/w');
   assert.match(String(result.error), /only files up to/);
});
