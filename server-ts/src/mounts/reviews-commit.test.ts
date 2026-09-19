import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SessionService, User } from '../auth/sessions.ts';
import type { BoardRepository } from '../core/boards.ts';
import type { ReviewQueue } from '../core/review-queue.ts';
import { GitHubError } from '../integrations/github.ts';
import { createApp } from '../http/app.ts';
import { Registry } from '../http/registry.ts';
import { Forbidden } from '../identity/errors.ts';
import { reviewMounts } from './reviews.ts';

/**
 * A reviewer's own commit to the branch under review. It writes to a real
 * repository in a person's name, so what it refuses matters as much as what
 * it does.
 */
const RUN = '6f1c0c52-2c6e-4d7c-9a47-0f7f3c1c9b10';
const SHA = 'a'.repeat(40);
const user = { id: 'u1', email: 'ada@example.test', name: 'Ada <Lovelace>', avatarUrl: null, role: 'member', currentWorkspaceId: null, createdAt: '', updatedAt: '' } as unknown as User;

function app(options: { canWrite?: boolean; activeRun?: boolean; open?: boolean; conflict?: boolean } = {}) {
   const written: Array<Record<string, unknown>> = [];
   const registry = new Registry();
   registry.registerAll(
      reviewMounts({
         sessions: { resolveRequest: async () => user } as unknown as SessionService,
         boards: {
            async authorizeWorkspace(_user: string, _workspace: string, permission: string) {
               if (permission === 'product.write' && options.canWrite === false) throw new Forbidden();
            },
         } as unknown as BoardRepository,
         queue: {
            pullRequestOf: async (runId: string) => (runId === RUN ? { workspaceId: 'w', repository: 'o/r', number: 19, issueId: 'i', boardId: 'b', author: null } : null),
            hasActiveRun: async () => options.activeRun === true,
         } as unknown as ReviewQueue,
         gitCredential: async () => ({ password: 't' }),
         github: () =>
            ({
               pullRequestState: async () => ({ merged: false, open: options.open !== false, conflicts: false, base: 'main' }),
               pullRequestHead: async () => ({ commit: 'c'.repeat(40), branch: 'agent/l42-448' }),
               putFile: async (input: Record<string, unknown>) => {
                  if (options.conflict) throw new GitHubError('GitHub PUT … failed: 409', 409);
                  written.push(input);
                  return { commit: 'd'.repeat(40), blob: 'e'.repeat(40) };
               },
            }) as never,
      })
   );
   const server = createApp(registry);
   const commit = (body: unknown) => server.request(`/api/v1/reviews/${RUN}/commit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
   return { commit, written };
}

const edit = { path: 'server/src/app.ts', content: 'export const fixed = true;\n', sha: SHA, message: 'Fix the route order' };

test('an edit is one commit on the pull request’s branch, conditional on the file edited, in the person’s name', async () => {
   const { commit, written } = app();
   const response = await commit(edit);
   assert.equal(response.status, 201);
   assert.deepEqual(await response.json(), { commit: 'd'.repeat(40), sha: 'e'.repeat(40), branch: 'agent/l42-448', path: 'server/src/app.ts' });
   assert.equal(written.length, 1);
   assert.deepEqual({ ...written[0], message: undefined }, { owner: 'o', name: 'r', branch: 'agent/l42-448', path: 'server/src/app.ts', content: edit.content, sha: SHA, message: undefined });
   // The trailer cannot carry an address of its own: angle brackets in a name are dropped.
   assert.equal(written[0]!.message, 'Fix the route order\n\nCo-authored-by: Ada Lovelace <ada@example.test>');
});

test('with no message it says what it did', async () => {
   const { commit, written } = app();
   await commit({ ...edit, message: '   ' });
   assert.match(String(written[0]!.message), /^Update server\/src\/app\.ts\n/);
});

test('it is refused while an agent works the task, on a closed pull request, without write access, and when the file moved on', async () => {
   const expectRefusal = async (options: Parameters<typeof app>[0], status: number, code: string) => {
      const { commit, written } = app(options);
      const response = await commit(edit);
      assert.equal(response.status, status);
      assert.equal(((await response.json()) as { error: { code: string } }).error.code, code);
      assert.equal(written.length, 0);
   };
   await expectRefusal({ activeRun: true }, 409, 'RUN_ACTIVE');
   await expectRefusal({ open: false }, 409, 'PULL_REQUEST_CLOSED');
   await expectRefusal({ canWrite: false }, 403, 'REVIEW_FORBIDDEN');
   await expectRefusal({ conflict: true }, 409, 'FILE_CHANGED');
});

test('paths that run with the repository’s secrets, or leave it, are never written', async () => {
   const { commit, written } = app();
   const workflow = await commit({ ...edit, path: '.github/workflows/deploy.yml' });
   assert.equal(workflow.status, 403);
   assert.equal(((await workflow.json()) as { error: { code: string } }).error.code, 'PATH_REFUSED');
   for (const path of ['../outside.txt', '/etc/passwd', '']) assert.equal((await commit({ ...edit, path })).status, 400, path);
   assert.equal((await commit({ ...edit, sha: 'not-a-sha' })).status, 400);
   assert.equal((await commit({ ...edit, content: 'x'.repeat(1024 * 1024 + 1) })).status, 413);
   assert.equal(written.length, 0);
});
