'use client';

import { BerryMark } from '@/components/brand/berry-mark';
import { AgentMarkdown } from '@/components/common/agent-markdown';
import { Badge } from '@/components/ui/badge';
import { reviewTimeAgo, stoppedWithoutDelivering, type ReviewItem } from '@/lib/reviews';
import { cn } from '@/lib/utils';
import { Check, GitPullRequest, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ReviewDecisionBar, type ReviewOutcome } from './review-decision-bar';
import { DiffStat, PR_STATUS_TONE } from './review-shared';
import { reviewStatusOf } from './reviews';

function Section({
   title,
   children,
   className,
}: {
   title: string;
   children: ReactNode;
   className?: string;
}) {
   return (
      <section className={cn('flex flex-col gap-2', className)}>
         <h3>{title}</h3>
         {children}
      </section>
   );
}

/** One row of the facts block: a label badge in the margin, the fact beside it. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
   return (
      <div className="contents">
         <dt>
            <Badge
               variant="secondary"
               className="overflow-hidden border-status-neutral/40 bg-status-neutral/10 px-1.5 py-0 font-normal text-status-neutral"
            >
               {label}
            </Badge>
         </dt>
         <dd className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">{children}</dd>
      </div>
   );
}

/**
 * A pull request link: icon and branch — one clickable row.
 */
function PullRequestFact({
   item,
}: {
   item: ReviewItem & { pullRequest: NonNullable<ReviewItem['pullRequest']> };
}) {
   const pr = item.pullRequest;
   const title = pr.branch ?? item.issue.title;

   const body = (
      <span className="inline-flex min-w-0 items-start gap-2">
         <GitPullRequest className="mt-0.5 size-4 shrink-0 text-status-info" aria-hidden />
         <span className={cn('min-w-0 break-all', pr.branch && 'font-mono')}>{title}</span>
      </span>
   );

   if (pr.url) {
      return (
         <a
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-w-0 max-w-full underline-offset-2 hover:underline"
            title={`#${pr.number}`}
         >
            {body}
         </a>
      );
   }
   return body;
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
 * the checks said. Then the agent's own account, folded after a screen.
 * Produced files live on the Files tab. While the task waits at the gate, the
 * decision buttons sit on the outcome line — Approve and Reject beside the
 * delivery sentence, not below the facts.
 */
export function ReviewOverview({
   item,
   onOpenFiles,
   onDecided,
}: {
   item: ReviewItem;
   /** Opens the Files tab when the Produced fact is clicked. */
   onOpenFiles?: () => void;
   onDecided?: (outcome: ReviewOutcome) => void | Promise<void>;
}) {
   const t = useTranslations('reviews');
   const stopped = stoppedWithoutDelivering(item);
   const waiting = item.issue.status === 'in_review';
   const agent = item.author?.name ?? t('facts.noAuthor');
   const name = (chunks: ReactNode) => <span className="text-actor-agent">{chunks}</span>;
   const prTone = PR_STATUS_TONE[reviewStatusOf(item)];
   const pr = (chunks: ReactNode) =>
      item.pullRequest?.url ? (
         <a
            href={item.pullRequest.url}
            target="_blank"
            rel="noreferrer"
            className={cn(prTone, 'underline-offset-2 hover:underline')}
         >
            {chunks}
         </a>
      ) : (
         <span className={prTone}>{chunks}</span>
      );
   const outcome = stopped
      ? t.rich('delivery.stopped', { agent, name })
      : item.pullRequest
        ? t.rich('delivery.pullRequest', {
             agent,
             number: item.pullRequest.number,
             name,
             pr,
          })
        : item.delivery.committed
          ? t.rich('delivery.committed', { agent, name })
          : t.rich('delivery.produced', {
               agent,
               count: item.delivery.producedFiles,
               name,
            });

   const producedCount = item.delivery.producedFiles;
   const checks = item.checks;
   const checkResults = checks?.results ?? [];
   const failedChecks = checkResults.filter((result) => !result.passed).length;

   return (
      <div className="h-full overflow-y-auto">
         <div className="flex w-full flex-col gap-8 px-6 py-6">
            <div className="-mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
               <p className="flex min-w-0 flex-1 items-start gap-2">
                  <BerryMark
                     size="sm"
                     tone={stopped ? 'attention' : 'complete'}
                     className="mt-0.5 shrink-0"
                  />
                  <span className="min-w-0">{outcome}</span>
               </p>
               {waiting ? (
                  <ReviewDecisionBar key={item.id} item={item} onDecided={onDecided} />
               ) : null}
            </div>
            <dl className="grid w-full grid-cols-[max-content_minmax(0,1fr)] gap-x-8 gap-y-1.5">
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
                     <PullRequestFact item={{ ...item, pullRequest: item.pullRequest }} />
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
                  {producedCount > 0 && onOpenFiles ? (
                     <button
                        type="button"
                        onClick={onOpenFiles}
                        className="cursor-pointer underline-offset-2 hover:underline"
                     >
                        {t('facts.producedFiles', { count: producedCount })}
                     </button>
                  ) : producedCount > 0 ? (
                     <span>{t('facts.producedFiles', { count: producedCount })}</span>
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

            <Section title={t('summary.title')} className="-mt-4">
               <div className="overflow-auto rounded-md border border-border/70 bg-muted/20 p-4 font-mono">
                  {item.run.summary ? (
                     <AgentMarkdown
                        body={withoutLeadingSummaryHeading(item.run.summary)}
                        className="max-w-none text-[12px]"
                     />
                  ) : (
                     <p className="text-muted-foreground">{t('summary.empty')}</p>
                  )}
               </div>
            </Section>

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
         </div>
      </div>
   );
}
