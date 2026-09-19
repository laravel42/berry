import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalSession } from './local-session.ts';
import { snapshotRepository } from './snapshot-repository.ts';
import { sampleEnvelope } from '../../../runtime/envelope.test.ts';
import { hasMergeMarker } from '../../../runtime/envelope.ts';
import { mergeArchive, planMerge } from '../../../runtime/merge-plan.ts';
import type { TreeEntry } from '../../../integrations/github.ts';
import { shellQuote } from '../../checkout.ts';

/**
 * A conflict-resolution run, from the control plane's plan to the candidate.
 *
 * Two tasks were cut from the same commit. One merged; this is the other, whose
 * pull request now conflicts. Everything between GitHub and the agent is real
 * here — the plan, the archive, `tar`, `git merge-file`, the candidate — and
 * only GitHub itself is a table of trees and blobs.
 */

type Files = Record<string, string | { content: string; mode: string }>;

function repository(commits: Record<string, Files>) {
   const blobs = new Map<string, Buffer>();
   const trees = new Map<string, Map<string, TreeEntry>>();
   for (const [commit, files] of Object.entries(commits)) {
      const tree = new Map<string, TreeEntry>();
      for (const [path, value] of Object.entries(files)) {
         const content = Buffer.from(typeof value === 'string' ? value : value.content);
         const sha = createHash('sha1').update(content).digest('hex');
         blobs.set(sha, content);
         tree.set(path, { sha, mode: typeof value === 'string' ? '100644' : value.mode, type: 'blob', size: content.length });
      }
      trees.set(commit, tree);
   }
   return {
      treeEntries: async (_owner: string, _name: string, commit: string) => trees.get(commit)!,
      blob: async (_owner: string, _name: string, sha: string) => blobs.get(sha)!,
   };
}

const LONG = `docs/${'deeply-nested-directory/'.repeat(6)}a-file-whose-path-is-longer-than-a-tar-header-allows.md`;

const BASE: Files = {
   'server/README.md': '# Server\n\nRuns the API.\n\n## Usage\n\nStart it.\n',
   'src/shared.ts': 'export const one = 1;\n\n\n\n\nexport const two = 2;\n',
   'src/old.ts': 'gone on the branch\n',
   'src/main-only.ts': 'before\n',
   'logo.bin': 'BASE\0\x01',
};
// The task that merged first.
const THEIRS: Files = {
   ...BASE,
   'server/README.md': '# Server\n\nRuns the API.\n\n## Usage\n\nStart it with `pnpm dev`.\n',
   'src/shared.ts': 'export const one = 1;\n\n\n\n\nexport const two = 22;\n',
   'src/main-only.ts': 'after\n',
   'logo.bin': 'THEIRS\0\x01',
};
// This task's branch.
const OURS: Files = {
   'server/README.md': '# Server\n\nRuns the API.\n\n## Usage\n\nStart it, then open the gallery.\n',
   'src/shared.ts': 'export const one = 11;\n\n\n\n\nexport const two = 2;\n',
   'src/main-only.ts': 'before\n',
   'src/gallery.ts': 'export const gallery = true;\n',
   'bin/run': { content: '#!/bin/sh\n', mode: '100755' },
   [LONG]: 'long path\n',
   'logo.bin': 'OURS\0\x01',
};

test('the workspace is the default branch with the task laid over it, and the candidate is the merge', async (t) => {
   const root = await mkdtemp(join(tmpdir(), 'berry-merge-test-'));
   t.after(() => rm(root, { recursive: true, force: true }));
   const github = repository({ base: BASE, ours: OURS, theirs: THEIRS });
   const plan = await planMerge(github, { owner: 'berry', name: 'app', base: 'base', ours: 'ours', theirs: 'theirs' });
   assert.ok(plan);
   assert.deepEqual(plan.conflicts.map((conflict) => conflict.path), ['logo.bin', 'server/README.md', 'src/shared.ts']);
   assert.deepEqual(plan.take.map((file) => file.path).sort(), ['bin/run', LONG, 'src/gallery.ts'].sort());
   assert.deepEqual(plan.remove, ['src/old.ts']);
   const overlay = await mergeArchive(github, { owner: 'berry', name: 'app', plan, at: new Date('2026-09-19T00:00:00Z') });

   // The snapshot the runtime is served: the default branch head.
   const session = new LocalSession({ id: 'test', root });
   for (const [path, value] of Object.entries(THEIRS)) {
      await mkdir(dirname(join(root, 'source', path)), { recursive: true });
      await writeFile(join(root, 'source', path), typeof value === 'string' ? value : value.content);
   }
   const archivePath = join(root, 'archive.tar.gz');
   assert.equal((await session.exec(`tar -czf ${shellQuote(archivePath)} source`)).exitCode, 0);
   const snapshot = await readFile(archivePath);

   const requested: string[] = [];
   const step = snapshotRepository({ fetch: (async (url, init) => {
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer scoped-task-token');
      requested.push(new URL(String(url)).pathname);
      return new Response(String(url).endsWith('/repository-merge') ? new Uint8Array(overlay) : new Uint8Array(snapshot));
   }) as typeof fetch });
   const envelope = sampleEnvelope({ berry: { apiUrl: 'https://berry.test', token: 'scoped-task-token' }, repo: {
      fullName: 'berry/app', branch: 'agent/task', baseBranch: 'main', snapshotCommit: 'a'.repeat(40),
      merge: { conflicts: plan.conflicts.map((conflict) => conflict.path) },
      credential: { username: '', password: '' }, verifyCommands: [], issueReference: 'B-1', issueTitle: 'Test',
   } });
   const directory = await step.prepare({ envelope, session, warm: false, emit: () => {} });
   assert.ok(directory);
   assert.deepEqual(requested, ['/api/v1/agent-tools/repository-snapshot', '/api/v1/agent-tools/repository-merge']);
   const read = (path: string) => readFile(join(directory, path), 'utf8');

   // One side only: settled without the agent.
   assert.equal(await read('src/main-only.ts'), 'after\n');
   assert.equal(await read('src/gallery.ts'), 'export const gallery = true;\n');
   assert.equal(await read(LONG), 'long path\n');
   assert.ok(!existsSync(join(directory, 'src/old.ts')));
   // Both sides, apart: git merges it, and both changes survive.
   assert.equal(await read('src/shared.ts'), 'export const one = 11;\n\n\n\n\nexport const two = 22;\n');
   // Both sides, the same line: marked for the agent, with both versions beside it.
   const readme = await read('server/README.md');
   assert.ok(hasMergeMarker(readme));
   assert.match(readme, /Start it, then open the gallery\.\n=======\nStart it with `pnpm dev`\.\n>>>>>>> main/);
   assert.equal(await read('.berry-merge/ours/server/README.md'), OURS['server/README.md']);
   assert.equal(await read('.berry-merge/base/server/README.md'), BASE['server/README.md']);
   // A binary file cannot be merged: the default branch's stays, this task's is beside it.
   assert.equal(await read('logo.bin'), 'THEIRS\0\x01');
   assert.equal(await read('.berry-merge/ours/logo.bin'), 'OURS\0\x01');
   const status = await read('.berry-merge/STATUS.md');
   assert.match(status, /## Needs you \(2\)/);
   assert.match(status, /`server\/README.md`: 1 conflict marked/);
   assert.match(status, /`logo.bin`: git could not merge it/);
   assert.match(status, /## Merged cleanly\n\n- `src\/shared.ts`/);
   // Still no way to reach the repository from here.
   assert.equal((await session.exec('git remote', { cwd: directory })).stdout, '');

   // The agent reconciles the README, keeping both sides.
   await writeFile(join(directory, 'server/README.md'), '# Server\n\nRuns the API.\n\n## Usage\n\nStart it with `pnpm dev`, then open the gallery.\n');
   const delivery = await step.deliver({ envelope, session, directory, summary: 'merged', emit: () => {} });
   assert.ok(delivery?.candidate);
   assert.equal(delivery.merged, true);
   const candidate = new Map(delivery.candidate.map((file) => [file.path, file]));
   // The whole difference from the default branch, and nothing else: a file
   // only the default branch changed is not a change, and neither is the
   // binary the agent left as the default branch had it.
   assert.deepEqual([...candidate.keys()].sort(), ['bin/run', LONG, 'server/README.md', 'src/gallery.ts', 'src/old.ts', 'src/shared.ts'].sort());
   assert.equal(candidate.get('src/old.ts')?.content, null);
   assert.equal(candidate.get('bin/run')?.mode, '100755');
   assert.equal(Buffer.from(candidate.get('src/shared.ts')!.content!, 'base64').toString(), 'export const one = 11;\n\n\n\n\nexport const two = 22;\n');
   assert.ok(![...candidate.keys()].some((path) => path.startsWith('.berry-merge')));
});

test('an ordinary run fetches no overlay and says nothing of a merge', async (t) => {
   const root = await mkdtemp(join(tmpdir(), 'berry-merge-test-'));
   t.after(() => rm(root, { recursive: true, force: true }));
   await mkdir(join(root, 'source'));
   await writeFile(join(root, 'source', 'keep.txt'), 'before');
   const session = new LocalSession({ id: 'test', root });
   const archivePath = join(root, 'archive.tar.gz');
   assert.equal((await session.exec(`tar -czf ${shellQuote(archivePath)} source`)).exitCode, 0);
   const snapshot = await readFile(archivePath);
   const requested: string[] = [];
   const step = snapshotRepository({ fetch: (async (url) => {
      requested.push(new URL(String(url)).pathname);
      return new Response(new Uint8Array(snapshot));
   }) as typeof fetch });
   const envelope = sampleEnvelope({ berry: { apiUrl: 'https://berry.test', token: 't' }, repo: {
      fullName: 'berry/app', branch: 'agent/task', baseBranch: 'main', snapshotCommit: 'a'.repeat(40),
      credential: { username: '', password: '' }, verifyCommands: [], issueReference: 'B-1', issueTitle: 'Test',
   } });
   const directory = await step.prepare({ envelope, session, warm: false, emit: () => {} });
   assert.ok(directory);
   await writeFile(join(directory, 'keep.txt'), 'after');
   const delivery = await step.deliver({ envelope, session, directory, summary: 'done', emit: () => {} });
   assert.deepEqual(requested, ['/api/v1/agent-tools/repository-snapshot']);
   assert.equal(delivery?.merged, undefined);
});
