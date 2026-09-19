'use client';

import { IssueArtifacts } from '@/components/common/issues/details/issue-artifacts';
import type { RunArtifact } from '@/lib/attachments';
import { commitReviewFile, loadRepositoryTree, type FileChange } from '@/lib/reviews';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

/**
 * The repository as the review's branch has it — every file, with what the
 * pull request does to each marked — in the same tree and the same viewer that
 * show a task's saved files, behaving exactly as they do there.
 *
 * A diff shows what moved and nothing around it; a reviewer deciding whether a
 * new route is registered, or what the migration before this one did, needs
 * the rest of the tree at that commit. There is one file browser in Berry, so
 * the repository's files are handed to it as the records it already reads.
 */
export function RepositoryFiles({ issueRef, runId }: { issueRef: string; runId: string }) {
   const t = useTranslations('reviews.repositoryFiles');
   const [changes, setChanges] = useState<ReadonlyMap<string, FileChange>>(new Map());
   const [error, setError] = useState<string | null>(null);
   // Bumped by a commit: the file has a new blob and the pull request a new change, so the tree is read again.
   const [version, setVersion] = useState(0);

   useEffect(() => {
      let cancelled = false;
      setError(null);
      loadRepositoryTree(runId)
         .then(
            (tree) =>
               !cancelled &&
               setChanges(new Map(tree.changes.map((change) => [change.path, change.status])))
         )
         .catch(
            (cause: unknown) =>
               !cancelled && setError(cause instanceof Error ? cause.message : t('failed'))
         );
      return () => {
         cancelled = true;
      };
   }, [runId, t, version]);

   // The repository's files as the records the file browser reads. Each is
   // fetched from the review's own file route, by the blob id the tree gave.
   const load = useCallback(async (): Promise<RunArtifact[]> => {
      const tree = await loadRepositoryTree(runId);
      return tree.files.map((file) => {
         const slash = file.path.lastIndexOf('/');
         return {
            id: `${file.sha}:${file.path}`,
            path: file.path,
            name: file.path.slice(slash + 1),
            directory: slash === -1 ? '' : file.path.slice(0, slash),
            contentType: 'text/plain',
            sizeBytes: file.size,
            runId,
            agentName: '',
            downloadUrl: `/api/v1/reviews/${encodeURIComponent(runId)}/blob/${encodeURIComponent(file.sha)}`,
            createdAt: '',
         };
      });
      // `version` is what makes a commit read the tree again.
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [runId, version]);

   // A reviewer's own edit, as a commit on the branch under review. The record's
   // id starts with the blob that was opened, which is what makes the write safe.
   const commit = useCallback(
      async (artifact: RunArtifact, content: string, message: string) => {
         if (changes.get(artifact.path) === 'deleted') throw new Error(t('commitDeleted'));
         await commitReviewFile(runId, {
            path: artifact.path,
            content,
            sha: artifact.id.split(':')[0]!,
            message,
         });
         setVersion((current) => current + 1);
      },
      [runId, changes, t]
   );

   if (error) {
      return (
         <p className="text-status-danger" role="alert">
            {error}
         </p>
      );
   }
   return (
      <IssueArtifacts
         issueRef={issueRef}
         heading={null}
         defaultOpen
         className="h-full min-h-0 flex-1"
         load={load}
         marked={changes}
         commit={commit}
      />
   );
}
