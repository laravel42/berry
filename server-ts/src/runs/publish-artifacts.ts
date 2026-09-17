import type { Sql } from '../db/pool.ts';
import { GitHubError, type GitHubClient } from '../integrations/github.ts';
import { repositoryForIssue } from '../agents/repository-context.ts';
import { parseRepository } from '../agents/checkout.ts';
import { RunLedger } from './ledger.ts';

/**
 * Puts the files a run saved into its repository, as a branch and a pull request.
 *
 * `write_file` — the tool agents actually use — saves an artifact against the
 * run. It does not touch the checkout, so a run could write a package and a
 * design document and still deliver `committed: false, files: []`. Three things
 * broke on that, all of them quietly:
 *
 *   - the reviewer had no diff, so it refused work it could not see;
 *   - nothing merged, because there was no pull request to merge;
 *   - and the next task checked out a repository with none of the earlier
 *     tasks' work in it, so a plan's later tasks blocked themselves for want of
 *     inputs that existed but were unreachable.
 *
 * The commit is made through the provider's API rather than a local clone:
 * Berry already holds the bytes, and ADR-0014 keeps the control plane out of the
 * container's filesystem. `publishCandidate` builds the tree on the default
 * branch's head, so the branch always contains the rest of the repository and
 * the diff is only this run's work.
 *
 * Nothing here throws. A run whose files could not be published is a run whose
 * work is still recorded on the task; failing the run afterwards would throw
 * away work that succeeded.
 */

export interface PublishDeps {
   sql: Sql;
   github: (workspaceId: string) => Promise<GitHubClient>;
   /** Reads a saved artifact's bytes. Absent with no file store, and then nothing is published. */
   openArtifact?: ((storageKey: string) => Promise<Uint8Array>) | undefined;
   clock?: () => Date;
   onError?: (message: string, error: unknown) => void;
}

export interface Published {
   branch: string;
   commit: string;
   files: string[];
   pullRequest: number | null;
}

/** Bytes of one file Berry will commit. Larger than a source file, smaller than a video. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export async function publishRunArtifacts(
   deps: PublishDeps,
   runId: string
): Promise<Published | null> {
   const onError = deps.onError ?? (() => {});
   const openArtifact = deps.openArtifact;
   if (!openArtifact) return null;

   const [run] = await deps.sql<
      Array<{
         issue_id: string | null;
         branch: string | null;
         workspace_id: string;
         number: number;
         title: string;
         summary: string | null;
         identifier: string;
      }>
   >`
      SELECT run.issue_id, run.branch, board.workspace_id, issue.number, issue.title, run.summary,
             berry_issue_identifier(board.workspace_id, issue.number) AS identifier
        FROM runs AS run
        JOIN issues AS issue ON issue.id = run.issue_id
        JOIN boards AS board ON board.id = issue.board_id
       WHERE run.id = ${runId}`;
   if (!run?.issue_id) return null;

   // Already delivered a pull request: the run committed for itself, and a
   // second publish would rewrite what a reviewer may already be reading.
   const [delivered] = await deps.sql`
      SELECT payload FROM run_events
       WHERE run_id = ${runId} AND event_type = 'run.delivered'
       ORDER BY occurred_at DESC LIMIT 1`;
   if ((delivered?.payload as { pullRequest?: unknown } | undefined)?.pullRequest) return null;

   const repository = await repositoryForIssue(deps.sql, run.issue_id);
   if (!repository?.fullName) return null;

   const rows = await deps.sql<
      Array<{ path: string; size_bytes: string; storage_key: string }>
   >`
      SELECT DISTINCT ON (path) path, size_bytes, storage_key
        FROM run_artifacts
       WHERE run_id = ${runId} AND state = 'ready'
       ORDER BY path, version DESC`;
   if (rows.length === 0) return null;

   const files: Array<{ path: string; mode: '100644'; content: string }> = [];
   for (const row of rows) {
      if (Number(row.size_bytes) > MAX_FILE_BYTES) {
         onError(`not committing ${row.path}: ${row.size_bytes} bytes is over the file ceiling`, new Error('too large'));
         continue;
      }
      try {
         const bytes = await openArtifact(row.storage_key);
         files.push({ path: row.path, mode: '100644', content: Buffer.from(bytes).toString('base64') });
      } catch (error) {
         // One unreadable object must not cost the rest of the commit; the file
         // is simply not in it, and the task still has the artifact.
         onError(`not committing ${row.path}: its bytes could not be read`, error);
      }
   }
   if (files.length === 0) return null;

   const { owner, name } = parseRepository(repository.fullName);
   const branch = run.branch?.trim() || branchNameFor(run.identifier, run.title);
   const now = (deps.clock ?? (() => new Date()))();

   try {
      const client = await deps.github(run.workspace_id);
      const repo = await client.repository(owner, name);
      const base = await client.branchHead(owner, name, repo.defaultBranch);
      if (!base) {
         onError(`not publishing ${runId}: ${repository.fullName} has no ${repo.defaultBranch} to branch from`, new Error('no base commit'));
         return null;
      }
      // The branch may already exist from an earlier attempt on this task, and
      // then its head is what the write must expect — a fresh branch expects
      // nothing. Getting this wrong is a 409 rather than a lost commit.
      const existing = await client.branchHead(owner, name, branch);

      const published = await client.publishCandidate({
         owner,
         name,
         branch,
         baseCommit: existing ?? base,
         defaultCommit: base,
         expectedHead: existing,
         message: `${run.identifier}: ${run.title}`,
         timestamp: now.toISOString(),
         files,
      });

      const pull = await client.openPullRequest({
         owner,
         name,
         head: branch,
         base: repo.defaultBranch,
         title: `${run.identifier}: ${run.title}`,
         body: pullRequestBodyFor(run.identifier, run.summary, files.map((file) => file.path)),
      });

      await new RunLedger({ sql: deps.sql }).appendDelivered(runId, {
         committed: true,
         commit: published.commit,
         branch,
         filesChanged: published.files.length,
         insertions: 0,
         deletions: 0,
         files: published.files,
         pullRequest: { number: pull.number, url: pull.url, created: pull.created },
         mergeRequiresApproval: true,
      });

      return { branch, commit: published.commit, files: published.files, pullRequest: pull.number };
   } catch (error) {
      // A credential that cannot write, a branch someone else moved, a
      // repository that is gone: all of them leave the work on the task, which
      // is where it already was.
      onError(
         `publishing the files ${runId} saved to ${repository.fullName} failed${
            error instanceof GitHubError ? ` (${error.status})` : ''
         }`,
         error
      );
      return null;
   }
}

/** A branch name from the task, when the run recorded none. */
export function branchNameFor(identifier: string, title: string): string {
   const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48)
      .replace(/-$/, '');
   return `berry/${identifier.toLowerCase()}${slug ? `-${slug}` : ''}`;
}

export function pullRequestBodyFor(identifier: string, summary: string | null, paths: string[]): string {
   return [
      `Berry task ${identifier}.`,
      summary?.trim() ? summary.trim() : 'The agent left no summary.',
      `Files in this change:\n${paths.map((path) => `- \`${path}\``).join('\n')}`,
      'Opened by Berry from the files the run saved on the task.',
   ].join('\n\n');
}
