'use client';

import type { Project } from '@/data/projects';
import { useMembersStore } from '@/store/members-store';
import { format, parseISO } from 'date-fns';
import { useTranslations } from 'next-intl';

function when(value: string | undefined): string | null {
   if (!value) return null;
   try {
      return format(parseISO(value), 'd MMM yyyy, HH:mm');
   } catch {
      return null;
   }
}

/**
 * Who made this project and when — same shape as the task Details block.
 */
export function ProjectDetailsSection({ project }: { project: Project }) {
   const t = useTranslations('projects.details');
   const getMemberById = useMembersStore((state) => state.getMemberById);

   const creator = project.createdById ? getMemberById(project.createdById) : undefined;
   const created = when(project.createdAt);
   const updated = when(project.updatedAt);

   return (
      <div>
         <div className="mb-2 pb-[7px] font-medium uppercase tracking-[0.14em] text-[var(--shell-text-dim)]">
            {t('title').toLowerCase()}
         </div>
         <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
               <span className="shrink-0 text-muted-foreground">{t('createdBy')}</span>
               <span className="min-w-0 truncate">{creator?.name ?? t('unknown')}</span>
            </div>
            {created ? (
               <div className="flex items-center justify-between gap-2">
                  <span className="shrink-0 text-muted-foreground">{t('created')}</span>
                  <span className="min-w-0 truncate tabular-nums">{created}</span>
               </div>
            ) : null}
            {updated ? (
               <div className="flex items-center justify-between gap-2">
                  <span className="shrink-0 text-muted-foreground">{t('updated')}</span>
                  <span className="min-w-0 truncate tabular-nums">{updated}</span>
               </div>
            ) : null}
         </div>
      </div>
   );
}
