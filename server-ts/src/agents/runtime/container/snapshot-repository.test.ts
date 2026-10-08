import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalSession } from './local-session.ts';
import { isCoreDump, isInstalledPath, isLeftoverFile, snapshotRepository } from './snapshot-repository.ts';
import { sampleEnvelope } from '../../../runtime/envelope.test.ts';
import { shellQuote } from '../../checkout.ts';

test('snapshot work returns complete candidate bytes, including commits, without a Git credential or push', async (t) => {
   const root = await mkdtemp(join(tmpdir(), 'berry-snapshot-test-'));
   t.after(() => rm(root, { recursive: true, force: true }));
   await mkdir(join(root, 'source'));
   await writeFile(join(root, 'source', 'keep.txt'), 'before');
   await writeFile(join(root, 'source', 'remove.txt'), 'gone');
   const session = new LocalSession({ id: 'test', root });
   const archivePath = join(root, 'archive.tar.gz');
   assert.equal((await session.exec(`tar -czf ${shellQuote(archivePath)} source`)).exitCode, 0);
   const archive = await readFile(archivePath);
   const repository = snapshotRepository({ fetch: (async (_url, init) => {
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer scoped-task-token');
      return new Response(archive);
   }) as typeof fetch });
   const envelope = sampleEnvelope({ berry: { apiUrl: 'https://berry.test', token: 'scoped-task-token' }, repo: {
      fullName: 'berry/app', branch: 'agent/task', baseBranch: 'main', snapshotCommit: 'a'.repeat(40),
      credential: { username: '', password: '' }, verifyCommands: [], issueReference: 'B-1', issueTitle: 'Test',
   } });
   const events: Array<{ type: string; message?: { kind?: string } }> = [];
   const emit = (event: { type: string; message?: { kind?: string } }) => {
      events.push(event);
   };
   const directory = await repository.prepare({ envelope, session, warm: false, emit });
   assert.ok(directory);
   await writeFile(join(directory, 'keep.txt'), 'after');
   await rm(join(directory, 'remove.txt'));
   assert.equal((await session.exec('git add -A && git -c user.name=Agent -c user.email=agent@test.invalid commit -qm work', { cwd: directory })).exitCode, 0);
   await writeFile(join(directory, 'binary.dat'), Buffer.from([0, 255, 1]));
   const delivery = await repository.deliver({ envelope, session, directory, summary: 'done', emit });
   assert.equal(
      events.some((event) => event.message?.kind === 'verified'),
      false,
      'a project with no checks must not record a failed verification'
   );
   assert.ok(delivery?.candidate);
   assert.deepEqual(delivery.candidate.map((file) => file.path).sort(), ['binary.dat', 'keep.txt', 'remove.txt']);
   assert.equal(delivery.candidate.find((file) => file.path === 'remove.txt')?.content, null);
   assert.equal(delivery.candidate.find((file) => file.path === 'keep.txt')?.content, Buffer.from('after').toString('base64'));
   assert.equal(delivery.committed, false);
   assert.equal((await session.exec('git remote', { cwd: directory })).stdout, '');
   assert.equal((await session.exec('printf "%s" "${BERRY_GIT_TOKEN:-absent}"', { cwd: directory })).stdout, 'absent');
});

test('installed dependencies are left out of the candidate unless the repository already tracked them', async (t) => {
   const root = await mkdtemp(join(tmpdir(), 'berry-snapshot-test-'));
   t.after(() => rm(root, { recursive: true, force: true }));
   await mkdir(join(root, 'source', 'vendor', 'node_modules', 'pinned'), { recursive: true });
   await writeFile(join(root, 'source', 'index.html'), 'before');
   await writeFile(join(root, 'source', 'vendor', 'node_modules', 'pinned', 'index.js'), 'v1');
   const session = new LocalSession({ id: 'test', root });
   const archivePath = join(root, 'archive.tar.gz');
   assert.equal((await session.exec(`tar -czf ${shellQuote(archivePath)} source`)).exitCode, 0);
   const archive = await readFile(archivePath);
   const repository = snapshotRepository({ fetch: (async () => new Response(archive)) as typeof fetch });
   const envelope = sampleEnvelope({ berry: { apiUrl: 'https://berry.test', token: 'scoped-task-token' }, repo: {
      fullName: 'berry/app', branch: 'agent/task', baseBranch: 'main', snapshotCommit: 'a'.repeat(40),
      credential: { username: '', password: '' }, verifyCommands: [], issueReference: 'B-1', issueTitle: 'Test',
   } });
   const directory = await repository.prepare({ envelope, session, warm: false, emit: () => {} });
   assert.ok(directory);
   await writeFile(join(directory, 'index.html'), 'after');
   await writeFile(join(directory, 'package.json'), '{}');
   await writeFile(join(directory, 'vendor', 'node_modules', 'pinned', 'index.js'), 'v2');
   // Committed by the agent, which an exclude does not undo.
   await mkdir(join(directory, 'node_modules', 'serve'), { recursive: true });
   await writeFile(join(directory, 'node_modules', 'serve', 'index.js'), 'serve');
   assert.equal((await session.exec('git add -A && git -c user.name=Agent -c user.email=agent@test.invalid commit -qm work', { cwd: directory })).exitCode, 0);
   // Left untracked, as an install leaves it.
   await mkdir(join(directory, 'tools', 'node_modules', 'ajv'), { recursive: true });
   await writeFile(join(directory, 'tools', 'node_modules', 'ajv', 'index.js'), 'ajv');
   await mkdir(join(directory, 'src', '__pycache__'), { recursive: true });
   await writeFile(join(directory, 'src', '__pycache__', 'app.pyc'), 'pyc');
   const delivery = await repository.deliver({ envelope, session, directory, summary: 'done', emit: () => {} });
   assert.ok(delivery?.candidate);
   assert.deepEqual(delivery.candidate.map((file) => file.path).sort(), ['index.html', 'package.json', 'vendor/node_modules/pinned/index.js']);
});

test('a path is installed output only when a folder above it is one', () => {
   assert.equal(isInstalledPath('node_modules/ajv/index.js'), true);
   assert.equal(isInstalledPath('packages/web/.next/server/page.js'), true);
   assert.equal(isInstalledPath('src/__pycache__/app.pyc'), true);
   assert.equal(isInstalledPath('node_modules'), false, 'a file named like the folder');
   assert.equal(isInstalledPath('docs/node_modules.md'), false);
   assert.equal(isInstalledPath('src/venv/config.py'), false, 'only the dotted .venv is an environment');
});

test('the next run on a session takes over its installed dependencies and the old checkout is removed', async (t) => {
   const root = await mkdtemp(join(tmpdir(), 'berry-snapshot-test-'));
   t.after(() => rm(root, { recursive: true, force: true }));
   const workspace = join(root, 'workspace');
   const session = new LocalSession({ id: 'test', root: workspace });
   const archiveOf = async (lock: string) => {
      await rm(join(root, 'source'), { recursive: true, force: true });
      await mkdir(join(root, 'source'), { recursive: true });
      await writeFile(join(root, 'source', 'package.json'), '{"scripts":{"test":"node --test"}}');
      await writeFile(join(root, 'source', 'package-lock.json'), lock);
      await writeFile(join(root, 'source', '.nvmrc'), '20\n');
      const path = join(root, 'archive.tar.gz');
      assert.equal((await session.exec(`tar -czf ${shellQuote(path)} -C ${shellQuote(root)} source`)).exitCode, 0);
      return readFile(path);
   };
   let archive = await archiveOf('{"lockfileVersion":3}');
   const repository = snapshotRepository({ fetch: (async () => new Response(archive)) as typeof fetch });
   const envelope = sampleEnvelope({ berry: { apiUrl: 'https://berry.test', token: 'scoped-task-token' }, repo: {
      fullName: 'berry/app', branch: 'agent/task', baseBranch: 'main', snapshotCommit: 'a'.repeat(40),
      credential: { username: '', password: '' }, verifyCommands: [], issueReference: 'B-1', issueTitle: 'Test',
   } });

   const first = await repository.prepare({ envelope, session, warm: false, emit: () => {} });
   assert.ok(first);
   assert.match(await repository.describe!({ session, directory: first }), /Dependencies: not installed\. Run npm ci/);
   assert.match(await repository.describe!({ session, directory: first }), /\.nvmrc asks for 20\. Run nvm install once/);
   await mkdir(join(first, 'node_modules', 'left-pad'), { recursive: true });
   await writeFile(join(first, 'node_modules', 'left-pad', 'index.js'), 'pad');

   const second = await repository.prepare({ envelope, session, warm: false, emit: () => {} });
   assert.ok(second);
   assert.equal(await readFile(join(second, 'node_modules', 'left-pad', 'index.js'), 'utf8'), 'pad');
   assert.deepEqual((await readdir(workspace)).filter((name) => name.startsWith('repo-')), [basename(second)]);
   assert.match(await repository.describe!({ session, directory: second }), /in place from this task's previous run/);
   const delivery = await repository.deliver({ envelope, session, directory: second, summary: 'done', emit: () => {} });
   assert.deepEqual(delivery?.candidate, [], 'carried dependencies are not the work');

   archive = await archiveOf('{"lockfileVersion":3,"packages":{}}');
   const third = await repository.prepare({ envelope, session, warm: false, emit: () => {} });
   assert.ok(third);
   await assert.rejects(readdir(join(third, 'node_modules')), 'a changed lockfile installs afresh');
   assert.deepEqual((await readdir(workspace)).filter((name) => name.startsWith('repo-')), [basename(third)]);
   assert.match(await repository.describe!({ session, directory: third }), /Dependencies: not installed/);
});

test('a backup or patch leftover is known by its suffix', () => {
   assert.equal(isLeftoverFile('src/app/(app)/(workspace)/channel/[id].tsx.bak'), true);
   assert.equal(isLeftoverFile('src/index.ts.orig'), true);
   assert.equal(isLeftoverFile('README.md~'), true);
   assert.equal(isLeftoverFile('.App.tsx.swp'), true);
   assert.equal(isLeftoverFile('src/backup.ts'), false);
   assert.equal(isLeftoverFile('docs/origin.md'), false);
});

test('a crash dump is known by its ELF header, not by being named core', () => {
   const header = (type: number, bigEndian = false) => {
      const bytes = new Uint8Array(18);
      bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, bigEndian ? 2 : 1], 0);
      if (bigEndian) bytes.set([0, type], 16);
      else bytes.set([type, 0], 16);
      return bytes;
   };
   assert.equal(isCoreDump(header(4)), true, 'ET_CORE');
   assert.equal(isCoreDump(header(4, true)), true, 'ET_CORE, big-endian');
   assert.equal(isCoreDump(header(2)), false, 'an executable');
   assert.equal(isCoreDump(new TextEncoder().encode('export const core = 1;\n')), false, 'source');
});
