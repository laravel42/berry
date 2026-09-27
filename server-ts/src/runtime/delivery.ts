import type { Sql } from '../db/pool.ts';
import { GitHubError, type GitHubClient } from '../integrations/github.ts';
import { parseRepository } from '../agents/checkout.ts';
import { pullRequestBody } from '../agents/repository-run.ts';
import type { VerificationReport } from '../agents/verification.ts';
import type { RunLedger } from '../runs/ledger.ts';
import type { DeliveryPlan } from './envelope-builder.ts';
import type { TaskDelivery, TaskMessage } from './lifecycle.ts';

/**
 * The half of delivery that needs the GitHub App: the runtime committed and
 * pushed the branch; Berry opens the pull request and records the delivery.
 * Called before the run is marked succeeded, while the ledger still accepts
 * events for it.
 */
export async function recordDelivery(deps: {
   sql: Sql;
   ledger: RunLedger;
   github: GitHubClient | null;
   runId: string;
   plan: DeliveryPlan;
   delivery: TaskDelivery;
   summary: string | null;
   verified: Extract<TaskMessage, { kind: 'verified' }> | null;
}): Promise<void> {
   const { plan, delivery } = deps;
   let pullRequest: { number: number; url: string; created: boolean } | null = null;
   // A run that committed nothing may still stand on work of its own task: a
   // run stopped at its step limit commits a checkpoint, and the continuation
   // that finds the job done has nothing left to add. The branch then holds
   // the whole delivery with no pull request, and its review read as a run
   // that delivered nothing. The branch's head as this run began, where it
   // is not the default branch's, is that earlier work.
   const [snapshot] = delivery.committed
      ? []
      : await deps.sql<Array<{ expected_head: string | null; default_commit: string | null }>>`
           SELECT expected_head, default_commit FROM run_repository_snapshots WHERE run_id = ${deps.runId}`;
   const earlierWork =
      snapshot?.expected_head && snapshot.expected_head !== snapshot.default_commit ? snapshot.expected_head : null;
   if ((delivery.committed || earlierWork) && plan.mayOpenPullRequest && deps.github) {
      const report: VerificationReport = deps.verified
         ? {
              // The runtime reports each check's verdict, not its output tail.
              results: deps.verified.results.map((r) => ({ ...r, output: '' })),
              passed: deps.verified.passed,
              complete: deps.verified.complete,
              durationMs: deps.verified.durationMs,
           }
         : { results: [], passed: true, complete: true, durationMs: 0 };
      const { owner, name } = parseRepository(plan.fullName);
      try {
         const opened = await deps.github.openPullRequest({
            owner,
            name,
            head: plan.branch,
            base: plan.defaultBranch,
            title: `${plan.reference}: ${plan.title}`,
            body: pullRequestBody(deps.summary, report, deps.runId, plan.reference, { mergeRequiresApproval: plan.mergeRequiresApproval }),
         });
         pullRequest = { number: opened.number, url: opened.url, created: opened.created };
      } catch (error) {
         // Earlier work already merged leaves nothing between the branch and
         // its base, which GitHub refuses with 422: no pull request, and no
         // failure either. This run's own commit refused is still a failure.
         if (delivery.committed || !(error instanceof GitHubError) || error.status !== 422) throw error;
      }
   }
   await deps.sql`
      UPDATE runs SET branch = ${plan.branch}, head_commit = ${delivery.commit ?? (pullRequest ? earlierWork : null)},
             pull_request_number = ${pullRequest ? pullRequest.number : null}, updated_at = now()
       WHERE id = ${deps.runId}`;
   await deps.ledger.appendDelivered(deps.runId, {
      committed: delivery.committed,
      commit: delivery.commit,
      branch: plan.branch,
      filesChanged: delivery.filesChanged,
      insertions: delivery.insertions,
      deletions: delivery.deletions,
      files: delivery.files,
      pullRequest,
      mergeRequiresApproval: plan.mergeRequiresApproval,
   });
}
