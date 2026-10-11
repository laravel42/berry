/**
 * The note Berry attaches to a task when an agent run finishes.
 *
 * Every finished agent task gets one, and a later task that waits on it
 * reads this instead of scanning the files that run produced. The first
 * line is how the next prompt finds it.
 */

export function handoffDocument(input: {
   identifier: string;
   title: string;
   summary: string;
   files?: string[];
   repository?: string | null;
   branch?: string | null;
   commit?: string | null;
   pullRequest?: number | null;
}): string {
   const lines = ['HANDOFF.md', '', `# Handoff from ${input.identifier}`, '', input.title.trim(), '', input.summary.trim()];
   const files = (input.files ?? []).filter((file) => file.trim() !== '');
   if (files.length > 0) {
      lines.push('', '## Files', ...files.map((file) => `- ${file}`));
   }
   const where = [
      input.repository ? `Repository: ${input.repository}` : null,
      input.branch ? `Branch: ${input.branch}` : null,
      input.commit ? `Commit: ${input.commit}` : null,
      input.pullRequest != null ? `Pull request: ${input.pullRequest}` : null,
   ].filter((line): line is string => line !== null);
   if (where.length > 0) lines.push('', ...where);
   return `${lines.join('\n')}\n`;
}

/** The file a run commits so the review's branch has the handoff on it. */
export function handoffCandidate(document: string): { path: 'HANDOFF.md'; mode: '100644'; content: string } {
   return { path: 'HANDOFF.md', mode: '100644', content: Buffer.from(document, 'utf8').toString('base64') };
}

/**
 * Puts HANDOFF.md among the files this run will commit.
 *
 * A copy already in the candidate is replaced. A candidate that is already
 * at the delivery limit stays as it is.
 */
export function withHandoffFile<T extends { path: string }>(
   files: T[],
   document: string
): Array<T | ReturnType<typeof handoffCandidate>> {
   const rest = files.filter((file) => file.path !== 'HANDOFF.md');
   if (rest.length >= 2000) return files;
   return [...rest, handoffCandidate(document)];
}
