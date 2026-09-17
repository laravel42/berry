import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalSession } from './local-session.ts';
import { snapshotRepository } from './snapshot-repository.ts';
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
   const directory = await repository.prepare({ envelope, session, warm: false, emit: () => {} });
   assert.ok(directory);
   await writeFile(join(directory, 'keep.txt'), 'after');
   await rm(join(directory, 'remove.txt'));
   assert.equal((await session.exec('git add -A && git -c user.name=Agent -c user.email=agent@test.invalid commit -qm work', { cwd: directory })).exitCode, 0);
   await writeFile(join(directory, 'binary.dat'), Buffer.from([0, 255, 1]));
   const delivery = await repository.deliver({ envelope, session, directory, summary: 'done', emit: () => {} });
   assert.ok(delivery?.candidate);
   assert.deepEqual(delivery.candidate.map((file) => file.path).sort(), ['binary.dat', 'keep.txt', 'remove.txt']);
   assert.equal(delivery.candidate.find((file) => file.path === 'remove.txt')?.content, null);
   assert.equal(delivery.candidate.find((file) => file.path === 'keep.txt')?.content, Buffer.from('after').toString('base64'));
   assert.equal(delivery.committed, false);
   assert.equal((await session.exec('git remote', { cwd: directory })).stdout, '');
   assert.equal((await session.exec('printf "%s" "${BERRY_GIT_TOKEN:-absent}"', { cwd: directory })).stdout, 'absent');
});
