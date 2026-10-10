'use client';

import { MarkdownFile } from '@/components/common/markdown-file';
import type { ApiComment } from '@/lib/comments';
import { useTranslations } from 'next-intl';

/**
 * HANDOFF.md on the task, as a file.
 *
 * The handoff is posted as a comment so the next run can read it without
 * object storage. On the task it belongs with the attachments, opened as
 * the document, rather than as another message in the activity.
 */
export function isHandoffComment(comment: ApiComment): boolean {
   return (comment.parentId ?? null) === null && comment.body.startsWith('HANDOFF.md');
}

export function IssueAttachments({ comments }: { comments: ApiComment[] }) {
   const t = useTranslations('issueDetail.attachments');
   const handoff = comments.filter(isHandoffComment).at(-1);
   if (!handoff) return null;
   const markdown = handoff.body.replace(/^HANDOFF\.md\n?/, '').trim();
   return (
      <section className="flex flex-col gap-2">
         <h2 data-heading="label" className="text-muted-foreground">
            {t('title')}
         </h2>
         <MarkdownFile
            fileName="HANDOFF.md"
            markdown={markdown}
            label="HANDOFF.md"
            testId="task-handoff"
         />
      </section>
   );
}
