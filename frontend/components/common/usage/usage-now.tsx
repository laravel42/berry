'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useEffect, type ReactNode } from 'react';

import { BerryMark, type BerryMarkState, type BerryMarkTone } from '@/components/brand/berry-mark';
import { Pill } from '@/components/common/plans/plan-sections';
import { status as allStatus, StatusIcon } from '@/data/status';
import { localTimezone } from '@/lib/cron-schedule';
import { formatCost, formatDuration, getDashboard, type UsageQuery } from '@/lib/usage';
import { useSessionStore } from '@/store/session-store';

import { StatTile } from './usage-tiles';
import { useUsage } from './use-usage';

/** The snapshot's API status keys, in workflow order, with the mark each draws. */
const TASK_STATUSES = [
   { key: 'backlog', statusId: 'backlog' },
   { key: 'todo', statusId: 'to-do' },
   { key: 'inProgress', statusId: 'in-progress' },
   { key: 'inReview', statusId: 'in-review' },
   { key: 'blocked', statusId: 'blocked' },
   { key: 'done', statusId: 'done' },
   { key: 'cancelled', statusId: 'cancelled' },
] as const;

/** A run's state as the brand mark draws it everywhere else in Berry. */
const RUN_MARK: Record<
   'running' | 'queued' | 'succeeded' | 'failed' | 'cancelled',
   { tone: BerryMarkTone; state: BerryMarkState; pulse?: boolean }
> = {
   running: { tone: 'working', state: 'solid', pulse: true },
   queued: { tone: 'neutral', state: 'hollow' },
   succeeded: { tone: 'complete', state: 'solid' },
   failed: { tone: 'danger', state: 'solid' },
   cancelled: { tone: 'neutral', state: 'crossed' },
};

const RISK_TONE: Record<string, 'neutral' | 'attention' | 'danger'> = {
   low: 'neutral',
   medium: 'attention',
   high: 'danger',
};

/** Runs starting, finishing or moving, and tasks changing status, all change this view. */
const refreshOnActivity = (type: string) =>
   type === 'usage.recorded' || type.startsWith('run.') || type.startsWith('issue.');

/**
 * A list row: glyph, who or what, then a trailing fact. On a phone the fact
 * drops to its own line, indented under the text, so the title keeps its room.
 */
const ROW = 'flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5';
const ROW_META =
   'flex shrink-0 basis-full items-center gap-2 pl-6 tabular-nums text-muted-foreground sm:ml-auto sm:basis-auto sm:pl-0';

const seconds = (from: string, to: Date | string) =>
   Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000));

/**
 * The Overview tab: what is happening now, whatever the time range. What is
 * running and waiting to run, what just finished, what is waiting on a
 * person, what today has cost so far, and where every task stands. What a
 * window of runs cost is the Spend tab; how they ended is the Runs tab.
 */
export default function UsageNow({
   query,
   onState,
}: {
   /** Only `projectId` applies: everything here is live, not windowed. */
   query: Pick<UsageQuery, 'projectId'>;
   onState?: (state: { lastUpdated: Date | null; loading: boolean; reload: () => void }) => void;
}) {
   const t = useTranslations('areas.usage.overview');
   const format = useFormatter();
   // Elapsed times keep moving between refreshes.
   const now = useNow({ updateInterval: 30_000 });
   const { orgId } = useParams<{ orgId: string }>();
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? null);
   const projectId = query.projectId ?? null;

   const { data, error, loading, lastUpdated, reload } = useUsage(
      // One day in the viewer's zone: that is what "today" means, and the live
      // lists ignore the window.
      workspaceId
         ? () => getDashboard(workspaceId, { days: 1, timezone: localTimezone(), projectId })
         : null,
      `now:${workspaceId}:${projectId ?? ''}`,
      refreshOnActivity
   );
   useEffect(() => {
      onState?.({ lastUpdated, loading, reload });
   }, [onState, lastUpdated, loading, reload]);

   if (error) return <p className="px-6 py-8 text-muted-foreground">{error}</p>;
   if (!data) return <p className="px-6 py-8 text-muted-foreground">{t('loading')}</p>;

   const ago = (iso: string) => format.relativeTime(new Date(iso), now);
   const moreQueued = data.runCounts.queued - data.queuedRuns.length;
   const inReviewTotal = data.taskSnapshot.inReview ?? data.inReview.length;
   const waitingOnPeople = data.pendingApprovalCount + inReviewTotal;
   const taskTotal = TASK_STATUSES.reduce((sum, { key }) => sum + (data.taskSnapshot[key] ?? 0), 0);

   return (
      <div className="flex flex-col gap-8 px-6 py-6">
         <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <StatTile label={t('running')} value={data.runCounts.running} />
            <StatTile label={t('queued')} value={data.runCounts.queued} />
            <StatTile label={t('awaiting')} value={waitingOnPeople} />
            <StatTile label={t('spentToday')} value={formatCost(data.today?.costMicros ?? 0)} />
            <StatTile label={t('callsToday')} value={data.today?.events ?? 0} />
         </div>

         <div className="grid gap-x-8 gap-y-10 lg:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-10">
               <Section title={t('inFlight')}>
                  {data.workingAgents.length === 0 && data.queuedRuns.length === 0 ? (
                     <p className="text-muted-foreground">{t('noneWorking')}</p>
                  ) : (
                     <ul className="flex flex-col gap-2">
                        {data.workingAgents.map((row) => (
                           <RunRow
                              key={row.runId}
                              orgId={orgId}
                              run={row}
                              mark="running"
                              markLabel={t('running')}
                              meta={
                                 row.startedAt
                                    ? t('runningFor', {
                                         duration: formatDuration(seconds(row.startedAt, now)),
                                      })
                                    : null
                              }
                           />
                        ))}
                        {data.queuedRuns.map((row) => (
                           <RunRow
                              key={row.runId}
                              orgId={orgId}
                              run={row}
                              mark="queued"
                              markLabel={t('queued')}
                              meta={t('waiting', { when: ago(row.createdAt) })}
                           />
                        ))}
                     </ul>
                  )}
                  {moreQueued > 0 ? (
                     <p className="text-muted-foreground">
                        {t('queuedMore', { count: moreQueued })}
                     </p>
                  ) : null}
               </Section>

               <Section title={t('recent')}>
                  {data.recentRuns.length === 0 ? (
                     <p className="text-muted-foreground">{t('noneRecent')}</p>
                  ) : (
                     <ul className="flex flex-col gap-2">
                        {data.recentRuns.map((row) => (
                           <RunRow
                              key={row.runId}
                              orgId={orgId}
                              run={row}
                              mark={row.status}
                              markLabel={t(`outcome_${row.status}`)}
                              meta={
                                 <>
                                    {row.status === 'failed' && row.failureCode ? (
                                       <span className="text-status-danger">{row.failureCode}</span>
                                    ) : row.startedAt ? (
                                       formatDuration(seconds(row.startedAt, row.completedAt))
                                    ) : null}
                                    <span aria-hidden> · </span>
                                    {ago(row.completedAt)}
                                 </>
                              }
                           />
                        ))}
                     </ul>
                  )}
               </Section>
            </div>

            <div className="flex min-w-0 flex-col gap-10">
               <Section title={t('needsPerson')}>
                  {waitingOnPeople === 0 ? (
                     <p className="text-muted-foreground">{t('nothingWaiting')}</p>
                  ) : null}

                  {data.pendingApprovalCount > 0 ? (
                     <div className="flex flex-col gap-2">
                        <h3 className="text-muted-foreground">
                           {t('approvals', { count: data.pendingApprovalCount })}
                        </h3>
                        <ul className="flex flex-col gap-2">
                           {data.pendingApprovals.map((row) => (
                              <li key={row.id} className={ROW}>
                                 <BerryMark size="sm" tone="attention" state="solid" />
                                 <Link
                                    href={`/${orgId}/inbox?approval=${encodeURIComponent(row.id)}`}
                                    className="min-w-0 flex-1 truncate hover:underline"
                                 >
                                    {row.issueIdentifier &&
                                    !row.title.includes(row.issueIdentifier) ? (
                                       <>
                                          <span className="text-muted-foreground">
                                             {row.issueIdentifier}
                                          </span>{' '}
                                       </>
                                    ) : null}
                                    {row.title}
                                 </Link>
                                 <span className={ROW_META}>
                                    <Pill tone={RISK_TONE[row.risk] ?? 'neutral'}>
                                       {t('risk', { risk: row.risk })}
                                    </Pill>
                                    {ago(row.requestedAt)}
                                 </span>
                              </li>
                           ))}
                        </ul>
                        {data.pendingApprovalCount > data.pendingApprovals.length ? (
                           <MoreLink href={`/${orgId}/inbox`}>
                              {t('more', {
                                 count: data.pendingApprovalCount - data.pendingApprovals.length,
                              })}{' '}
                              · {t('openInbox')}
                           </MoreLink>
                        ) : null}
                     </div>
                  ) : null}

                  {inReviewTotal > 0 ? (
                     <div className="flex flex-col gap-2">
                        <h3 className="text-muted-foreground">
                           {t('reviews', { count: inReviewTotal })}
                        </h3>
                        <ul className="flex flex-col gap-2">
                           {data.inReview.map((row) => (
                              <li key={row.issueId} className={ROW}>
                                 <StatusIcon statusId="in-review" />
                                 <Link
                                    href={`/${orgId}/issue/${row.identifier}`}
                                    className="min-w-0 flex-1 truncate hover:underline"
                                 >
                                    <span className="text-muted-foreground">{row.identifier}</span>{' '}
                                    {row.title}
                                 </Link>
                                 <span className={ROW_META}>{ago(row.since)}</span>
                              </li>
                           ))}
                        </ul>
                        {inReviewTotal > data.inReview.length ? (
                           <MoreLink href={`/${orgId}/reviews`}>
                              {t('more', { count: inReviewTotal - data.inReview.length })} ·{' '}
                              {t('openReviews')}
                           </MoreLink>
                        ) : null}
                     </div>
                  ) : null}
               </Section>

               <Section title={t('tasksNow')}>
                  {taskTotal > 0 ? (
                     <div
                        role="img"
                        aria-label={t('distribution')}
                        className="flex h-2 w-full gap-px overflow-hidden rounded-full"
                     >
                        {TASK_STATUSES.map(({ key, statusId }) => {
                           const count = data.taskSnapshot[key] ?? 0;
                           if (count === 0) return null;
                           return (
                              <span
                                 key={key}
                                 className="h-full"
                                 style={{
                                    flexGrow: count,
                                    backgroundColor:
                                       allStatus.find((entry) => entry.id === statusId)?.color ??
                                       'var(--status-neutral)',
                                 }}
                              />
                           );
                        })}
                     </div>
                  ) : null}
                  <ul className="flex flex-col gap-1.5">
                     {TASK_STATUSES.map(({ key, statusId }) => {
                        const count = data.taskSnapshot[key] ?? 0;
                        return (
                           <li key={key} className="flex items-center gap-2">
                              <StatusIcon statusId={statusId} />
                              <span>{t(`task_${key}`)}</span>
                              <span className="ml-auto tabular-nums text-muted-foreground">
                                 {count}
                              </span>
                              <span className="w-10 text-right tabular-nums text-muted-foreground">
                                 {taskTotal > 0 ? `${Math.round((count / taskTotal) * 100)}%` : ''}
                              </span>
                           </li>
                        );
                     })}
                  </ul>
               </Section>
            </div>
         </div>
      </div>
   );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
   return (
      <section className="flex min-w-0 flex-col gap-3">
         <h2 className="font-medium">{title}</h2>
         {children}
      </section>
   );
}

function MoreLink({ href, children }: { href: string; children: ReactNode }) {
   return (
      <Link
         href={href}
         className="self-start text-muted-foreground hover:text-foreground hover:underline"
      >
         {children}
      </Link>
   );
}

/** One run: its state mark, who, which task (key and title), and a trailing fact. */
function RunRow({
   orgId,
   run,
   mark,
   markLabel,
   meta,
}: {
   orgId: string;
   run: {
      runId: string;
      agentId: string;
      agentName: string;
      issueIdentifier: string;
      issueTitle: string;
   };
   mark: keyof typeof RUN_MARK;
   markLabel: string;
   meta: ReactNode;
}) {
   const look = RUN_MARK[mark];
   return (
      <li className={ROW}>
         <BerryMark
            size="sm"
            tone={look.tone}
            state={look.state}
            pulse={look.pulse}
            label={markLabel}
         />
         <Link href={`/${orgId}/agents/${run.agentId}`} className="shrink-0 hover:underline">
            {run.agentName}
         </Link>
         <Link
            href={`/${orgId}/runs?run=${run.runId}`}
            className="min-w-0 flex-1 truncate text-muted-foreground hover:text-foreground hover:underline"
         >
            {run.issueIdentifier ? `${run.issueIdentifier} ` : null}
            {run.issueTitle}
         </Link>
         {meta ? <span className={ROW_META}>{meta}</span> : null}
      </li>
   );
}
