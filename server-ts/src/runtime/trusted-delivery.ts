import type { Sql } from '../db/pool.ts';
import type { GitHubClient } from '../integrations/github.ts';
import { parseRepository } from '../agents/checkout.ts';
import { MERGE_DIRECTORY, hasMergeMarker } from './envelope.ts';
import { taskDeliverySchema, type TaskDelivery } from './lifecycle.ts';

/**
 * Paths an agent may never publish.
 *
 * A workflow on a same-repository branch runs with the repository's secrets, so
 * a file under `.github/workflows/` turns "the author submits bytes" back into
 * "the author runs privileged commands" — the one thing this delivery path
 * exists to prevent. Composite actions are the same hole under another name.
 *
 * A deletion is refused as well as a write: removing a workflow is how a
 * required check stops running, and the derived path set does not say which of
 * the two a path represents.
 *
 * Matched case-insensitively. A case-insensitive filesystem, or a provider that
 * folds the name, would otherwise make `.GitHub/Workflows/` a way around this.
 */
const NEVER_PUBLISHED: readonly RegExp[] = [/^\.github\/workflows\//i, /^\.github\/actions\//i];

/** The paths in `files` that policy refuses, sorted. Empty means publication may proceed. */
export function refusedPaths(files: readonly string[]): string[] {
   return files.filter((path) => NEVER_PUBLISHED.some((pattern) => pattern.test(path))).sort();
}

/** Only provider APIs execute here. The author can submit bytes, never privileged commands. */
export async function publishTrustedDelivery(sql: Sql, runId: string, github: GitHubClient, candidate: TaskDelivery): Promise<TaskDelivery> {
   const parsed = taskDeliverySchema.parse(candidate);
   const [snapshot] = await sql`SELECT s.*, r.status, r.issue_id FROM run_repository_snapshots AS s JOIN runs AS r ON r.id = s.run_id WHERE s.run_id = ${runId}`;
   if (!snapshot || snapshot.read_only || snapshot.status !== 'running') throw new Error('This run is not authorized for repository delivery');
   if (!parsed.candidate) throw new Error('Runtime must submit a candidate for trusted delivery; update the runtime image');
   if (Buffer.byteLength(JSON.stringify(parsed.candidate)) > 7 * 1024 * 1024) throw new Error('Candidate exceeds the 7 MiB delivery limit');
   const mergeParent = (snapshot.merge_parent as string | null | undefined) ?? null;
   // A conflict-resolution run's candidate is the whole difference from the
   // default branch, because the runtime laid the branch over it first. A
   // runtime that did not would hand back the agent's edits alone, and
   // publishing those as the merge would drop everything the branch held.
   if (mergeParent && parsed.merged !== true) {
      throw new Error('Runtime did not merge the default branch into this run; update the runtime image');
   }
   const paths = new Set<string>();
   for (const file of parsed.candidate) {
      if (paths.has(file.path)) throw new Error('Candidate contains duplicate paths');
      paths.add(file.path);
      if (file.content !== null && Buffer.from(file.content, 'base64').toString('base64') !== file.content) throw new Error('Candidate contains invalid base64');
      // The merge's working material is never the work. Refused for every
      // run, so nothing under the reserved directory can reach a repository.
      if (file.path.split('/')[0]?.toLowerCase() === MERGE_DIRECTORY) {
         throw new Error(`Candidate contains Berry's merge working files (${file.path})`);
      }
   }
   if (mergeParent) {
      // A marker left in a file is a conflict nobody resolved. Published as a
      // merge commit it would make the pull request mergeable with the markers
      // in it, which is worse than the conflict: this also stops a checkpoint
      // of a half-done merge, and the next run starts the merge again.
      const unresolved = parsed.candidate
         .filter((file) => file.content !== null && file.mode !== '120000' && hasMergeMarker(Buffer.from(file.content, 'base64').toString('utf8')))
         .map((file) => file.path)
         .sort();
      if (unresolved.length > 0) throw new Error(`Conflict markers remain in: ${unresolved.join(', ')}. Reconcile both sides and remove the markers`);
   }
   if (parsed.candidate.length === 0) return { committed: false, commit: null, branch: snapshot.branch as string, files: [], filesChanged: 0, insertions: 0, deletions: 0 };
   const { owner, name } = parseRepository(snapshot.repository as string);
   const result = await github.publishCandidate({
      owner, name, branch: snapshot.branch as string, baseCommit: snapshot.base_commit as string,
      defaultCommit: snapshot.default_commit as string, expectedHead: snapshot.expected_head as string | null,
      // Set on a conflict-resolution run: the commit then has both parents and
      // its tree is built on the default branch head (see `publishCandidate`).
      mergeParent,
      message: `Berry run ${runId}`, timestamp: new Date(snapshot.created_at as string).toISOString(), files: parsed.candidate,
      // The complete changed-path set, derived from provider trees rather than
      // from anything the runtime reported, is what policy is applied to.
      authorizePaths: async (files) => {
         const refused = refusedPaths(files);
         if (refused.length > 0) {
            throw new Error(`Refusing to publish paths that execute with repository secrets: ${refused.join(', ')}`);
         }
         const [run] = await sql`SELECT status FROM runs WHERE id = ${runId}`;
         if (run?.status !== 'running') throw new Error('Run stopped before publication');
      },
   });
   return { committed: true, commit: result.commit, branch: snapshot.branch as string, files: result.files, filesChanged: result.files.length, insertions: parsed.insertions, deletions: parsed.deletions };
}
