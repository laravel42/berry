import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GitHubClient } from './github.ts';

function harness(head: string | null = 'base', truncated = false, blobDelayMs = 0) {
   const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
   let activeBlobs = 0;
   let maxActiveBlobs = 0;
   const client = new GitHubClient({ token: 'delivery-secret', fetch: (async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/git/trees/main') || path.endsWith('/git/trees/base')) throw new Error('Tree requests must use a resolved tree SHA');
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      if (init?.method !== 'GET') writes.push({ path, body });
      let result: unknown = {};
      if (path.includes('/git/commits/') && init?.method === 'GET') result = { tree: { sha: 'parent-tree' } };
      else if (path.endsWith('/git/blobs')) {
         activeBlobs += 1;
         maxActiveBlobs = Math.max(maxActiveBlobs, activeBlobs);
         if (blobDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, blobDelayMs));
         activeBlobs -= 1;
         result = { sha: 'blob' };
      }
      else if (path.endsWith('/git/trees')) result = { sha: 'new-tree' };
      else if (path.endsWith('/git/commits')) result = { sha: 'new-commit' };
      else if (path.includes('/git/trees/')) result = { truncated, tree: path.endsWith('new-tree') ? Array.from({ length: 60 }, (_, i) => ({ path: i === 59 ? 'src/auth/login.ts' : `docs/${i}.md`, type: 'blob', mode: '100644', sha: 'blob' })) : [] };
      else if (path.includes('/git/ref/heads/')) return new Response(JSON.stringify(head ? { object: { sha: head } } : {}), { status: head ? 200 : 404 });
      return new Response(JSON.stringify(result));
   }) as typeof fetch });
   return { client, writes, maxActiveBlobs: () => maxActiveBlobs };
}
const input = { owner: 'berry', name: 'app', branch: 'agent/work', baseCommit: 'base', defaultCommit: 'main', expectedHead: 'base', message: 'Change', timestamp: '2026-09-16T00:00:00Z', files: [{ path: 'src/auth/login.ts', mode: '100644' as const, content: Buffer.from('fixed').toString('base64') }] };
test('trusted delivery derives all policy paths and publishes only a fast-forward ref', async () => {
   const { client, writes } = harness();
   const result = await client.publishCandidate(input);
   assert.equal(result.files.length, 60);
   assert.ok(result.files.includes('src/auth/login.ts'));
   assert.equal(writes.find((entry) => entry.path.includes('/git/refs/'))?.body.force, false);
});
test('blob uploads run in bounded parallel waves', async () => {
   const run = harness('base', false, 10);
   const files = Array.from({ length: 12 }, (_, index) => ({
      path: `src/${index}.ts`,
      mode: '100644' as const,
      content: Buffer.from(String(index)).toString('base64'),
   }));

   await run.client.publishCandidate({ ...input, files });

   assert.equal(run.maxActiveBlobs(), 8, 'the provider sees at most one eight-file wave');
});

test('a changed remote branch is never overwritten', async () => {
   const { client, writes } = harness('human-change');
   await assert.rejects(client.publishCandidate(input), /branch changed/);
   assert.ok(!writes.some((entry) => entry.path.includes('/git/refs')));
});
test('truncated provider trees and failed path policies prevent publication', async () => {
   const truncated = harness('base', true);
   await assert.rejects(truncated.client.publishCandidate(input), /complete review manifest/);
   assert.ok(!truncated.writes.some((entry) => entry.path.includes('/git/refs')));
   const policy = harness();
   await assert.rejects(policy.client.publishCandidate({ ...input, authorizePaths: async () => { throw new Error('forbidden'); } }), /forbidden/);
   assert.ok(!policy.writes.some((entry) => entry.path.includes('/git/refs')));
});

test('a conflict-resolution delivery is a merge commit on the default branch tree, branch head first', async () => {
   const { client, writes } = harness();
   await client.publishCandidate({ ...input, mergeParent: 'main' });
   const commit = writes.find((entry) => entry.path.endsWith('/git/commits'));
   // Both parents: only a commit descended from the default branch head clears
   // the conflict, and the branch head first keeps the ref a fast-forward.
   assert.deepEqual(commit?.body.parents, ['base', 'main']);
   assert.equal(writes.find((entry) => entry.path.includes('/git/refs/'))?.body.force, false);
   // An ordinary delivery keeps its single parent.
   const ordinary = harness();
   await ordinary.client.publishCandidate(input);
   assert.deepEqual(ordinary.writes.find((entry) => entry.path.endsWith('/git/commits'))?.body.parents, ['base']);
});

test('a refused merge is reported in GitHub\'s words alone, and a conflict is told apart', async () => {
   const refusing = (status: number, message: string) =>
      new GitHubClient({ token: 't', fetch: (async () => new Response(JSON.stringify({ message }), { status })) as typeof fetch });
   const conflict = await refusing(405, 'Pull Request has merge conflicts').mergePullRequest({ owner: 'berry', name: 'app', number: 5 });
   assert.deepEqual(conflict, { merged: false, sha: null, reason: 'Pull Request has merge conflicts', conflict: true });
   const check = await refusing(405, 'Required status check "ci" is expected.').mergePullRequest({ owner: 'berry', name: 'app', number: 5 });
   assert.equal(check.conflict, false);
   assert.doesNotMatch(check.reason ?? '', /PUT|\/repos\//);
});

test('a pull request GitHub knows to conflict says so, and an unknown mergeability does not', async () => {
   const answering = (body: unknown) => new GitHubClient({ token: 't', fetch: (async () => new Response(JSON.stringify(body))) as typeof fetch });
   const dirty = await answering({ state: 'open', merged: false, mergeable: false, mergeable_state: 'dirty', base: { ref: 'main' } }).pullRequestState('berry', 'app', 5);
   assert.deepEqual(dirty, { merged: false, open: true, conflicts: true, base: 'main' });
   const unknown = await answering({ state: 'open', merged: false, mergeable: null, mergeable_state: 'unknown' }).pullRequestState('berry', 'app', 5);
   assert.equal(unknown.conflicts, false);
});

test('updating a branch that conflicts is an answer, not a failure', async () => {
   const client = new GitHubClient({ token: 't', fetch: (async () => new Response(JSON.stringify({ message: 'merge conflict between base and head' }), { status: 422 })) as typeof fetch });
   assert.deepEqual(await client.updatePullRequestBranch('berry', 'app', 4), { updated: false, reason: 'merge conflict between base and head' });
});
