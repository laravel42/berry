import type { GitHubClient, TreeEntry } from '../integrations/github.ts';
import { MERGE_DIRECTORY, MERGE_MANIFEST_PATH, type MergeManifest } from './envelope.ts';
import { tarGz, type TarEntry } from './tar.ts';

/**
 * The merge a conflict-resolution run has to make, worked out from three trees.
 *
 * Berry runs tasks in parallel on one repository, each on a branch cut from the
 * default branch. Two that edit the same file leave the second pull request
 * unmergeable, and its agent cannot fix that from a snapshot of its own branch:
 * it has never seen the other side. So the run's workspace is built as the
 * default branch head with the task branch laid over it, and this module says
 * what "laid over" means, file by file, the way a three-way merge does:
 *
 *  - changed only on the default branch: the default branch's version, which
 *    is what the snapshot already holds — nothing to do;
 *  - changed only on the task branch: the branch's version (`take`), or the
 *    deletion (`remove`);
 *  - changed on both, differently: a conflict candidate. git merges what it
 *    can in the runtime; the rest is the agent's to reconcile.
 *
 * Trees rather than GitHub's comparison file list, which is capped and folds a
 * rename into one row. A tree maps every path to a blob id, so equality is
 * exact and nothing needs downloading to classify it.
 */

type Trees = Pick<GitHubClient, 'treeEntries'>;
type Blobs = Pick<GitHubClient, 'blob'>;

export interface MergeCommits {
   /** Where the two branches diverged. */
   base: string;
   /** The task branch head. */
   ours: string;
   /** The default branch head. */
   theirs: string;
}

export interface MergeConflict {
   path: string;
   ours: TreeEntry | null;
   base: TreeEntry | null;
   theirs: TreeEntry | null;
}

export interface MergePlan extends MergeCommits {
   take: Array<{ path: string; entry: TreeEntry }>;
   remove: string[];
   conflicts: MergeConflict[];
}

/**
 * What the run's candidate may carry. Everything taken from the branch comes
 * back in the candidate — it is the difference from the default branch — so
 * the plan is held under the delivery limit (7 MiB of base64) with room for
 * the agent's own edits.
 */
const MAX_PLAN_BYTES = 4 * 1024 * 1024;
const MAX_PLAN_FILES = 1500;

/**
 * The merge between a task branch and the default branch, or null when this
 * run should be an ordinary one: the branch is not behind, nothing was changed
 * on both sides (GitHub's own update-branch handles that without an agent), or
 * the merge is one Berry does not attempt — a submodule, or more than a
 * candidate can carry. Null is always safe: the run works on its branch as it
 * always has, and a conflict that remains is a person's to resolve.
 */
export async function findMerge(
   client: Trees & Pick<GitHubClient, 'mergeBase'>,
   input: { owner: string; name: string; branchHead: string; defaultHead: string }
): Promise<MergePlan | null> {
   if (input.branchHead === input.defaultHead) return null;
   const base = await client.mergeBase(input.owner, input.name, input.defaultHead, input.branchHead);
   if (!base || base.behindBy === 0 || base.commit === input.branchHead) return null;
   return planMerge(client, { owner: input.owner, name: input.name, base: base.commit, ours: input.branchHead, theirs: input.defaultHead });
}

/** The same plan from the same three commits, every time: commits do not change. */
export async function planMerge(client: Trees, input: MergeCommits & { owner: string; name: string }): Promise<MergePlan | null> {
   const [base, ours, theirs] = await Promise.all([
      client.treeEntries(input.owner, input.name, input.base),
      client.treeEntries(input.owner, input.name, input.ours),
      client.treeEntries(input.owner, input.name, input.theirs),
   ]);
   const plan: MergePlan = { base: input.base, ours: input.ours, theirs: input.theirs, take: [], remove: [], conflicts: [] };
   let bytes = 0;
   for (const path of [...new Set([...base.keys(), ...ours.keys(), ...theirs.keys()])].sort()) {
      const b = base.get(path) ?? null;
      const o = ours.get(path) ?? null;
      const t = theirs.get(path) ?? null;
      if (same(o, t) || same(o, b)) continue;
      if (!safePath(path) || [b, o, t].some((entry) => entry !== null && entry.type !== 'blob')) return null;
      if (same(t, b)) {
         if (o) plan.take.push({ path, entry: o });
         else plan.remove.push(path);
         bytes += o?.size ?? 0;
         continue;
      }
      plan.conflicts.push({ path, ours: o, base: b, theirs: t });
      bytes += Math.max(o?.size ?? 0, t?.size ?? 0) + (b?.size ?? 0);
   }
   if (plan.conflicts.length === 0) return null;
   if (bytes > MAX_PLAN_BYTES || plan.take.length + plan.remove.length + plan.conflicts.length > MAX_PLAN_FILES) return null;
   return plan;
}

function same(left: TreeEntry | null, right: TreeEntry | null): boolean {
   if (left === null || right === null) return left === right;
   return left.sha === right.sha && left.mode === right.mode;
}

/**
 * A path that is safe to hand to `tar` and a shell in the runtime. git already
 * refuses these in a tree; this is the control plane not relying on that.
 */
function safePath(path: string): boolean {
   if (path.startsWith('/') || path.includes('\\') || path.includes('\0') || path.includes('\n')) return false;
   const parts = path.split('/');
   if (parts[0] === MERGE_DIRECTORY) return false;
   return parts.every((part) => part !== '' && part !== '.' && part !== '..' && part.toLowerCase() !== '.git');
}


/**
 * The overlay, as an archive the runtime unpacks over the default branch
 * snapshot: every file the branch alone changed at its own path, and for each
 * conflict candidate this task's version and the common ancestor under the
 * reserved directory, beside the manifest that says what to do with them. The
 * default branch's version of a conflict candidate is already in place.
 */
export async function mergeArchive(client: Blobs, input: { owner: string; name: string; plan: MergePlan; at: Date }): Promise<Buffer> {
   const wanted: Array<{ path: string; entry: TreeEntry }> = [...input.plan.take];
   for (const conflict of input.plan.conflicts) {
      if (conflict.ours) wanted.push({ path: `${MERGE_DIRECTORY}/ours/${conflict.path}`, entry: asFile(conflict.ours) });
      if (conflict.base) wanted.push({ path: `${MERGE_DIRECTORY}/base/${conflict.path}`, entry: asFile(conflict.base) });
   }
   const manifest: MergeManifest = {
      remove: input.plan.remove,
      conflicts: input.plan.conflicts.map((conflict) => ({
         path: conflict.path,
         ours: conflict.ours !== null,
         base: conflict.base !== null,
         theirs: conflict.theirs !== null,
         mergeable: [conflict.ours, conflict.base, conflict.theirs].every((entry) => entry === null || entry.mode !== '120000'),
      })),
   };
   // The manifest first, so the runtime can pull it out alone before anything
   // is unpacked over the checkout.
   const entries: TarEntry[] = [{ path: MERGE_MANIFEST_PATH, mode: 0o644, content: Buffer.from(JSON.stringify(manifest), 'utf8') }];
   // Bounded waves, as publication does: independent reads, provider headroom kept.
   const concurrency = 8;
   for (let from = 0; from < wanted.length; from += concurrency) {
      const wave = await Promise.all(
         wanted.slice(from, from + concurrency).map(async ({ path, entry }) => ({
            path,
            mode: entry.mode === '100755' ? 0o755 : 0o644,
            content: await client.blob(input.owner, input.name, entry.sha),
            link: entry.mode === '120000',
         }))
      );
      entries.push(...wave);
   }
   return tarGz(entries, input.at);
}

/** A reference copy is always a plain file, so a link's target can be read rather than followed. */
function asFile(entry: TreeEntry): TreeEntry {
   return entry.mode === '120000' ? { ...entry, mode: '100644' } : entry;
}

/**
 * The part of the run's instructions that says a merge is waiting.
 *
 * Built by the control plane because only it knows the merge exists; the
 * runtime's status file then says how each file actually came out.
 */
export function mergePrompt(input: { baseBranch: string; branch: string; conflicts: readonly string[] }): string {
   const listed = input.conflicts.slice(0, 50).map((path) => `- ${path}`);
   if (input.conflicts.length > listed.length) listed.push(`- … and ${input.conflicts.length - listed.length} more, all listed in ${MERGE_DIRECTORY}/STATUS.md`);
   return [
      `Merging ${input.baseBranch} into this task`,
      `${input.baseBranch} has moved since this task's branch (${input.branch}) was cut, and both changed the same files, so the ` +
         'pull request cannot be merged until they are reconciled. That is part of this run.',
      `Your checkout is the current ${input.baseBranch} with this task's changes already laid over it. Files only one side ` +
         'changed are settled. These files were changed on both sides:',
      listed.join('\n'),
      `Read ${MERGE_DIRECTORY}/STATUS.md first: it says which of them git merged cleanly and which still need you. A file ` +
         `that needs you holds conflict markers (\`<<<<<<< berry: this task\` … \`=======\` … \`>>>>>>> ${input.baseBranch}\`). ` +
         `This task's whole version of each is under ${MERGE_DIRECTORY}/ours/, the common ancestor under ${MERGE_DIRECTORY}/base/, ` +
         `and ${input.baseBranch}'s version is what the file held before the markers.`,
      `Reconcile each one so that both sides' intent survives: keep what this task added and keep what ${input.baseBranch} ` +
         'added. Remove nothing the other task contributed, and do not settle a conflict by discarding one side. Leave no ' +
         'conflict marker behind — Berry refuses a delivery that still has one — then run the checks.',
      `${MERGE_DIRECTORY}/ is working material: it is never delivered, so do not move your work into it.`,
   ].join('\n\n');
}
