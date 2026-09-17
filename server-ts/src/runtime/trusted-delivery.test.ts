import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Sql } from '../db/pool.ts';
import type { GitHubClient } from '../integrations/github.ts';
import type { TaskDelivery } from './lifecycle.ts';
import { publishTrustedDelivery, refusedPaths } from './trusted-delivery.ts';

/**
 * The authorization boundary for publication.
 *
 * `publishTrustedDelivery` is what stands between bytes an agent submitted and a
 * commit on a real branch, so every guard here is a refusal that has to keep
 * working. No database: the two queries are faked by their text, which keeps
 * these in the default gate rather than behind `BERRY_TEST_DATABASE_URL`.
 */

const SNAPSHOT = {
   run_id: 'run-1',
   repository: 'berry/app',
   branch: 'agent/ber-1-work',
   base_commit: 'base',
   default_commit: 'main',
   expected_head: 'base',
   read_only: false,
   created_at: '2026-09-16T00:00:00.000Z',
   status: 'running',
   issue_id: 'issue-1',
};

/** Answers the two statements the module runs, chosen by their text. */
function fakeSql(overrides: { snapshot?: Record<string, unknown> | null; runStatus?: string } = {}): Sql {
   const snapshot = overrides.snapshot === undefined ? SNAPSHOT : overrides.snapshot;
   return ((strings: TemplateStringsArray) => {
      const text = strings.join('');
      if (text.includes('run_repository_snapshots')) return Promise.resolve(snapshot ? [snapshot] : []);
      if (text.includes('FROM runs')) return Promise.resolve([{ status: overrides.runStatus ?? 'running' }]);
      return Promise.resolve([]);
   }) as unknown as Sql;
}

/**
 * Stands in for the provider half, and calls `authorizePaths` with the derived
 * path set the way the real client does — that call is the thing under test.
 */
function fakeGitHub(derived: string[]) {
   const calls: Array<{ authorized: string[] | null }> = [];
   const client = {
      publishCandidate: async (input: {
         files: Array<{ path: string }>;
         authorizePaths?: (files: string[]) => Promise<void>;
      }) => {
         const files = derived.length > 0 ? derived : input.files.map((file) => file.path);
         await input.authorizePaths?.(files);
         calls.push({ authorized: files });
         return { commit: 'new-commit', files };
      },
   } as unknown as GitHubClient;
   return { client, calls };
}

function candidate(files: Array<{ path: string; content?: string | null }>): TaskDelivery {
   return {
      candidate: files.map((file) => ({
         path: file.path,
         mode: '100644' as const,
         content: file.content === undefined ? Buffer.from('body').toString('base64') : file.content,
      })),
      committed: false,
      commit: null,
      branch: SNAPSHOT.branch,
      filesChanged: files.length,
      insertions: 3,
      deletions: 1,
      files: files.map((file) => file.path),
   };
}

test('the path policy names what it refuses, and refuses a deletion too', () => {
   assert.deepEqual(refusedPaths(['src/app.ts', 'README.md']), []);
   assert.deepEqual(refusedPaths(['.github/workflows/ci.yml']), ['.github/workflows/ci.yml']);
   assert.deepEqual(refusedPaths(['.github/actions/build/action.yml']), ['.github/actions/build/action.yml']);
   // A case-insensitive filesystem must not be a way around it.
   assert.deepEqual(refusedPaths(['.GitHub/Workflows/ci.yml']), ['.GitHub/Workflows/ci.yml']);
   // Adjacent paths under .github are ordinary files.
   assert.deepEqual(refusedPaths(['.github/CODEOWNERS', '.github/ISSUE_TEMPLATE/bug.md']), []);
   assert.deepEqual(refusedPaths(['src/a.ts', '.github/workflows/b.yml', '.github/actions/c.yml']).length, 2);
});

test('a workflow in the derived path set stops publication, even when the candidate never named it', async () => {
   // The candidate is innocuous; the provider-derived set is what carries the
   // workflow. Policy has to read the derived set or this passes.
   const github = fakeGitHub(['src/app.ts', '.github/workflows/release.yml']);
   await assert.rejects(
      publishTrustedDelivery(fakeSql(), 'run-1', github.client, candidate([{ path: 'src/app.ts' }])),
      /Refusing to publish paths that execute with repository secrets: \.github\/workflows\/release\.yml/
   );
});

test('an ordinary change publishes, and policy saw the derived set', async () => {
   const github = fakeGitHub(['src/app.ts', 'docs/readme.md']);
   const result = await publishTrustedDelivery(
      fakeSql(),
      'run-1',
      github.client,
      candidate([{ path: 'src/app.ts' }])
   );
   assert.equal(result.committed, true);
   assert.equal(result.commit, 'new-commit');
   assert.deepEqual(result.files, ['src/app.ts', 'docs/readme.md']);
   assert.deepEqual(github.calls[0]?.authorized, ['src/app.ts', 'docs/readme.md']);
   // The counts the runtime measured are carried through unchanged.
   assert.equal(result.insertions, 3);
   assert.equal(result.deletions, 1);
});

test('a read-only run may not publish at all', async () => {
   const github = fakeGitHub([]);
   await assert.rejects(
      publishTrustedDelivery(
         fakeSql({ snapshot: { ...SNAPSHOT, read_only: true } }),
         'run-1',
         github.client,
         candidate([{ path: 'src/app.ts' }])
      ),
      /not authorized for repository delivery/
   );
   assert.equal(github.calls.length, 0);
});

test('a run that is no longer running may not publish', async () => {
   const github = fakeGitHub([]);
   await assert.rejects(
      publishTrustedDelivery(
         fakeSql({ snapshot: { ...SNAPSHOT, status: 'cancelled' } }),
         'run-1',
         github.client,
         candidate([{ path: 'src/app.ts' }])
      ),
      /not authorized for repository delivery/
   );
   assert.equal(github.calls.length, 0);
});

test('a run with no snapshot row may not publish', async () => {
   const github = fakeGitHub([]);
   await assert.rejects(
      publishTrustedDelivery(fakeSql({ snapshot: null }), 'run-1', github.client, candidate([{ path: 'a.ts' }])),
      /not authorized for repository delivery/
   );
   assert.equal(github.calls.length, 0);
});

test('a run cancelled between the snapshot read and publication stops at the policy hook', async () => {
   // The snapshot row still says running; the second read does not.
   const github = fakeGitHub(['src/app.ts']);
   await assert.rejects(
      publishTrustedDelivery(
         fakeSql({ runStatus: 'cancelled' }),
         'run-1',
         github.client,
         candidate([{ path: 'src/app.ts' }])
      ),
      /Run stopped before publication/
   );
});

test('duplicate paths and invalid base64 are refused before the provider is called', async () => {
   const duplicates = fakeGitHub([]);
   await assert.rejects(
      publishTrustedDelivery(
         fakeSql(),
         'run-1',
         duplicates.client,
         candidate([{ path: 'src/app.ts' }, { path: 'src/app.ts' }])
      ),
      /duplicate paths/
   );
   assert.equal(duplicates.calls.length, 0);

   const base64 = fakeGitHub([]);
   await assert.rejects(
      publishTrustedDelivery(
         fakeSql(),
         'run-1',
         base64.client,
         candidate([{ path: 'src/app.ts', content: 'not base64 !!!' }])
      ),
      /invalid base64/
   );
   assert.equal(base64.calls.length, 0);
});

test('a candidate that changed nothing is a delivery that committed nothing', async () => {
   const github = fakeGitHub([]);
   const result = await publishTrustedDelivery(fakeSql(), 'run-1', github.client, candidate([]));
   assert.equal(result.committed, false);
   assert.equal(result.commit, null);
   assert.deepEqual(result.files, []);
   assert.equal(result.branch, SNAPSHOT.branch);
   // Nothing reached the provider, so no empty commit exists to explain later.
   assert.equal(github.calls.length, 0);
});

test('a symlink or executable mode survives to the provider unchanged', async () => {
   const github = fakeGitHub(['bin/run']);
   const delivery = candidate([{ path: 'bin/run' }]);
   delivery.candidate![0]!.mode = '100755';
   const result = await publishTrustedDelivery(fakeSql(), 'run-1', github.client, delivery);
   assert.equal(result.committed, true);
});
