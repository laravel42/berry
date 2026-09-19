import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SessionService, User } from '../auth/sessions.ts';
import type { BoardRepository } from '../core/boards.ts';
import type { IssueRepository } from '../core/issues.ts';
import type { ReviewQueue } from '../core/review-queue.ts';
import { isMergeConflict } from '../integrations/github.ts';
import type { RunRepository } from '../runs/repository.ts';
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

const ISSUE = '8b3e2e74-4e80-4f9e-9c69-2b9b5e3ebd32';
const BOARD = '9c4f3f85-5f91-4a0f-8d7a-3cac6f4fce43';
const AGENT = 'ad5a4a96-6aa2-4b1a-9e8b-4dbd7a5adf54';

function app(
   github: { merged?: boolean; open?: boolean; refuse?: string; conflicts?: boolean; updateFails?: boolean },
   options: { canWrite?: boolean; sendBack?: boolean; author?: boolean; others?: number[] } = {}
) {
   const calls: string[] = [];
   const admitted: Array<{ agentId: string | null; requestedBy: string; instructions: string | null }> = [];
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
               runId === RUN
                  ? {
                       workspaceId: WORKSPACE, repository: 'laravel42/berry-repo-test', number: 13, issueId: ISSUE, boardId: BOARD,
                       author: options.author === false ? null : { id: AGENT, name: 'Ada' },
                    }
                  : null,
            openPullRequests: async (_workspace: string, _repository: string, except: number) => {
               calls.push(`others-except:${except}`);
               return options.others ?? [];
            },
         } as unknown as ReviewQueue,
         gitCredential: async () => ({ password: 't' }),
         ...(options.sendBack === false
            ? {}
            : {
                 sendBack: {
                    issues: {
                       update: async (input: { issueId: string; patch: { status?: string }; actorId: string; actorType: string }) => {
                          calls.push(`status:${input.issueId}:${input.patch.status}:${input.actorType}:${input.actorId}`);
                       },
                    } as unknown as IssueRepository,
                    runs: {
                       admit: async (input: { agentId: string | null; requestedBy: string; instructions: string | null }) => {
                          admitted.push(input);
                       },
                    } as unknown as RunRepository,
                 },
              }),
         github: () => ({
            pullRequestDiff: async () => '',
            pullRequestState: async () => ({
               merged: github.merged === true, open: github.open !== false, conflicts: github.conflicts === true, base: 'main',
            }),
            mergePullRequest: async (input) => {
               calls.push(`merge:${input.number}`);
               return github.refuse
                  ? { merged: false, sha: null, reason: github.refuse, conflict: isMergeConflict(github.refuse) }
                  : { merged: true, sha: 'abc123', reason: null, conflict: false };
            },
            updatePullRequestBranch: async (_owner, _name, number) => {
               calls.push(`update:${number}`);
               if (github.updateFails) throw new Error('GitHub is unreachable');
               return { updated: true, reason: null };
            },
         }),
      })
   );
   const server = createApp(registry);
   return { calls, admitted, merge: (runId = RUN) => server.request(`/api/v1/reviews/${runId}/merge`, { method: 'POST' }) };
}

/** Lets work the route started but did not wait for run to its end. */
const settled = () => new Promise((resolve) => setImmediate(resolve));

test('an open pull request is merged, by someone who may change the task', async () => {
   const { calls, merge } = app({});
   const response = await merge();
   assert.equal(response.status, 200);
   assert.deepEqual(await response.json(), { merged: true, number: 13, sha: 'abc123', already: false });
   assert.deepEqual(calls, ['authorize:product.write', 'merge:13', 'others-except:13']);
});

test('an already merged pull request is success, so a retried Approve does not fail', async () => {
   const { calls, merge } = app({ merged: true, open: false });
   const response = await merge();
   assert.equal(response.status, 200);
   assert.equal(((await response.json()) as { already: boolean }).already, true);
   assert.ok(!calls.some((call) => call.startsWith('merge:')));
});

test('a merge refused for another reason is a 409 with GitHub\'s words, and the task stays in review', async () => {
   const { calls, admitted, merge } = app({ refuse: 'Required status check "ci" is failing' });
   const response = await merge();
   assert.equal(response.status, 409);
   const body = (await response.json()) as { error: { code: string; message: string } };
   assert.equal(body.error.code, 'MERGE_REFUSED');
   assert.match(body.error.message, /Required status check/);
   assert.ok(!calls.some((call) => call.startsWith('status:')));
   assert.equal(admitted.length, 0);
});

test('a conflict sends the task back to its agent, and says so without transport text', async () => {
   const { calls, admitted, merge } = app({ refuse: 'Pull Request has merge conflicts' });
   const response = await merge();
   assert.equal(response.status, 409);
   const body = (await response.json()) as { error: { code: string; message: string; details: { sentBack: boolean } } };
   assert.equal(body.error.code, 'MERGE_CONFLICT');
   assert.equal(body.error.message, 'Pull request #13 conflicts with main, so it was sent back to Ada to bring up to date.');
   assert.doesNotMatch(body.error.message, /PUT|\/repos\/|405/);
   assert.equal(body.error.details.sentBack, true);
   // Back to todo in the approver's name, and a run for the author that says what is wanted.
   assert.ok(calls.includes(`status:${ISSUE}:todo:user:u1`));
   assert.equal(admitted.length, 1);
   assert.equal(admitted[0]?.agentId, AGENT);
   assert.equal(admitted[0]?.requestedBy, 'u1');
   assert.match(admitted[0]?.instructions ?? '', /#13 could not be merged: it conflicts with main/);
   assert.match(admitted[0]?.instructions ?? '', /remove nothing the other task added/);
});

test('a conflict GitHub already knows about is not attempted', async () => {
   const { calls, admitted, merge } = app({ conflicts: true });
   const response = await merge();
   assert.equal(response.status, 409);
   assert.equal(((await response.json()) as { error: { code: string } }).error.code, 'MERGE_CONFLICT');
   assert.ok(!calls.some((call) => call.startsWith('merge:')));
   assert.equal(admitted.length, 1);
});

test('a conflict with nobody to send it back to is still reported plainly', async () => {
   for (const options of [{ sendBack: false }, { author: false }]) {
      const { calls, admitted, merge } = app({ refuse: 'Pull Request has merge conflicts' }, options);
      const response = await merge();
      assert.equal(response.status, 409);
      const body = (await response.json()) as { error: { code: string; message: string; details: { sentBack: boolean } } };
      assert.equal(body.error.code, 'MERGE_CONFLICT');
      assert.equal(body.error.message, 'Pull request #13 conflicts with main, so it cannot be merged yet.');
      assert.equal(body.error.details.sentBack, false);
      assert.ok(!calls.some((call) => call.startsWith('status:')));
      assert.equal(admitted.length, 0);
   }
});

test('a merge brings the repository\'s other open pull requests up to date', async () => {
   const { calls, merge } = app({}, { others: [4, 9] });
   assert.equal((await merge()).status, 200);
   await settled();
   assert.ok(calls.includes('others-except:13'));
   assert.ok(calls.includes('update:4') && calls.includes('update:9'));
});

test('failing to update the other pull requests never fails the merge', async () => {
   const { calls, merge } = app({ updateFails: true }, { others: [4] });
   const response = await merge();
   assert.equal(response.status, 200);
   assert.equal(((await response.json()) as { merged: boolean }).merged, true);
   await settled();
   assert.ok(calls.includes('update:4'));
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
