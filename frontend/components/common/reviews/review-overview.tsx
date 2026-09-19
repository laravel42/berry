'use client';

import { BerryMark } from '@/components/brand/berry-mark';
import { AgentMarkdown } from '@/components/common/agent-markdown';
import { IssueArtifacts } from '@/components/common/issues/details/issue-artifacts';
import type { RunArtifact } from '@/lib/attachments';
import { reviewTimeAgo, stoppedWithoutDelivering, type ReviewItem } from '@/lib/reviews';
import { cn } from '@/lib/utils';
import { Check, FileCode2, GitBranch, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { DiffStat } from './review-shared';

function Section({ title, children }: { title: string; children: ReactNode }) {
   return (
      <section className="flex flex-col gap-2">
         <h3>{title}</h3>
         {children}
      </section>
   );
}

/** One row of the facts block: a label in the margin, the fact beside it. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
   return (
      <div className="contents">
         <dt className="text-muted-foreground">{label}</dt>
         <dd className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">{children}</dd>
      </div>
   );
}

/**
 * A run summary that opens with its own "Summary" heading would print that
 * word twice under the section's heading, so that one line is dropped; any
 * other opening heading is the agent's and stays.
 */
function withoutLeadingSummaryHeading(body: string): string {
   return body.replace(/^\s*#{1,6}\s*summary\s*:?\s*\n+/i, '');
}

function absoluteTime(iso: string): string {
   try {
      return new Date(iso).toLocaleString();
   } catch {
      return iso;
   }
}

/**
 * The evidence a decision is made on, outcome first: did the agent deliver,
 * or did it stop with nothing to show. Then the facts — who ran it and when,
 * whether there is a pull request, what was committed or produced, and what
 * the checks said. Then the agent's own account,
 * folded after a screen, and the files it left behind.
 */
export function ReviewOverview({ item }: { item: ReviewItem }) {
   const t = useTranslations('reviews');
   const { orgId } = useParams<{ orgId: string }>();
   const [artifacts, setArtifacts] = useState<RunArtifact[] | null>(null);
   const stopped = stoppedWithoutDelivering(item);
   const agent = item.author?.name ?? t('facts.noAuthor');
   const outcome = stopped
      ? t('delivery.stopped', { agent })
      : item.pullRequest
        ? t('delivery.pullRequest', { agent, number: item.pullRequest.number })
        : item.delivery.committed
          ? t('delivery.committed', { agent })
          : t('delivery.produced', { agent, count: item.delivery.producedFiles });

   // The produced-files list below fetches this run's files once and hands
   // them up, so the facts block can state the count without a second call.
   // A new item means a new run: forget the previous count until it lands.
   useEffect(() => {
      setArtifacts(null);
   }, [item.run.id]);
   const onArtifactsLoaded = useCallback((loaded: RunArtifact[]) => setArtifacts(loaded), []);

   const producedCount = artifacts?.length ?? 0;
   const checks = item.checks;
   const checkResults = checks?.results ?? [];
   const failedChecks = checkResults.filter((result) => !result.passed).length;
   const clamp = { lines: 12, moreLabel: t('summary.more'), lessLabel: t('summary.less') };

   return (
      <div className="h-full overflow-y-auto">
         <div className="flex w-full max-w-[75ch] flex-col gap-8 px-6 py-6">
            <p className="-mb-4 flex items-start gap-2">
               <BerryMark
                  size="sm"
                  tone={stopped ? 'attention' : 'complete'}
                  className="mt-0.5 shrink-0"
               />
               <span className="min-w-0">{outcome}</span>
            </p>
            <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5">
               <Fact label={stopped ? t('facts.runBy') : t('facts.deliveredBy')}>
                  <span className="text-actor-agent">{agent}</span>
               </Fact>
               {item.run.completedAt && (
                  <Fact label={stopped ? t('facts.stoppedAt') : t('facts.deliveredAt')}>
                     <time
                        dateTime={item.run.completedAt}
                        title={absoluteTime(item.run.completedAt)}
                     >
                        {t('facts.ago', { time: reviewTimeAgo(item.run.completedAt) })}
                     </time>
                  </Fact>
               )}
               <Fact label={t('facts.pullRequest')}>
                  {item.pullRequest ? (
                     <>
                        {item.pullRequest.url ? (
                           <a
                              href={item.pullRequest.url}
                              target="_blank"
                              rel="noreferrer"
                              className="underline-offset-2 hover:underline"
                           >
                              #{item.pullRequest.number}
                           </a>
                        ) : (
                           <span>#{item.pullRequest.number}</span>
                        )}
                        {item.pullRequest.branch && (
                           <span className="inline-flex items-center gap-1 font-mono text-muted-foreground">
                              <GitBranch className="size-3.5" aria-hidden />
                              {item.pullRequest.branch}
                           </span>
                        )}
                     </>
                  ) : (
                     <span className="text-muted-foreground">{t('facts.noPullRequest')}</span>
                  )}
               </Fact>
               <Fact label={t('facts.changes')}>
                  {item.delivery.committed ? (
                     <>
                        <span>
                           {t('facts.filesChanged', { count: item.delivery.filesChanged })}
                        </span>
                        <DiffStat
                           additions={item.delivery.insertions}
                           deletions={item.delivery.deletions}
                        />
                     </>
                  ) : (
                     <span className="text-muted-foreground">{t('facts.nothingCommitted')}</span>
                  )}
               </Fact>
               <Fact label={t('facts.produced')}>
                  {artifacts === null ? (
                     <span className="text-muted-foreground">…</span>
                  ) : producedCount > 0 ? (
                     <a
                        href="#review-produced-files"
                        className="underline-offset-2 hover:underline"
                     >
                        {t('facts.producedFiles', { count: producedCount })}
                     </a>
                  ) : (
                     <span className="text-muted-foreground">{t('facts.noProducedFiles')}</span>
                  )}
               </Fact>
               <Fact label={t('facts.checks')}>
                  {checkResults.length === 0 ? (
                     <span className="text-muted-foreground">{t('facts.checksNone')}</span>
                  ) : failedChecks > 0 ? (
                     <span className="text-status-danger">
                        {t('facts.checksFailed', {
                           failed: failedChecks,
                           total: checkResults.length,
                        })}
                     </span>
                  ) : (
                     <span className="text-status-success">
                        {t('facts.checksPassed', { count: checkResults.length })}
                     </span>
                  )}
                  {checks && !checks.complete && checkResults.length > 0 && (
                     <span className="text-muted-foreground">· {t('facts.checksIncomplete')}</span>
                  )}
               </Fact>
            </dl>

            <Section title={t('summary.title')}>
               {item.run.summary ? (
                  <AgentMarkdown
                     body={withoutLeadingSummaryHeading(item.run.summary)}
                     clamp={clamp}
                  />
               ) : (
                  <p className="text-muted-foreground">{t('summary.empty')}</p>
               )}
            </Section>

            {/* Always mounted: the list is what loads the files, and it renders
                nothing when this run produced none. The heading appears once
                the count is known, so the outline never shows an empty
                section. */}
            <section
               id="review-produced-files"
               className={cn('flex flex-col gap-2', producedCount === 0 && 'hidden')}
            >
               {producedCount > 0 ? <h3>{t('artifacts.title')}</h3> : null}
               <IssueArtifacts
                  issueRef={item.issue.identifier}
                  runId={item.run.id}
                  heading={null}
                  defaultOpen
                  onLoaded={onArtifactsLoaded}
               />
            </section>

            {checkResults.length > 0 && (
               <Section title={t('checks.title')}>
                  <ul className="flex flex-col gap-1">
                     {checkResults.map((result) => (
                        <li key={result.command} className="flex items-center gap-2 font-mono">
                           {result.passed ? (
                              <Check
                                 className="size-3.5 shrink-0 text-status-success"
                                 aria-hidden
                              />
                           ) : (
                              <X className="size-3.5 shrink-0 text-status-danger" aria-hidden />
                           )}
                           <span className="min-w-0 break-all">{result.command}</span>
                           <span className="shrink-0 text-muted-foreground">
                              {result.passed
                                 ? t('checks.passed')
                                 : `${t('checks.failed')} · ${
                                      result.exitCode === null
                                         ? t('checks.noExit')
                                         : t('checks.exit', { code: result.exitCode })
                                   }`}
                           </span>
                        </li>
                     ))}
                     {checks && !checks.complete && (
                        <li className="text-muted-foreground">{t('checks.budgetSpent')}</li>
                     )}
                  </ul>
               </Section>
            )}

            {item.delivery.committed && (
               <Section title={t('changed.title')}>
                  <div className="flex flex-wrap items-center gap-2">
                     <span>{t('facts.filesChanged', { count: item.delivery.filesChanged })}</span>
                     <DiffStat
                        additions={item.delivery.insertions}
                        deletions={item.delivery.deletions}
                     />
                     {item.pullRequest?.url && (
                        <a
                           href={item.pullRequest.url}
                           target="_blank"
                           rel="noreferrer"
                           className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        >
                           {t('detail.pullRequest', { number: item.pullRequest.number })}
                        </a>
                     )}
                  </div>
                  <ul className="flex flex-col gap-1">
                     {item.delivery.files.map((file) => (
                        <li key={file} className="flex items-center gap-1.5 font-mono">
                           <FileCode2
                              className="size-3.5 shrink-0 text-muted-foreground"
                              aria-hidden
                           />
                           <span className="min-w-0 break-all">{file}</span>
                        </li>
                     ))}
                  </ul>
               </Section>
            )}

            <p className="text-muted-foreground">
               <Link
                  href={`/${orgId}/issue/${item.issue.identifier}`}
                  className="underline-offset-2 hover:text-foreground hover:underline"
               >
                  {t('detail.openTask')}
               </Link>
            </p>
         </div>
      </div>
   );
}
