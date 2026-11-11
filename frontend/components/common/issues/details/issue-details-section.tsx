'use client';

import type { Issue } from '@/data/issues';
import { useMembersStore } from '@/store/members-store';
import { format, parseISO } from 'date-fns';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';

/**
 * Who made this task and when.
 *
 * The three dates were parsed off the wire and thrown away, which is the kind
 * of omission nobody notices until they are trying to work out why a task
 * exists.
 */

function when(value: string | undefined): string | null {
   if (!value) return null;
   try {
      return format(parseISO(value), 'd MMM yyyy, HH:mm');
   } catch {
      return null;
   }
}

export function IssueDetailsSection({ issue }: { issue: Issue }) {
   const t = useTranslations('issueDetail.details');
   const { orgId } = useParams<{ orgId: string }>();
   const getMemberById = useMembersStore((state) => state.getMemberById);

   const creator = issue.createdBy ? getMemberById(issue.createdBy.id) : undefined;
   const created = when(issue.createdAt);
   const updated = when(issue.updatedAt);

   return (
      <section aria-label={t('title')}>
         <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
               <span
                  data-heading="label"
                  className="shrink-0 font-semibold text-[var(--shell-text-dim)]"
               >
                  {t('createdBy')}
               </span>
               {/* A member opens their profile; an agent or app that made the
                   task has none, so its name stays plain text. */}
               {creator ? (
                  <Link
                     href={`/${orgId}/members/${creator.id}`}
                     className="min-w-0 truncate underline decoration-dashed decoration-foreground underline-offset-2"
                  >
                     {creator.name}
                  </Link>
               ) : (
                  <span className="min-w-0 truncate">{issue.createdBy?.name ?? t('unknown')}</span>
               )}
            </div>
            {created ? (
               <div className="flex items-center justify-between gap-2">
                  <span
                     data-heading="label"
                     className="shrink-0 font-semibold text-[var(--shell-text-dim)]"
                  >
                     {t('created')}
                  </span>
                  <span className="min-w-0 truncate tabular-nums">{created}</span>
               </div>
            ) : null}
            {updated ? (
               <div className="flex items-center justify-between gap-2">
                  <span
                     data-heading="label"
                     className="shrink-0 font-semibold text-[var(--shell-text-dim)]"
                  >
                     {t('updated')}
                  </span>
                  <span className="min-w-0 truncate tabular-nums">{updated}</span>
               </div>
            ) : null}
         </div>
      </section>
   );
}

export default IssueDetailsSection;
