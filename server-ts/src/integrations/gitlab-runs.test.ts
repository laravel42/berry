import assert from 'node:assert/strict';
import { test } from 'node:test';

import { repositoryParts } from '../agents/checkout.ts';
import { repoPlanSchema } from '../runtime/envelope.ts';
import { GitLabClient, GitLabError } from './gitlab.ts';

/** A GitLab that answers by method and path, and records every request. */
function fakeGitLab(routes: Record<string, (body: unknown, url: URL) => Response>) {
   const calls: Array<{ method: string; path: string; body: unknown }> = [];
   const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      // The project path stays encoded, as GitLab requires it.
      const path = url.pathname.replace('/api/v4', '');
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, path, body });
      const route = routes[`${method} ${path}`];
      return route ? route(body, url) : new Response('{"message":"404 Not Found"}', { status: 404 });
   }) as typeof globalThis.fetch;
   return { client: new GitLabClient({ token: 'glpat-test', fetch }), calls };
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const P = '/projects/quattrolinee%2Fql%2Fbozzo';

test('a nested GitLab path splits at its last slash, and a GitHub path stays owner/name', () => {
   assert.deepEqual(repositoryParts('gitlab', 'quattrolinee/ql/bozzo'), { owner: 'quattrolinee/ql', name: 'bozzo' });
   assert.deepEqual(repositoryParts('gitlab', 'acme/app'), { owner: 'acme', name: 'app' });
   assert.deepEqual(repositoryParts('github', 'acme/app'), { owner: 'acme', name: 'app' });
   assert.throws(() => repositoryParts('github', 'quattrolinee/ql/bozzo'), /not an owner\/name repository/);
});

test('the envelope carries a nested GitLab path to the runtime', () => {
   const plan = {
      fullName: 'quattrolinee/ql/bozzo', branch: 'forge/x', baseBranch: 'main',
      credential: { username: '', password: '' }, verifyCommands: [], issueReference: 'QL-1', issueTitle: 'T',
   };
   assert.equal(repoPlanSchema.safeParse(plan).success, true);
   assert.equal(repoPlanSchema.safeParse({ ...plan, fullName: 'solo' }).success, false);
});

test('repository reads the default branch and whether the token may push', async () => {
   const { client, calls } = fakeGitLab({
      [`GET ${P}`]: () =>
         json({ id: 1, path_with_namespace: 'quattrolinee/ql/bozzo', default_branch: 'develop',
                permissions: { project_access: null, group_access: { access_level: 30 } } }),
   });
   assert.deepEqual(await client.repository('quattrolinee/ql', 'bozzo'), { defaultBranch: 'develop', canPush: true });
   assert.equal(calls[0]?.path, P);

   const reporter = fakeGitLab({
      [`GET ${P}`]: () => json({ id: 1, path_with_namespace: 'x/y', default_branch: 'main',
                                 permissions: { project_access: { access_level: 20 } } }),
   });
   assert.equal((await reporter.client.repository('quattrolinee/ql', 'bozzo')).canPush, false);
});

test('branchHead answers null for a branch that does not exist', async () => {
   const { client, calls } = fakeGitLab({
      [`GET ${P}/repository/branches/main`]: () => json({ name: 'main', commit: { id: 'a'.repeat(40) } }),
   });
   assert.equal(await client.branchHead('quattrolinee/ql', 'bozzo', 'main'), 'a'.repeat(40));
   assert.equal(await client.branchHead('quattrolinee/ql', 'bozzo', 'forge/ql-1-task'), null);
   // A branch name with a slash is one path segment.
   assert.equal(calls[1]?.path, `${P}/repository/branches/forge%2Fql-1-task`);
});

test('publishCandidate starts a new branch at the base commit with one action per file', async () => {
   const base = 'b'.repeat(40);
   const order: string[] = [];
   const { client, calls } = fakeGitLab({
      // README.md and old.txt exist at the base; the rest do not.
      [`HEAD ${P}/repository/files/README.md`]: () => new Response(null, { status: 200 }),
      [`HEAD ${P}/repository/files/old.txt`]: () => new Response(null, { status: 200 }),
      [`POST ${P}/repository/commits`]: () => {
         order.push('commit');
         return json({ id: 'c'.repeat(40) }, 201);
      },
      [`GET ${P}/repository/compare`]: (_body, url) => {
         assert.equal(url.searchParams.get('from'), base);
         assert.equal(url.searchParams.get('to'), 'c'.repeat(40));
         return json({ diffs: [
            { old_path: 'README.md', new_path: 'README.md' },
            { old_path: 'run.sh', new_path: 'run.sh' },
            { old_path: 'old.txt', new_path: 'old.txt' },
         ] });
      },
   });
   const result = await client.publishCandidate({
      owner: 'quattrolinee/ql', name: 'bozzo', branch: 'forge/ql-1', baseCommit: base, defaultCommit: base,
      expectedHead: null, message: 'Berry run 1', timestamp: '2026-11-20T00:00:00.000Z',
      files: [
         { path: 'README.md', mode: '100644', content: Buffer.from('hi\n').toString('base64') },
         { path: 'run.sh', mode: '100755', content: Buffer.from('#!/bin/sh\n').toString('base64') },
         { path: 'old.txt', mode: '100644', content: null },
         { path: 'never.txt', mode: '100644', content: null },
      ],
      authorizePaths: async () => {
         order.push('authorize');
      },
   });
   assert.deepEqual(result, { commit: 'c'.repeat(40), files: ['README.md', 'old.txt', 'run.sh'] });
   assert.deepEqual(order, ['authorize', 'commit'], 'the run is re-checked before anything is written');
   const commit = calls.find((call) => call.method === 'POST')!.body as Record<string, unknown>;
   assert.equal(commit.branch, 'forge/ql-1');
   assert.equal(commit.start_sha, base, 'a new branch starts at the base commit');
   assert.deepEqual(commit.actions, [
      { action: 'update', file_path: 'README.md', content: Buffer.from('hi\n').toString('base64'), encoding: 'base64' },
      { action: 'create', file_path: 'run.sh', content: Buffer.from('#!/bin/sh\n').toString('base64'), encoding: 'base64' },
      { action: 'chmod', file_path: 'run.sh', execute_filemode: true },
      { action: 'delete', file_path: 'old.txt' },
   ]);
});

test('publishCandidate writes nothing when the branch moved during the run', async () => {
   const { client, calls } = fakeGitLab({
      [`GET ${P}/repository/branches/forge%2Fql-1`]: () => json({ commit: { id: 'd'.repeat(40) } }),
   });
   await assert.rejects(
      client.publishCandidate({
         owner: 'quattrolinee/ql', name: 'bozzo', branch: 'forge/ql-1', baseCommit: 'b'.repeat(40),
         defaultCommit: 'b'.repeat(40), expectedHead: 'e'.repeat(40), message: 'm', timestamp: 't',
         files: [{ path: 'a.txt', mode: '100644', content: Buffer.from('a').toString('base64') }],
      }),
      (error: unknown) => error instanceof GitLabError && error.status === 409
   );
   assert.equal(calls.some((call) => call.method === 'POST'), false);
});

test('publishCandidate refuses a symbolic link, which the API cannot write', async () => {
   const { client, calls } = fakeGitLab({});
   await assert.rejects(
      client.publishCandidate({
         owner: 'quattrolinee/ql', name: 'bozzo', branch: 'b', baseCommit: 'b'.repeat(40), defaultCommit: 'b'.repeat(40),
         expectedHead: null, message: 'm', timestamp: 't',
         files: [{ path: 'link', mode: '120000', content: Buffer.from('target').toString('base64') }],
      }),
      /symbolic links/
   );
   assert.equal(calls.length, 0);
});

test('openPullRequest returns the open merge request, or opens one', async () => {
   const open = fakeGitLab({
      [`GET ${P}/merge_requests`]: () => json([{ iid: 4, web_url: 'https://gitlab.com/quattrolinee/ql/bozzo/-/merge_requests/4', state: 'opened' }]),
   });
   const input = { owner: 'quattrolinee/ql', name: 'bozzo', head: 'forge/ql-1', base: 'main', title: 'QL-1: Task', body: 'b' };
   assert.deepEqual(await open.client.openPullRequest(input), {
      number: 4, url: 'https://gitlab.com/quattrolinee/ql/bozzo/-/merge_requests/4', state: 'opened', created: false,
   });
   assert.equal(open.calls.some((call) => call.method === 'POST'), false);

   const fresh = fakeGitLab({
      [`GET ${P}/merge_requests`]: () => json([]),
      [`POST ${P}/merge_requests`]: (body) => {
         assert.deepEqual(body, { source_branch: 'forge/ql-1', target_branch: 'main', title: 'QL-1: Task', description: 'b' });
         return json({ iid: 5, web_url: 'https://gitlab.com/quattrolinee/ql/bozzo/-/merge_requests/5', state: 'opened' }, 201);
      },
   });
   assert.equal((await fresh.client.openPullRequest(input)).created, true);
});

test('archive asks for the project at the snapshot commit', async () => {
   const { client, calls } = fakeGitLab({
      [`GET ${P}/repository/archive.tar.gz`]: (_body, url) => {
         assert.equal(url.searchParams.get('sha'), 'f'.repeat(40));
         return new Response(new Uint8Array([0x1f, 0x8b]), { status: 200 });
      },
   });
   const response = await client.archive('quattrolinee/ql', 'bozzo', 'f'.repeat(40));
   assert.equal(response.ok, true);
   assert.equal(calls[0]?.path, `${P}/repository/archive.tar.gz`);
});
