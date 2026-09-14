'use client';

import type { Issue } from '@/data/issues';
import { patchBoardIssue } from '@/lib/issues';
import { useIssuesStore } from '@/store/issues-store';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

/**
 * The task's title, edited where it is read.
 *
 * Click the title to change it. Saving on blur as well as on Enter, because
 * someone who has retyped a title and then clicked away has finished editing
 * whatever their keyboard says.
 */
export function IssueTitle({ issue }: { issue: Issue }) {
   const t = useTranslations('issueDetail.title');
   const updateIssue = useIssuesStore((state) => state.updateIssue);
   const [editing, setEditing] = useState(false);
   const [draft, setDraft] = useState(issue.title);
   const field = useRef<HTMLTextAreaElement>(null);

   useEffect(() => {
      if (!editing) setDraft(issue.title);
   }, [issue.title, editing]);

   useEffect(() => {
      if (!editing) return;
      const element = field.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(element.value.length, element.value.length);
      element.style.height = '0px';
      element.style.height = `${element.scrollHeight}px`;
   }, [editing, draft]);

   const commit = () => {
      const title = draft.trim();
      setEditing(false);
      if (!title) {
         setDraft(issue.title);
         toast.error(t('empty'));
         return;
      }
      if (title === issue.title) return;
      const previous = issue.title;
      updateIssue(issue.id, { title });
      void patchBoardIssue(issue.id, { title }).catch(() => {
         updateIssue(issue.id, { title: previous });
         setDraft(previous);
         toast.error(t('failed'));
      });
   };

   if (!editing) {
      return (
         <h1
            data-heading="display"
            className="min-w-0 text-balance font-display tracking-[-0.025em]"
         >
            <button
               type="button"
               className="w-full cursor-text rounded-sm text-left outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
               aria-label={t('edit')}
               onClick={() => setEditing(true)}
            >
               {issue.title}
            </button>
         </h1>
      );
   }

   return (
      <textarea
         ref={field}
         value={draft}
         aria-label={t('edit')}
         data-heading="display"
         rows={1}
         className="field-sizing-content w-full resize-none overflow-hidden text-balance bg-transparent font-display tracking-[-0.025em] outline-none"
         onChange={(event) => setDraft(event.target.value)}
         onBlur={commit}
         onKeyDown={(event) => {
            if (event.key === 'Enter') {
               event.preventDefault();
               commit();
            }
            if (event.key === 'Escape') {
               event.preventDefault();
               setDraft(issue.title);
               setEditing(false);
            }
         }}
      />
   );
}
