/**
 * The note Berry attaches to a task when an agent run finishes.
 *
 * Every finished agent task gets one, stored under `.handoffs` at the
 * repository root. A later task that waits on it reads that file instead
 * of scanning the files the run produced. The first line is the path.
 * The run posts one comment, its report; this file is the note beside it.
 */

const SLUG_MAX = 80;

/** A title turned into a filename piece: lower case, hyphens, no punctuation. */
export function handoffSlug(title: string): string {
   const slug = title
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, SLUG_MAX)
      .replace(/-+$/g, '');
   return slug === '' ? 'task' : slug;
}

/** `.handoffs/<identifier> - <slug of the title>`, from the repository root. */
export function handoffPath(identifier: string, title: string): string {
   const key = identifier.trim().replace(/[^A-Za-z0-9-]/g, '');
   return `.handoffs/${key} - ${handoffSlug(title)}`;
}

/** A run's handoff, or the old root file that used to be one. */
export function isHandoffPath(path: string): boolean {
   return path === 'HANDOFF.md' || path === '.handoffs' || path.startsWith('.handoffs/');
}

/** A comment or summary that is already a handoff, including the old root file. */
export function isHandoffDocument(text: string): boolean {
   const first = text.trimStart();
   return first.startsWith('HANDOFF.md') || first.startsWith('.handoffs/');
}

/** Distinct artifact paths that count as produced files — not the handoff. */
export function countProducedFiles(paths: readonly string[]): number {
   return new Set(paths.filter((path) => !isHandoffPath(path))).size;
}

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
   const path = handoffPath(input.identifier, input.title);
   const lines = [path, '', `# Handoff from ${input.identifier}`, '', input.title.trim(), '', input.summary.trim()];
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

/** The path on the first line, when this document is a `.handoffs` file. */
export function handoffFilePath(document: string): string | null {
   const first = document.trimStart().split('\n', 1)[0]?.trim() ?? '';
   if (!first.startsWith('.handoffs/')) return null;
   if (first.includes('..') || first.includes('\\') || first.includes('\0')) return null;
   return first;
}

/** The file a run commits so the review's branch has the handoff on it. */
export function handoffCandidate(document: string): { path: string; mode: '100644'; content: string } | null {
   const path = handoffFilePath(document);
   if (path === null) return null;
   return { path, mode: '100644', content: Buffer.from(document, 'utf8').toString('base64') };
}

/**
 * Puts this task's handoff among the files the run will commit.
 *
 * A root HANDOFF.md, or a copy already at this path, is replaced. A deletion
 * of any other file under `.handoffs/` is left out, so that directory stays.
 * A candidate that is already at the delivery limit stays as it is.
 */
export function withHandoffFile<T extends { path: string }>(
   files: T[],
   document: string
): Array<T | NonNullable<ReturnType<typeof handoffCandidate>>> {
   const candidate = handoffCandidate(document);
   const rest = files.filter((file) => file.path !== 'HANDOFF.md' && file.path !== candidate?.path && !isHandoffDeletion(file));
   if (candidate === null || rest.length >= 2000) return rest.length === files.length ? files : rest;
   return [...rest, candidate];
}

/** A removed `.handoffs` file. The delivery must not publish that removal. */
function isHandoffDeletion(file: { path: string }): boolean {
   if (!file.path.startsWith('.handoffs/')) return false;
   return 'content' in file && (file as { content: unknown }).content === null;
}
