import { parseRepository } from '../agents/checkout.ts';
import { repositoryForIssue } from '../agents/repository-context.ts';
import type { Sql } from '../db/pool.ts';
import type { GitHubClient } from '../integrations/github.ts';
import type { PreviewSource } from './environments.ts';

/**
 * What a task's preview is built from: the commit its pull request points at.
 *
 * Not the files an agent saved on the task. Those are one task's files, and
 * a frontend task's preview needs the API an earlier task already merged; they
 * can also trail the checkout, which is what actually gets committed. The
 * branch head is the whole repository as Approve would merge it.
 *
 * The branch is asked for its head now rather than trusting the commit a run
 * recorded: a person may have pushed to it since. When the branch is gone — a
 * merged pull request's usually is — the recorded commit is still there to fetch.
 */
export interface PreviewSourceDeps {
   sql: Sql;
   github(workspaceId: string): Promise<Pick<GitHubClient, 'archive' | 'branchHead'>>;
}

export async function pullRequestSource(deps: PreviewSourceDeps, issue: { id: string; workspaceId: string }): Promise<PreviewSource | null> {
   const repository = await repositoryForIssue(deps.sql, issue.id);
   if (!repository) return null;
   const [run] = await deps.sql`
      SELECT branch, head_commit FROM runs
       WHERE issue_id = ${issue.id} AND head_commit IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`;
   if (!run) return null;
   const { owner, name } = parseRepository(repository.fullName);
   const client = await deps.github(issue.workspaceId);
   const head = run.branch ? await client.branchHead(owner, name, run.branch as string).catch(() => null) : null;
   const commit = head ?? (run.head_commit as string);
   return { commit, archive: () => client.archive(owner, name, commit) };
}
