import { rm, writeFile } from 'node:fs/promises';
import { shellQuote } from '../../checkout.ts';
import type { LocalSession } from './local-session.ts';
import {
   MERGE_DIRECTORY,
   MERGE_MANIFEST_PATH,
   MERGE_MARKER_LABEL,
   mergeManifestSchema,
   type MergeManifest,
   type TaskEnvelope,
} from '../../../runtime/envelope.ts';

/**
 * The task branch, laid over a snapshot of the default branch head.
 *
 * A conflict-resolution run has to end in a tree that is the merge of both
 * sides, and the agent holds no credential to fetch either. So the control
 * plane sends the branch's side as an archive (see `runtime/merge-plan.ts` on
 * the server) and this unpacks it over the default branch's files, after the
 * baseline commit: everything the branch contributes then shows up in the
 * candidate as a change from the default branch, which is exactly the tree the
 * merge commit needs, and a file only the default branch changed is reported
 * as nothing at all.
 *
 * Files both sides changed are merged here with `git merge-file`, the same
 * three-way merge `git merge` would run. What merges cleanly is done; what
 * does not is left with conflict markers for the agent, with both whole
 * versions beside it under the reserved directory.
 *
 * Every write into the checkout is made by the session's own user — `tar`, `rm`
 * and `git` through `session.exec` — never by the runtime, which may be root:
 * the tree came from a repository and can hold a link pointing anywhere.
 */

export type MergeOutcome = 'merged' | 'conflict' | 'unmerged';

const ARCHIVE_LIMIT = 32 * 1024 * 1024;

export async function applyMergeOverlay(input: {
   envelope: TaskEnvelope;
   session: LocalSession;
   directory: string;
   fetch: typeof fetch;
   signal?: AbortSignal | undefined;
}): Promise<Array<{ path: string; outcome: MergeOutcome; note: string }>> {
   const { envelope, session, directory } = input;
   const baseBranch = envelope.repo?.baseBranch ?? 'the default branch';
   const timeout = AbortSignal.timeout(120_000);
   const response = await input.fetch(`${envelope.berry.apiUrl.replace(/\/+$/, '')}/api/v1/agent-tools/repository-merge`, {
      headers: { authorization: `Bearer ${envelope.berry.token}` }, redirect: 'error', signal: input.signal ? AbortSignal.any([input.signal, timeout]) : timeout,
   });
   if (!response.ok || !response.body) throw new Error(`Repository merge unavailable (${response.status})`);
   const chunks: Uint8Array[] = [];
   let size = 0;
   for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > ARCHIVE_LIMIT) throw new Error('Repository merge exceeds the 32 MiB overlay limit');
      chunks.push(chunk);
   }
   const archive = `${directory}.merge.tar.gz`;
   await writeFile(archive, Buffer.concat(chunks));
   await session.adopt(archive);
   let manifest: MergeManifest;
   try {
      // Kept out of the candidate before anything lands in it.
      const exclude = await session.exec(`mkdir -p .git/info && printf '/%s/\\n' ${shellQuote(MERGE_DIRECTORY)} >> .git/info/exclude`, { cwd: directory });
      if (exclude.exitCode !== 0) throw new Error('Could not reserve the merge directory');
      // The manifest alone first: what the branch deleted has to go before the
      // rest is unpacked, or a file that became a directory could not land.
      const first = await session.exec(`tar -xzf ${shellQuote(archive)} -C ${shellQuote(directory)} ${shellQuote(MERGE_MANIFEST_PATH)}`, { cwd: directory });
      if (first.exitCode !== 0) throw new Error('Could not read the repository merge');
      manifest = mergeManifestSchema.parse(JSON.parse(await session.readFile(`${directory}/${MERGE_MANIFEST_PATH}`)));
      const reserved = (path: string) => path.split('/')[0] === MERGE_DIRECTORY;
      if (manifest.remove.some(reserved) || manifest.conflicts.some((conflict) => reserved(conflict.path))) {
         throw new Error('Repository merge names a reserved path');
      }
      for (const path of manifest.remove) {
         const removed = await session.exec(`rm -f -- ${shellQuote(path)}`, { cwd: directory });
         if (removed.exitCode !== 0) throw new Error('Could not apply a deletion from the task branch');
      }
      const extract = await session.exec(`tar -xzf ${shellQuote(archive)} -C ${shellQuote(directory)}`, { cwd: directory });
      if (extract.exitCode !== 0) throw new Error('Could not unpack the repository merge');
   } finally { await rm(archive, { force: true }); }

   const results: Array<{ path: string; outcome: MergeOutcome; note: string }> = [];
   const empty = `${MERGE_DIRECTORY}/.empty`;
   const scratch = `${MERGE_DIRECTORY}/.result`;
   for (const conflict of manifest.conflicts) {
      if (!conflict.ours || !conflict.theirs) {
         results.push({
            path: conflict.path,
            outcome: 'unmerged',
            note: conflict.ours
               ? `${baseBranch} deleted this file and this task changed it. It is absent from the checkout; this task's version is ${MERGE_DIRECTORY}/ours/${conflict.path}. Restore it if the task still needs it.`
               : `this task deleted this file and ${baseBranch} changed it. ${baseBranch}'s version is in place. Delete it again only if its new content is not needed.`,
         });
         continue;
      }
      if (!conflict.mergeable) {
         results.push({
            path: conflict.path, outcome: 'unmerged',
            note: `a symbolic link on one side. ${baseBranch}'s version is in place; this task's is ${MERGE_DIRECTORY}/ours/${conflict.path}.`,
         });
         continue;
      }
      const ours = `${MERGE_DIRECTORY}/ours/${conflict.path}`;
      // Added on both sides: there is no ancestor, so every line differs.
      const base = conflict.base ? `${MERGE_DIRECTORY}/base/${conflict.path}` : empty;
      // `merge-file` exits with the number of conflicts, and above 127 for an
      // error (a binary file). The file is replaced only by a real merge.
      const merged = await session.exec(
         `: > ${shellQuote(empty)}; git merge-file -p -L ${shellQuote(MERGE_MARKER_LABEL)} -L ${shellQuote('common ancestor')} -L ${shellQuote(baseBranch)} ` +
            `${shellQuote(ours)} ${shellQuote(base)} ${shellQuote(conflict.path)} > ${shellQuote(scratch)}; code=$?; ` +
            `if [ "$code" -le 127 ]; then cat ${shellQuote(scratch)} > ${shellQuote(conflict.path)}; fi; rm -f ${shellQuote(scratch)} ${shellQuote(empty)}; exit "$code"`,
         { cwd: directory }
      );
      if (merged.exitCode === 0) results.push({ path: conflict.path, outcome: 'merged', note: 'git merged both sides cleanly. Check that the result still makes sense.' });
      else if (merged.exitCode <= 127) {
         results.push({
            path: conflict.path, outcome: 'conflict',
            note: `${merged.exitCode} conflict${merged.exitCode === 1 ? '' : 's'} marked in the file. This task's whole version is ${ours}.`,
         });
      } else {
         results.push({
            path: conflict.path, outcome: 'unmerged',
            note: `git could not merge it (a binary file). ${baseBranch}'s version is in place; this task's is ${ours}. Put the right one at the path.`,
         });
      }
   }
   await session.writeFile(`${directory}/${MERGE_DIRECTORY}/STATUS.md`, statusFile(baseBranch, results));
   return results;
}

function statusFile(baseBranch: string, results: ReadonlyArray<{ path: string; outcome: MergeOutcome; note: string }>): string {
   const needs = results.filter((result) => result.outcome !== 'merged');
   const lines = [
      `# Merging ${baseBranch} into this task`,
      '',
      `This checkout is ${baseBranch} with this task's changes laid over it. Files only one side changed are settled.`,
      'The files below were changed on both sides.',
      '',
      `## Needs you (${needs.length})`,
      '',
      ...(needs.length > 0 ? needs.map((result) => `- \`${result.path}\`: ${result.note}`) : ['Nothing: every file merged cleanly.']),
      '',
      '## Merged cleanly',
      '',
      ...results.filter((result) => result.outcome === 'merged').map((result) => `- \`${result.path}\`: ${result.note}`),
      '',
      `Nothing under ${MERGE_DIRECTORY}/ is delivered. A file that still holds a \`<<<<<<< ${MERGE_MARKER_LABEL}\` marker stops the delivery.`,
      '',
   ];
   return lines.join('\n');
}
