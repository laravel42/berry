import type { Sql } from '../db/pool.ts';
import type { GitHubClient } from '../integrations/github.ts';
import { parseRepository } from '../agents/checkout.ts';
import { MERGE_DIRECTORY, hasMergeMarker } from './envelope.ts';
import { taskDeliverySchema, type TaskDelivery } from './lifecycle.ts';

/**
 * Publishes a run's candidate through the Git data API.
 *
 * The runtime submits file bytes. This path creates blobs, a tree and a
 * commit; it does not check out the repository or run the files. A file under
 * `.github/workflows/` or `.github/actions/` is one of those bytes. GitHub
 * Actions runs it later, and the token's `workflow` scope is what authorizes
 * the write.
 */
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
      // Re-read the run after the tree exists. A run that stopped while the
      // provider calls were in flight must not gain a branch.
      authorizePaths: async () => {
         const [run] = await sql`SELECT status FROM runs WHERE id = ${runId}`;
         if (run?.status !== 'running') throw new Error('Run stopped before publication');
      },
   });
   return { committed: true, commit: result.commit, branch: snapshot.branch as string, files: result.files, filesChanged: result.files.length, insertions: parsed.insertions, deletions: parsed.deletions };
}
