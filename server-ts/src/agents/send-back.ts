import type { IssueRepository } from '../core/issues.ts';
import type { GitHubClient } from '../integrations/github.ts';
import type { RunRepository } from '../runs/repository.ts';
import { parseRepository } from './checkout.ts';

/**
 * Sending a task back to its author, and what goes with a merge.
 *
 * Shared by the two places that release work: the AutoGate (`review-gate.ts`)
 * and a person's Approve (`mounts/reviews.ts`). Both merge a pull request, both
 * can be refused for a conflict, and both answer it the same way — the task
 * returns to `todo` and its author gets another run, told what is wanted.
 */

export interface SendBackDeps {
   issues: Pick<IssueRepository, 'update'>;
   runs: Pick<RunRepository, 'admit'>;
   onError?: (message: string, error: unknown) => void;
}

/** Back to todo, and — when `again` — another go for the author. */
export async function sendBack(
   deps: SendBackDeps,
   input: {
      issueId: string;
      boardId: string;
      workspaceId: string;
      /** The author, who gets the next run. */
      agentId: string;
      /** Who moves the task. */
      actor: { id: string; type: 'user' | 'agent' };
      /** Whose request the next run is; without one nobody is re-admitted. */
      requestedBy: string | null;
      again: boolean;
      /** What the next run is told, beyond the task itself. */
      instructions: string | null;
   }
): Promise<void> {
   await deps.issues.update({
      issueId: input.issueId,
      patch: { status: 'todo', descriptionSet: false, dueDateSet: false, assigneeSet: false, projectSet: false },
      actorId: input.actor.id,
      actorType: input.actor.type,
   });
   if (!input.again || !input.requestedBy) return;
   await deps.runs
      .admit({
         issueId: input.issueId,
         boardId: input.boardId,
         workspaceId: input.workspaceId,
         agentId: input.agentId,
         requestedBy: input.requestedBy,
         instructions: input.instructions,
      })
      .catch((error: unknown) => deps.onError?.('re-admitting the author failed', error));
}

/**
 * What the author is told when its pull request conflicts.
 *
 * Says what is wanted rather than how: the run that follows is built with the
 * merge laid out in its workspace (see `runtime/merge-plan.ts`), and its prompt
 * names the files. This is the reason it was started.
 */
export function conflictInstructions(number: number, baseBranch: string): string {
   return (
      `Pull request #${number} could not be merged: it conflicts with ${baseBranch}, which another task changed after this ` +
      `branch was cut. Bring the branch up to date with ${baseBranch}. Reconcile every conflicting file so that both this ` +
      `task's change and what ${baseBranch} gained are kept, remove nothing the other task added, leave no conflict marker, ` +
      'and run the checks. The task itself is otherwise finished: change nothing else.'
   );
}

/** What the author is told when GitHub refused the merge for another reason. */
export function refusedInstructions(number: number, reason: string): string {
   return `Pull request #${number} passed review but GitHub would not merge it. GitHub said: ${reason}\nFix what stops the merge; the task itself is otherwise finished.`;
}

/**
 * Brings the repository's other open pull requests up to date after a merge.
 *
 * Every merge moves the default branch under the tasks still in flight. Most
 * of them do not conflict with it, and GitHub can merge the default branch into
 * those by itself — which keeps "out of date" from ever reaching an agent, and
 * leaves the conflict-resolution run for branches that really need one (a
 * conflicting branch is refused here and left as it is).
 *
 * Best effort by construction: it never throws, because the merge that
 * prompted it has already happened and must not be reported as failed.
 */
export async function refreshPullRequests(input: {
   client: Pick<GitHubClient, 'updatePullRequestBranch'>;
   repository: string;
   numbers: readonly number[];
   onError?: ((message: string, error: unknown) => void) | undefined;
}): Promise<void> {
   try {
      const { owner, name } = parseRepository(input.repository);
      await Promise.all(
         input.numbers.map((number) =>
            input.client
               .updatePullRequestBranch(owner, name, number)
               .then(() => undefined)
               .catch((error: unknown) => input.onError?.(`updating pull request #${number} failed`, error))
         )
      );
   } catch (error) {
      input.onError?.('updating open pull requests failed', error);
   }
}
