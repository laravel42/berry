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
