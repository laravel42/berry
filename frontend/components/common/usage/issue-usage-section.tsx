'use client';

import { readableModelName } from '@/components/common/agents/model-name';
import { Section } from '@/components/common/issues/details/panel-section';
import { getIssueUsage, totalTokens } from '@/lib/usage';
import { useSessionStore } from '@/store/session-store';
import { useTranslations } from 'next-intl';

import { useUsage } from './use-usage';

/**
 * Which models worked this task, and how many runs that took.
 *
 * Token counts and spend stay off the task. The summary stays small on
 * purpose: it is context for the task, not the subject of the page.
 */
export function IssueUsageSection({ issueId }: { issueId: string }) {
   const t = useTranslations('issueDetail.usage');
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? null);
   const { data, error } = useUsage(
      workspaceId ? () => getIssueUsage(workspaceId, issueId) : null,
      `${workspaceId}:${issueId}`
   );
   if (error || !data) return null;
   // The models that did the work, the busiest first: under a gateway a task's
   // runs can be served by different models, and a fallback by another.
   const models = data.byModel
      .filter((bucket) => bucket.key !== '')
      .sort((left, right) => totalTokens(right) - totalTokens(left))
      .map((bucket) => ({ id: bucket.key, name: readableModelName(bucket.key) }));
   return (
      <Section title={t('title')}>
         {data.totals.events === 0 ? (
            <p className="text-muted-foreground">{t('none')}</p>
         ) : (
            <div className="flex flex-col gap-0.5">
               {models.length > 0 ? (
                  <div className="flex items-start justify-between gap-3">
                     <span className="shrink-0 text-muted-foreground">
                        {t('model', { count: models.length })}
                     </span>
                     <span className="min-w-0 text-right">
                        {models.map((model) => (
                           <span key={model.id} className="block truncate" title={model.id}>
                              {model.name}
                           </span>
                        ))}
                     </span>
                  </div>
               ) : null}
               <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t('runs')}</span>
                  <span className="tabular-nums">{data.byRun.length}</span>
               </div>
            </div>
         )}
      </Section>
   );
}
