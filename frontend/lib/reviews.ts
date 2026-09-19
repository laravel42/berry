import { z } from 'zod';
import { apiFetch, apiText } from './api';
import { createIssueComment } from './comments';
import { patchBoardIssue } from './issues';
import type { FileDiff } from '@/data/reviews';

/**
 * The human review gate, as the API serves it.
 *
 * A review is a task in review together with the run that delivered it: the
 * pull request, the author's account, the checks, and any peer verdict. A
 * decision is the task changing status — approve is done, send back is todo —
 * through the same route the board uses, plus a comment when there is a note.
 */

export const reviewVerdictSchema = z.object({
   id: z.string(),
   reviewer: z.string(),
   approved: z.boolean().nullable(),
   reason: z.string(),
   attempt: z.number(),
   decidedAt: z.string().nullable(),
});

export const reviewItemSchema = z.object({
   id: z.string(),
   issue: z.object({
      id: z.string(),
      identifier: z.string(),
      title: z.string(),
      status: z.string(),
      autoGate: z.boolean(),
   }),
   author: z.object({ id: z.string(), name: z.string() }).nullable(),
   run: z.object({
      id: z.string(),
      summary: z.string().nullable(),
      completedAt: z.string().nullable(),
   }),
   repository: z.string().nullable(),
   pullRequest: z
      .object({
         number: z.number(),
         url: z.string().nullable(),
         branch: z.string().nullable(),
         headCommit: z.string().nullable(),
      })
      .nullable(),
   delivery: z.object({
      committed: z.boolean(),
      filesChanged: z.number(),
      insertions: z.number(),
      deletions: z.number(),
      files: z.array(z.string()).default([]),
      /** Files the run produced and attached, whether or not it committed. */
      producedFiles: z.number().default(0),
   }),
   checks: z
      .object({
         passed: z.boolean(),
         complete: z.boolean(),
         results: z
            .array(
               z.object({
                  command: z.string(),
                  exitCode: z.number().nullable(),
                  passed: z.boolean(),
               })
            )
            .default([]),
      })
      .nullable(),
   verdicts: z.array(reviewVerdictSchema).default([]),
   updatedAt: z.string(),
});

export type ReviewItem = z.infer<typeof reviewItemSchema>;
export type ReviewVerdict = z.infer<typeof reviewVerdictSchema>;
export type ReviewQueueState = 'open' | 'completed';

export async function loadReviews(
   workspaceId: string,
   state: ReviewQueueState
): Promise<ReviewItem[]> {
   const params = new URLSearchParams({ workspaceId, state });
   const json: unknown = await apiFetch(`/api/v1/reviews?${params.toString()}`);
   const parsed = z.object({ nodes: z.array(reviewItemSchema) }).safeParse(json);
   return parsed.success ? parsed.data.nodes : [];
}

/** The pull request's unified diff, as text. */
/**
 * A run's diff, fetched once. The review preloads it when an item is
 * selected, so opening the Diff tab finds it loaded or already on its way; a
 * failed fetch is forgotten, so the tab's own attempt tries again. A run's
 * diff does not change once the run has ended, and a handful are kept.
 */
const diffs = new Map<string, Promise<string>>();
const DIFFS_KEPT = 20;

export function loadReviewDiff(runId: string): Promise<string> {
   const held = diffs.get(runId);
   if (held) return held;
   const pending = apiText(`/api/v1/reviews/${encodeURIComponent(runId)}/diff`);
   diffs.set(runId, pending);
   pending.catch(() => diffs.delete(runId));
   while (diffs.size > DIFFS_KEPT) diffs.delete(diffs.keys().next().value as string);
   return pending;
}

/** Starts fetching a run's diff ahead of the Diff tab. */
export function preloadReviewDiff(runId: string): void {
   void loadReviewDiff(runId).catch(() => undefined);
}

/**
 * The run ended with nothing to decide on: no commit and no pull request.
 * Such a task needs help rather than a verdict, and the queue, the detail
 * pane and the task page all read it that way.
 */
export function stoppedWithoutDelivering(
   item: Pick<ReviewItem, 'delivery' | 'pullRequest'>
): boolean {
   // A design task delivers files without a commit; only a run that left
   // nothing at all behind stopped without delivering.
   return !item.delivery.committed && !item.pullRequest && item.delivery.producedFiles === 0;
}

export type ReviewDecision = 'approve' | 'send-back';

/**
 * Approve merges the run's pull request and then moves the task to done; send
 * back moves it to todo. A note becomes a comment before the status changes —
 * the order a person reading the timeline expects.
 *
 * The merge goes first: a task marked done over an unmerged pull request is
 * the board saying shipped while main does not have it, which is how every
 * approved task used to end. When GitHub refuses (a conflict, a required
 * check), this throws with its reason and nothing else happens.
 */
export async function decideReview(
   item: ReviewItem,
   decision: ReviewDecision,
   note: string
): Promise<void> {
   if (decision === 'approve' && item.pullRequest) await mergeReviewPullRequest(item.run.id);
   const trimmed = note.trim();
   if (trimmed !== '') {
      await createIssueComment(
         item.issue.identifier,
         `${decision === 'approve' ? '**Review: approved.**' : '**Review: sent back.**'}\n\n${trimmed}`
      );
   }
   await patchBoardIssue(item.issue.identifier, {
      status: decision === 'approve' ? 'done' : 'todo',
   });
}

/** Merges the pull request a run opened. Already merged counts as merged. */
export async function mergeReviewPullRequest(runId: string): Promise<void> {
   await apiFetch(`/api/v1/reviews/${encodeURIComponent(runId)}/merge`, {
      method: 'POST',
      body: '{}',
   });
}

/** A relative time short enough for a list row. */
export function reviewTimeAgo(iso: string | null): string {
   if (!iso) return '';
   const ms = Date.now() - new Date(iso).getTime();
   const minutes = Math.round(ms / 60_000);
   if (minutes < 1) return 'now';
   if (minutes < 60) return `${minutes}m`;
   const hours = Math.round(minutes / 60);
   if (hours < 24) return `${hours}h`;
   return `${Math.round(hours / 24)}d`;
}

/**
 * A unified diff, split per file for the renderer.
 *
 * Only what the view needs: added and removed lines, context with new-file
 * numbers, and hunk boundaries collapsed into a "skipped" row. Binary files
 * and renames without content appear as an empty file entry.
 */
export function parseUnifiedDiff(text: string): FileDiff[] {
   const files: FileDiff[] = [];
   let current: FileDiff | null = null;
   let newLine = 0;
   let lastNewLine = 0;

   for (const raw of text.split('\n')) {
      if (raw.startsWith('diff --git ')) {
         const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(raw);
         const path = match?.[2] ?? raw.slice('diff --git '.length);
         const slash = path.lastIndexOf('/');
         current = {
            name: slash === -1 ? path : path.slice(slash + 1),
            path: slash === -1 ? '' : path.slice(0, slash),
            additions: 0,
            deletions: 0,
            lines: [],
         };
         files.push(current);
         newLine = 0;
         lastNewLine = 0;
         continue;
      }
      if (!current) continue;
      if (raw.startsWith('@@')) {
         const match = /\+(\d+)(?:,(\d+))?/.exec(raw);
         newLine = match ? Number(match[1]) : newLine;
         if (lastNewLine > 0 && newLine > lastNewLine + 1) {
            current.lines.push({ type: 'skip', count: newLine - lastNewLine - 1 });
         }
         continue;
      }
      if (
         raw.startsWith('+++') ||
         raw.startsWith('---') ||
         raw.startsWith('index ') ||
         raw.startsWith('new file') ||
         raw.startsWith('deleted file') ||
         raw.startsWith('similarity') ||
         raw.startsWith('rename ') ||
         raw.startsWith('Binary files') ||
         raw.startsWith('\\ No newline')
      ) {
         continue;
      }
      if (raw.startsWith('+')) {
         current.additions += 1;
         current.lines.push({ type: 'add', number: newLine, text: raw.slice(1) });
         lastNewLine = newLine;
         newLine += 1;
      } else if (raw.startsWith('-')) {
         current.deletions += 1;
         current.lines.push({ type: 'del', text: raw.slice(1) });
      } else if (raw.startsWith(' ') || raw === '') {
         if (raw === '' && current.lines.length === 0) continue;
         current.lines.push({ type: 'context', number: newLine, text: raw.slice(1) });
         lastNewLine = newLine;
         newLine += 1;
      }
   }
   return files;
}

/** One file of the repository at the commit under review. `sha` is how its content is asked for. */
export interface RepositoryFile {
   path: string;
   sha: string;
   size: number;
}

export interface RepositoryTree {
   repository: string;
   branch: string | null;
   commit: string;
   files: RepositoryFile[];
   /** What the pull request does to each path it touches. A deleted file is listed in `files` too, as it last was. */
   changes: Array<{ path: string; status: FileChange }>;
}

/** What a pull request does to a file. A rename is the new path, modified. */
export type FileChange = 'added' | 'modified' | 'deleted';

/** Kept per run, like the diff: a reviewer goes back and forth between tabs. */
const trees = new Map<string, Promise<RepositoryTree>>();

/** Every file of the repository as the review's branch has it. */
export function loadRepositoryTree(runId: string): Promise<RepositoryTree> {
   const held = trees.get(runId);
   if (held) return held;
   const pending = apiFetch<RepositoryTree>(`/api/v1/reviews/${encodeURIComponent(runId)}/tree`);
   trees.set(runId, pending);
   pending.catch(() => trees.delete(runId));
   while (trees.size > DIFFS_KEPT) trees.delete(trees.keys().next().value as string);
   return pending;
}

/** Drops the kept tree, so the next read asks GitHub again: the explorer's Refresh. */
export function forgetRepositoryTree(runId: string): void {
   trees.delete(runId);
}

/** A file's text. A blob id names exactly one content, so it is asked for once. */
const blobs = new Map<string, Promise<string>>();

export function loadRepositoryFile(runId: string, sha: string): Promise<string> {
   const held = blobs.get(sha);
   if (held) return held;
   const pending = apiText(
      `/api/v1/reviews/${encodeURIComponent(runId)}/blob/${encodeURIComponent(sha)}`
   );
   blobs.set(sha, pending);
   pending.catch(() => blobs.delete(sha));
   while (blobs.size > 60) blobs.delete(blobs.keys().next().value as string);
   return pending;
}

/**
 * Commits one edited file to the review's branch. `sha` is the blob that was
 * edited: if the file on the branch is no longer that one, the server refuses
 * and says so. The tree is forgotten afterwards, since the file has a new blob.
 */
export async function commitReviewFile(
   runId: string,
   /** `sha` is the blob that was opened; null creates the file, and is refused when the path exists. */
   input: { path: string; content: string; sha: string | null; message: string }
): Promise<{ commit: string; sha: string; branch: string }> {
   const committed = await apiFetch<{ commit: string; sha: string; branch: string }>(
      `/api/v1/reviews/${encodeURIComponent(runId)}/commit`,
      { method: 'POST', body: JSON.stringify(input) }
   );
   trees.delete(runId);
   diffs.delete(runId);
   return committed;
}
