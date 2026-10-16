'use client';

import { updateWorkspaceGoal, type Goal } from '@/lib/goals';
import { useGoalsStore } from '@/store/goals-store';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

/**
 * The goal's title, edited where it is read, the same way a project title is.
 *
 * Click the title to change it. Saving on blur as well as on Enter, because
 * someone who has retyped a title and then clicked away has finished editing
 * whatever their keyboard says.
 */
export function GoalTitle({ goal, readOnly = false }: { goal: Goal; readOnly?: boolean }) {
   const t = useTranslations('goals.title');
   const upsertGoal = useGoalsStore((state) => state.upsertGoal);
   const [editing, setEditing] = useState(false);
   const [draft, setDraft] = useState(goal.title);
   const field = useRef<HTMLTextAreaElement>(null);

   useEffect(() => {
      if (!editing) setDraft(goal.title);
   }, [goal.title, editing]);

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
         setDraft(goal.title);
         toast.error(t('empty'));
         return;
      }
      if (title === goal.title) return;
      const previous = goal.title;
      upsertGoal({ ...goal, title });
      void updateWorkspaceGoal(goal.id, { title })
         .then((updated) => upsertGoal(updated))
         .catch(() => {
            upsertGoal({ ...goal, title: previous });
            setDraft(previous);
            toast.error(t('failed'));
         });
   };

   if (readOnly || !editing) {
      const heading = (
         <h1 className="min-w-0 text-balance font-display leading-[1.08] tracking-[-0.025em]">
            {readOnly ? (
               goal.title
            ) : (
               <button
                  type="button"
                  className="w-full cursor-text rounded-sm text-left outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  aria-label={t('edit')}
                  onClick={() => setEditing(true)}
               >
                  {goal.title}
               </button>
            )}
         </h1>
      );
      return heading;
   }

   return (
      <textarea
         ref={field}
         value={draft}
         aria-label={t('edit')}
         data-heading="h1"
         rows={1}
         className="field-sizing-content w-full resize-none overflow-hidden text-balance bg-transparent font-display leading-[1.08] tracking-[-0.025em] outline-none"
         onChange={(event) => setDraft(event.target.value)}
         onBlur={commit}
         onKeyDown={(event) => {
            if (event.key === 'Enter') {
               event.preventDefault();
               commit();
            }
            if (event.key === 'Escape') {
               event.preventDefault();
               setDraft(goal.title);
               setEditing(false);
            }
         }}
      />
   );
}
