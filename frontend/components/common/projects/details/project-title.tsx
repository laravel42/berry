'use client';

import type { Project } from '@/data/projects';
import { useProjectsStore } from '@/store/projects-store';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

/**
 * The project's title, edited where it is read, the same way a task title is.
 *
 * Click the title to change it. Saving on blur as well as on Enter, because
 * someone who has retyped a title and then clicked away has finished editing
 * whatever their keyboard says.
 */
export function ProjectTitle({ project }: { project: Project }) {
   const t = useTranslations('projects.title');
   const updateProjectName = useProjectsStore((state) => state.updateProjectName);
   const [editing, setEditing] = useState(false);
   const [draft, setDraft] = useState(project.name);
   const field = useRef<HTMLTextAreaElement>(null);

   useEffect(() => {
      if (!editing) setDraft(project.name);
   }, [project.name, editing]);

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
      const name = draft.trim();
      setEditing(false);
      if (!name) {
         setDraft(project.name);
         toast.error(t('empty'));
         return;
      }
      if (name === project.name) return;
      const previous = project.name;
      void updateProjectName(project.id, name).then((saved) => {
         if (saved) return;
         setDraft(previous);
         toast.error(t('failed'));
      });
   };

   if (!editing) {
      return (
         <h1 className="mb-3 min-w-0 text-balance font-display tracking-[-0.025em]">
            <button
               type="button"
               className="w-full cursor-text rounded-sm text-left outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
               aria-label={t('edit')}
               onClick={() => setEditing(true)}
            >
               {project.name}
            </button>
         </h1>
      );
   }

   return (
      <textarea
         ref={field}
         value={draft}
         aria-label={t('edit')}
         data-heading="h1"
         rows={1}
         className="mb-3 field-sizing-content w-full resize-none overflow-hidden text-balance bg-transparent font-display tracking-[-0.025em] outline-none"
         onChange={(event) => setDraft(event.target.value)}
         onBlur={commit}
         onKeyDown={(event) => {
            if (event.key === 'Enter') {
               event.preventDefault();
               commit();
            }
            if (event.key === 'Escape') {
               event.preventDefault();
               setDraft(project.name);
               setEditing(false);
            }
         }}
      />
   );
}
