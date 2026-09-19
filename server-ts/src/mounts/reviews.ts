import { Hono } from 'hono';
import { requireSession, type AuthVariables } from '../auth/middleware.ts';
import type { SessionService } from '../auth/sessions.ts';
import type { BoardRepository } from '../core/boards.ts';
import type { PullRequestTarget, ReviewQueue, ReviewState } from '../core/review-queue.ts';
import { conflictInstructions, refreshPullRequests, sendBack, type SendBackDeps } from '../agents/send-back.ts';
import { json } from '../http/app.ts';
import { ApiError } from '../http/errors.ts';
import type { Mount } from '../http/registry.ts';
import { Forbidden, NotFound } from '../identity/errors.ts';
import { GitHubClient, GitHubError } from '../integrations/github.ts';
import { parseRepository } from '../agents/checkout.ts';
import { insideDirectory } from '../agents/workspace-files.ts';
import { refusedPaths } from '../runtime/trusted-delivery.ts';
import { coAuthorTrailer, withTrailers } from '../scm/commit-trailer.ts';

/**
 * `/api/v1/reviews`: the human review gate.
 *
 * A decision is the issue changing status through its own route, so nothing
 * here moves a task in a way the board would not. The one write is the merge
 * that Approve makes first: approving a task whose run opened a pull request
 * releases that work, and a release that leaves the change on a branch is not
 * one — every approved task used to leave its pull request open.
 */

export interface ReviewMountOptions {
   sessions: SessionService;
   boards: BoardRepository;
   queue: ReviewQueue;
   /** A credential for the workspace's repository, when the deployment has one. */
   gitCredential: ((workspaceId: string) => Promise<{ password: string }>) | null;
   /** The GitHub client for a token; tests pass a fake. */
   github?: (
      token: string
   ) => Pick<GitHubClient, 'pullRequestDiff' | 'pullRequestState' | 'mergePullRequest' | 'updatePullRequestBranch'> &
      // What a reviewer's commit needs. Optional, so a fake written for merging is still one.
      Partial<Pick<GitHubClient, 'pullRequestHead' | 'putFile'>>;
   /** What returns a conflicting pull request's task to its author. Absent: the conflict is only reported. */
   sendBack?: Pick<SendBackDeps, 'issues' | 'runs'> | null;
   onError?: (message: string, error: unknown) => void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A diff a person can still read in a browser. The tail is cut, and says so. */
const MAX_DIFF_BYTES = 1024 * 1024;
/** A source file a person would read in a browser; past this it is an asset or generated. */
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;

export function reviewMounts(options: ReviewMountOptions): Mount[] {
   const route = new Hono<{ Variables: AuthVariables }>();
   route.use('*', requireSession(options.sessions));

   route.get('/', async (context) => {
      const url = new URL(context.req.url);
      const workspaceId = url.searchParams.get('workspaceId') ?? '';
      if (!UUID.test(workspaceId)) {
         throw new ApiError(422, 'VALIDATION_FAILED', 'workspaceId must be a canonical UUID.');
      }
      const state = url.searchParams.get('state') ?? 'open';
      if (state !== 'open' && state !== 'completed') {
         throw new ApiError(422, 'VALIDATION_FAILED', 'state is open or completed.');
      }
      await authorize(options, context.get('user').id, workspaceId);
      return json({ nodes: await options.queue.list(workspaceId, state as ReviewState) });
   });

   route.get('/:runId/diff', async (context) => {
      const runId = context.req.param('runId');
      if (!UUID.test(runId)) throw ApiError.notFound('Run');
      const target = await options.queue.pullRequestOf(runId);
      if (!target) throw ApiError.notFound('Pull request');
      await authorize(options, context.get('user').id, target.workspaceId);
      if (!options.gitCredential) {
         throw new ApiError(412, 'GITHUB_UNAVAILABLE', 'This deployment has no GitHub credential to read the diff with.');
      }
      const { owner, name } = parseRepository(target.repository);
      const client = new GitHubClient({ token: (await options.gitCredential(target.workspaceId)).password });
      const diff = await client.pullRequestDiff(owner, name, target.number).catch((error: unknown) => {
         if (error instanceof GitHubError) {
            throw new ApiError(502, 'GITHUB_UNAVAILABLE', `GitHub could not serve the diff: ${error.message}`);
         }
         throw error;
      });
      const bounded =
         Buffer.byteLength(diff, 'utf8') > MAX_DIFF_BYTES
            ? `${Buffer.from(diff, 'utf8').subarray(0, MAX_DIFF_BYTES).toString('utf8')}\n… the diff was cut at 1 MiB; open the pull request for the rest.\n`
            : diff;
      return new Response(bounded, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
   });

   /** The reader a files route needs: the workspace's credential, or a plain refusal. */
   const reader = async (runId: string, userId: string) => {
      if (!UUID.test(runId)) throw ApiError.notFound('Run');
      const target = await options.queue.pullRequestOf(runId);
      if (!target) throw ApiError.notFound('Pull request');
      await authorize(options, userId, target.workspaceId);
      if (!options.gitCredential) {
         throw new ApiError(412, 'GITHUB_UNAVAILABLE', 'This deployment has no GitHub credential to read the repository with.');
      }
      const { owner, name } = parseRepository(target.repository);
      return { target, owner, name, client: new GitHubClient({ token: (await options.gitCredential(target.workspaceId)).password }) };
   };

   /**
    * Every file of the repository as the pull request's branch has it, with what
    * the pull request does to each — added, modified, deleted — beside it.
    *
    * A reviewer reading a diff keeps asking what is around it — the router the
    * new route is registered in, the migration before this one. The diff cannot
    * answer, and the task's saved files are only what the agent wrote. This is
    * the tree at the commit under review.
    */
   route.get('/:runId/tree', async (context) => {
      const { target, owner, name, client } = await reader(context.req.param('runId'), context.get('user').id);
      try {
         const { pullRequestHead, putFile } = client;
         if (!pullRequestHead || !putFile) throw new ApiError(412, 'GITHUB_UNAVAILABLE', 'This deployment cannot commit to the repository.');
         const head = await pullRequestHead.call(client, owner, name, target.number);
         const [entries, changes] = await Promise.all([
            client.treeEntries(owner, name, head.commit),
            client.pullRequestChanges(owner, name, target.number).catch(() => []),
         ]);
         const files = [...entries.entries()]
            .filter(([, entry]) => entry.type === 'blob')
            .map(([path, entry]) => ({ path, sha: entry.sha, size: entry.size }));
         // A deleted file is not in the branch's tree, and is part of what is being
         // reviewed: it is listed beside the others, readable as it last was.
         for (const change of changes) {
            if (change.status === 'deleted' && change.sha && !entries.has(change.path)) files.push({ path: change.path, sha: change.sha, size: 0 });
         }
         files.sort((a, b) => a.path.localeCompare(b.path));
         return json({
            repository: target.repository,
            branch: head.branch,
            commit: head.commit,
            files,
            changes: changes.map(({ path, status }) => ({ path, status })),
         });
      } catch (error) {
         if (error instanceof GitHubError) throw new ApiError(502, 'GITHUB_UNAVAILABLE', `GitHub could not list the repository: ${error.message}`);
         throw error;
      }
   });

   /**
    * One file of that tree, by the blob id the tree gave for it: text as text,
    * anything else as opaque bytes for the viewer to type from the file's name.
    * What is too large to look at in a browser is refused in words.
    */
   route.get('/:runId/blob/:sha', async (context) => {
      const sha = context.req.param('sha');
      if (!/^[0-9a-f]{40}([0-9a-f]{24})?$/i.test(sha)) throw ApiError.notFound('File');
      const { owner, name, client } = await reader(context.req.param('runId'), context.get('user').id);
      let bytes: Buffer;
      try {
         bytes = await client.blob(owner, name, sha);
      } catch (error) {
         if (error instanceof GitHubError) {
            if (error.status === 404) throw ApiError.notFound('File');
            throw new ApiError(502, 'GITHUB_UNAVAILABLE', `GitHub could not serve the file: ${error.message}`);
         }
         throw error;
      }
      // Text a person reads, or an asset the viewer shows (an image, a PDF): past these sizes it is neither.
      const binary = bytes.subarray(0, 8192).includes(0);
      if (bytes.byteLength > (binary ? MAX_ASSET_BYTES : MAX_FILE_BYTES)) {
         throw new ApiError(413, 'FILE_TOO_LARGE', 'This file is too large to show here. Open it on GitHub.');
      }
      // Never a type a browser would run: the viewer decides what the bytes are from the file's name.
      return new Response(new Uint8Array(bytes), {
         status: 200,
         headers: {
            'content-type': binary ? 'application/octet-stream' : 'text/plain; charset=utf-8',
            'x-content-type-options': 'nosniff',
            'cache-control': 'private, max-age=3600',
         },
      });
   });

   /**
    * A reviewer's own edit to a file, committed to the pull request's branch.
    *
    * Reading a change is often enough to see the one line that is wrong, and
    * sending the task back to an agent for it costs a whole run. This is the
    * person doing it themselves, as a commit in their name on the branch under
    * review. It is a person's action and only that: no agent tool reaches it.
    *
    * Refused while an agent is working the task (the branch is that run's to
    * move, and its delivery checks the head it started from), on a pull request
    * that is no longer open, on the paths a delivery may not touch either, and
    * when the file on the branch is no longer the one that was edited.
    */
   route.post('/:runId/commit', async (context) => {
      const runId = context.req.param('runId');
      if (!UUID.test(runId)) throw ApiError.notFound('Run');
      const target = await options.queue.pullRequestOf(runId);
      if (!target) throw ApiError.notFound('Pull request');
      const user = context.get('user');
      await authorize(options, user.id, target.workspaceId, 'product.write');
      if (!options.gitCredential) throw new ApiError(412, 'GITHUB_UNAVAILABLE', 'This deployment has no GitHub credential to commit with.');

      const body = (await context.req.json().catch(() => null)) as { path?: unknown; content?: unknown; sha?: unknown; message?: unknown } | null;
      const path = typeof body?.path === 'string' ? insideDirectory(body.path) : null;
      if (!body || path === null || typeof body.content !== 'string' || typeof body.sha !== 'string' || !/^[0-9a-f]{40}([0-9a-f]{24})?$/i.test(body.sha)) {
         throw new ApiError(400, 'VALIDATION_FAILED', 'A path inside the repository, the new content and the file\'s current blob id are required.');
      }
      if (Buffer.byteLength(body.content, 'utf8') > MAX_FILE_BYTES) throw new ApiError(413, 'FILE_TOO_LARGE', 'This file is too large to commit from here.');
      const refused = refusedPaths([path]);
      if (refused.length > 0) throw new ApiError(403, 'PATH_REFUSED', `Berry does not write ${refused[0]}: it runs with the repository's secrets. Change it on GitHub.`);
      if (await options.queue.hasActiveRun(target.issueId)) {
         throw new ApiError(409, 'RUN_ACTIVE', 'An agent is working on this task, and its branch is that run\'s to change. Commit when the run has finished.');
      }

      const subject = (typeof body.message === 'string' ? body.message : '').replace(/\r/g, '').trim().slice(0, 2000) || `Update ${path}`;
      const trailer = coAuthorTrailer({ enabled: true, coAuthorTrailer: true }, { name: user.name, email: user.email });
      const { owner, name } = parseRepository(target.repository);
      const client = clientFor(options, (await options.gitCredential(target.workspaceId)).password);
      try {
         const state = await client.pullRequestState(owner, name, target.number);
         if (state.merged || !state.open) throw new ApiError(409, 'PULL_REQUEST_CLOSED', `Pull request #${target.number} is no longer open, so there is no branch under review to commit to.`);
         const { pullRequestHead, putFile } = client;
         if (!pullRequestHead || !putFile) throw new ApiError(412, 'GITHUB_UNAVAILABLE', 'This deployment cannot commit to the repository.');
         const head = await pullRequestHead.call(client, owner, name, target.number);
         if (!head.branch) throw new ApiError(409, 'PULL_REQUEST_CLOSED', 'The pull request has no branch to commit to.');
         const written = await putFile.call(client, { owner, name, branch: head.branch, path, content: body.content, message: withTrailers(subject, trailer ? [trailer] : []), sha: body.sha });
         return json({ commit: written.commit, sha: written.blob, branch: head.branch, path }, 201);
      } catch (error) {
         if (error instanceof GitHubError) {
            if (error.status === 409) throw new ApiError(409, 'FILE_CHANGED', 'This file changed on the branch since you opened it. Reload the file, and make your edit again.');
            throw new ApiError(502, 'GITHUB_UNAVAILABLE', `GitHub did not accept the commit: ${error.detail || error.message}`);
         }
         throw error;
      }
   });

   /**
    * Merges the pull request a run opened: the first half of Approve. Already
    * merged is success, so a retried Approve does not fail.
    *
    * A conflict is not the approver's to fix and not a reason to leave the task
    * parked: two tasks that ran in parallel touched the same file, and the one
    * merged second has to take the first into account. It goes back to its
    * author — whose next run is built with the merge laid out in it — and the
    * answer is a 409 `MERGE_CONFLICT` that says so in a sentence a person can
    * read. Any other refusal (a required check, a protected branch) is a 409
    * `MERGE_REFUSED` with GitHub's words, and the task stays in review for the
    * person to decide.
    */
   route.post('/:runId/merge', async (context) => {
      const runId = context.req.param('runId');
      if (!UUID.test(runId)) throw ApiError.notFound('Run');
      const target = await options.queue.pullRequestOf(runId);
      if (!target) throw ApiError.notFound('Pull request');
      const user = context.get('user');
      await authorize(options, user.id, target.workspaceId, 'product.write');
      if (!options.gitCredential) {
         throw new ApiError(412, 'GITHUB_UNAVAILABLE', 'This deployment has no GitHub credential to merge with.');
      }
      const { owner, name } = parseRepository(target.repository);
      const client = clientFor(options, (await options.gitCredential(target.workspaceId)).password);
      try {
         const state = await client.pullRequestState(owner, name, target.number);
         if (state.merged) return json({ merged: true, number: target.number, sha: null, already: true });
         if (!state.open) {
            throw new ApiError(409, 'MERGE_REFUSED', `Pull request #${target.number} was closed without being merged.`);
         }
         // GitHub's definite "this conflicts" is enough; otherwise the merge
         // attempt is the answer, since mergeability is computed lazily.
         const outcome = state.conflicts
            ? { merged: false, sha: null, reason: 'Pull Request has merge conflicts', conflict: true }
            : await client.mergePullRequest({ owner, name, number: target.number });
         if (outcome.merged) {
            // Not awaited and never failing: the merge has happened, and the
            // other pull requests being brought up to date is housekeeping.
            void options.queue
               .openPullRequests(target.workspaceId, target.repository, target.number)
               .then((numbers) => refreshPullRequests({ client, repository: target.repository, numbers, onError: options.onError }))
               .catch((error: unknown) => options.onError?.('listing open pull requests failed', error));
            return json({ merged: true, number: target.number, sha: outcome.sha, already: false });
         }
         if (outcome.conflict) throw await conflict(options, target, user.id, state.base ?? 'the default branch');
         throw new ApiError(409, 'MERGE_REFUSED', `GitHub did not merge #${target.number}: ${outcome.reason ?? 'no reason given'}`);
      } catch (error) {
         if (error instanceof GitHubError) {
            throw new ApiError(502, 'GITHUB_UNAVAILABLE', `GitHub could not merge #${target.number}: ${error.message}`);
         }
         throw error;
      }
   });

   return [{ prefix: '/api/v1/reviews', handler: route }];
}

/**
 * A conflicting pull request goes back to its author, and the approver is told.
 *
 * The send-back is the gate's own (`agents/send-back.ts`), in the approver's
 * name: they asked for this work to be released, so the run that makes it
 * releasable is theirs. Without the means to send it back — a deployment that
 * did not wire them, a run with no agent behind it — the answer is still the
 * plain sentence, and the task stays where it is.
 */
async function conflict(options: ReviewMountOptions, target: PullRequestTarget, userId: string, baseBranch: string): Promise<ApiError> {
   const details = { number: target.number, baseBranch };
   if (!options.sendBack || !target.author) {
      return new ApiError(409, 'MERGE_CONFLICT', `Pull request #${target.number} conflicts with ${baseBranch}, so it cannot be merged yet.`, {
         ...details, sentBack: false,
      });
   }
   await sendBack(
      { ...options.sendBack, ...(options.onError ? { onError: options.onError } : {}) },
      {
         issueId: target.issueId,
         boardId: target.boardId,
         workspaceId: target.workspaceId,
         agentId: target.author.id,
         actor: { id: userId, type: 'user' },
         requestedBy: userId,
         again: true,
         instructions: conflictInstructions(target.number, baseBranch),
      }
   );
   return new ApiError(
      409,
      'MERGE_CONFLICT',
      `Pull request #${target.number} conflicts with ${baseBranch}, so it was sent back to ${target.author.name} to bring up to date.`,
      { ...details, sentBack: true }
   );
}

function clientFor(options: ReviewMountOptions, token: string) {
   return options.github ? options.github(token) : new GitHubClient({ token });
}

async function authorize(
   options: ReviewMountOptions,
   userId: string,
   workspaceId: string,
   permission: 'product.read' | 'product.write' = 'product.read'
): Promise<void> {
   await options.boards.authorizeWorkspace(userId, workspaceId, permission).catch((error: unknown) => {
      if (error instanceof NotFound) throw ApiError.notFound('Workspace');
      if (error instanceof Forbidden) {
         throw new ApiError(403, 'REVIEW_FORBIDDEN', 'You cannot read reviews in this workspace.');
      }
      throw error;
   });
}
