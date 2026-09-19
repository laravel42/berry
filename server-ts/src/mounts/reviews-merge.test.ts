import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SessionService, User } from '../auth/sessions.ts';
import type { BoardRepository } from '../core/boards.ts';
import type { ReviewQueue } from '../core/review-queue.ts';
import { createApp } from '../http/app.ts';
import { Registry } from '../http/registry.ts';
import { Forbidden } from '../identity/errors.ts';
import { reviewMounts } from './reviews.ts';

/**
 * Approve merges the run's pull request before the task is closed. Every
 * approved task used to leave its pull request open; these are the outcomes
 * the decision bar has to tell apart.
 */

const RUN = '6f1c0c52-2c6e-4d7c-9a47-0f7f3c1c9b10';
const WORKSPACE = '7a2d1d63-3d7f-4e8d-8b58-1a8a4d2dac21';
const user = { id: 'u1', email: 'a@b.test', name: 'A', avatarUrl: null, role: 'member', currentWorkspaceId: null, createdAt: '', updatedAt: '' } as unknown as User;

function app(github: { merged?: boolean; open?: boolean; refuse?: string }, options: { canWrite?: boolean } = {}) {
   const calls: string[] = [];
   const registry = new Registry();
   registry.registerAll(
      reviewMounts({
         sessions: { resolveRequest: async () => user } as unknown as SessionService,
         boards: {
            async authorizeWorkspace(_user: string, _workspace: string, permission: string) {
               calls.push(`authorize:${permission}`);
               if (permission === 'product.write' && options.canWrite === false) throw new Forbidden();
            },
         } as unknown as BoardRepository,
         queue: {
            pullRequestOf: async (runId: string) =>
               runId === RUN ? { workspaceId: WORKSPACE, repository: 'laravel42/berry-repo-test', number: 13 } : null,
         } as unknown as ReviewQueue,
         gitCredential: async () => ({ password: 't' }),
         github: () => ({
            pullRequestDiff: async () => '',
            pullRequestState: async () => ({ merged: github.merged === true, open: github.open !== false }),
            mergePullRequest: async (input) => {
               calls.push(`merge:${input.number}`);
               return github.refuse
                  ? { merged: false, sha: null, reason: github.refuse }
                  : { merged: true, sha: 'abc123', reason: null };
            },
         }),
      })
   );
   const server = createApp(registry);
   return { calls, merge: (runId = RUN) => server.request(`/api/v1/reviews/${runId}/merge`, { method: 'POST' }) };
}

test('an open pull request is merged, by someone who may change the task', async () => {
   const { calls, merge } = app({});
   const response = await merge();
   assert.equal(response.status, 200);
   assert.deepEqual(await response.json(), { merged: true, number: 13, sha: 'abc123', already: false });
   assert.deepEqual(calls, ['authorize:product.write', 'merge:13']);
});

test('an already merged pull request is success, so a retried Approve does not fail', async () => {
   const { calls, merge } = app({ merged: true, open: false });
   const response = await merge();
   assert.equal(response.status, 200);
   assert.equal(((await response.json()) as { already: boolean }).already, true);
   assert.ok(!calls.some((call) => call.startsWith('merge:')));
});

test('a refused merge is a 409 with GitHub\'s words, and nothing else happens', async () => {
   const { merge } = app({ refuse: 'Merge conflict' });
   const response = await merge();
   assert.equal(response.status, 409);
   const body = (await response.json()) as { error: { code: string; message: string } };
   assert.equal(body.error.code, 'MERGE_REFUSED');
   assert.match(body.error.message, /Merge conflict/);
});

test('a pull request closed without merging is refused, not reopened', async () => {
   const { calls, merge } = app({ merged: false, open: false });
   const response = await merge();
   assert.equal(response.status, 409);
   assert.ok(!calls.some((call) => call.startsWith('merge:')));
});

test('someone who may only read the task cannot merge', async () => {
   const { calls, merge } = app({}, { canWrite: false });
   const response = await merge();
   assert.equal(response.status, 403);
   assert.ok(!calls.some((call) => call.startsWith('merge:')));
});

test('a run without a pull request has nothing to merge', async () => {
   const { merge } = app({});
   assert.equal((await merge('00000000-0000-4000-8000-000000000000')).status, 404);
});
