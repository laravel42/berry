import type { Sql } from '../db/pool.ts';
import { IssueRepository } from '../core/issues.ts';
import { ReviewQueue, type OpenPullRequestTask } from '../core/review-queue.ts';
import type { GitHubClient } from '../integrations/github.ts';
import { RunRepository } from '../runs/repository.ts';
import { postRunResult } from '../runs/result-comment.ts';
import { parseRepository } from './checkout.ts';
import { conflictInstructions, sendBack } from './send-back.ts';

/**
 * A conflict is resolved before review, not found at Approve.
 *
 * A branch conflicts with the default branch when another task merged into
 * it after the branch was cut. Berry learned that only when a person pressed
 * Approve and the merge was refused, so a task could sit in review for hours
 * waiting on a decision it could not yet take. It now looks at the two moments
 * a conflict can appear:
 *
 * - after a merge, every other open pull request of the repository is brought
 *   up to date; one GitHub refuses for a conflict goes back to its author;
 * - when a run delivers while the default branch has moved since it began,
 *   its pull request is brought up to date the same way, before review.
 *
 * The author's next run is the conflict-resolution run the Approve path
 * already starts (`conflictInstructions`, `runtime/merge-plan.ts`). Everything
 * here is best effort: the merge or the delivery that prompted it has
 * happened, and never fails for this.
 */

export interface ConflictDeps {
   sql: Sql;
   /** GitHub, with the workspace's installation token for the repository's owner. */
   github: (workspaceId: string, owner: string) => Promise<Pick<GitHubClient, 'updatePullRequestBranch' | 'pullRequestState'>>;
   onError?: (message: string, error: unknown) => void;
}

/** Whether GitHub refused to update a branch because it conflicts. */
export function refusedForConflict(reason: string | null): boolean {
   return reason !== null && /conflict/i.test(reason);
}

/** After a merge: every other open pull request brought up to date; a conflicting one sent back. */
export async function afterMerge(
   deps: ConflictDeps,
   /** `merged.name` is how the comment names what was merged: the task's key, or its pull request. */
   input: { workspaceId: string; repository: string; merged: { number: number; name: string } }
): Promise<void> {
   try {
      const tasks = await new ReviewQueue(deps.sql).openPullRequestTasks(input.workspaceId, input.repository, input.merged.number);
      for (const task of tasks) {
         await bringUpToDate(deps, input.repository, task, `${input.merged.name} was merged into it`);
      }
   } catch (error) {
      deps.onError?.('bringing open pull requests up to date failed', error);
   }
}

/** After a run delivers: its pull request brought up to date when the default branch moved since the run began. */
export async function afterDelivery(deps: ConflictDeps, input: { runId: string }): Promise<void> {
   try {
      const [row] = await deps.sql`
         SELECT run.workspace_id, run.pull_request_number, snapshot.repository, snapshot.default_commit
           FROM runs AS run
           JOIN run_repository_snapshots AS snapshot ON snapshot.run_id = run.id
          WHERE run.id = ${input.runId} AND run.pull_request_number IS NOT NULL`;
      if (!row) return;
      const repository = row.repository as string;
      const task = (
         await new ReviewQueue(deps.sql).openPullRequestTasks(row.workspace_id as string, repository, null)
      ).find((candidate) => candidate.runId === input.runId);
      if (!task) return;
      await bringUpToDate(deps, repository, task, 'another task was merged while this run was working');
   } catch (error) {
      deps.onError?.('bringing the delivered pull request up to date failed', error);
   }
}

/**
 * Updates one pull request's branch from its base. Behind but clean, GitHub
 * merges the base in by itself; refused for a conflict, the task goes back to
 * its author with the conflict to resolve, if it is waiting on review.
 */
async function bringUpToDate(deps: ConflictDeps, repository: string, task: OpenPullRequestTask, cause: string): Promise<void> {
   const { owner, name } = parseRepository(repository);
   const client = await deps.github(task.workspaceId, owner);
   const update = await client.updatePullRequestBranch(owner, name, task.number);
   if (update.updated) return;
   const state = await client.pullRequestState(owner, name, task.number).catch(() => null);
   if (!refusedForConflict(update.reason) && state?.conflicts !== true) return;
   if (task.status !== 'in_review') return;
   const baseBranch = state?.base ?? 'the default branch';
   await postRunResult(deps.sql, {
      issueId: task.issueId,
      agentId: task.agentId,
      text:
         `**Pull request #${task.number} conflicts with ${baseBranch}**: ${cause}. ` +
         'Sent back to bring it up to date before review; the next run reconciles the files both changed.',
      cut: false,
      occurredAt: new Date().toISOString(),
   });
   await sendBack(
      {
         issues: new IssueRepository(deps.sql),
         runs: new RunRepository(deps.sql),
         ...(deps.onError ? { onError: deps.onError } : {}),
      },
      {
         issueId: task.issueId,
         boardId: task.boardId,
         workspaceId: task.workspaceId,
         agentId: task.agentId,
         actor: { id: task.agentId, type: 'agent' },
         requestedBy: task.requestedBy,
         again: true,
         instructions: conflictInstructions(task.number, baseBranch),
         rejected: false,
      }
   );
}
