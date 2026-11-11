'use client';

import type { Project } from '@/data/projects';
import { useMembersStore } from '@/store/members-store';
import { format, parseISO } from 'date-fns';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';

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
   const { orgId } = useParams<{ orgId: string }>();
   const getMemberById = useMembersStore((state) => state.getMemberById);

   const creator = project.createdById ? getMemberById(project.createdById) : undefined;
   const created = when(project.createdAt);
   const updated = when(project.updatedAt);

   return (
      <section aria-label={t('title')}>
         <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
               <span data-heading="label" className="shrink-0 text-[var(--shell-text-dim)]">
                  {t('createdBy')}
               </span>
               {creator ? (
                  <Link
                     href={`/${orgId}/members/${creator.id}`}
                     className="min-w-0 truncate underline decoration-dashed decoration-foreground underline-offset-2"
                  >
                     {creator.name}
                  </Link>
               ) : (
                  <span className="min-w-0 truncate">{t('unknown')}</span>
               )}
            </div>
            {created ? (
               <div className="flex items-center justify-between gap-2">
                  <span data-heading="label" className="shrink-0 text-[var(--shell-text-dim)]">
                     {t('created')}
                  </span>
                  <span className="min-w-0 truncate tabular-nums">{created}</span>
               </div>
            ) : null}
            {updated ? (
               <div className="flex items-center justify-between gap-2">
                  <span data-heading="label" className="shrink-0 text-[var(--shell-text-dim)]">
                     {t('updated')}
                  </span>
                  <span className="min-w-0 truncate tabular-nums">{updated}</span>
               </div>
            ) : null}
         </div>
      </section>
   );
}
