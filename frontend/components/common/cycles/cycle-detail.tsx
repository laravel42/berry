'use client';

import { AddCycleTasksDialog } from '@/components/common/cycles/add-cycle-tasks-dialog';
import {
   BurnUpChart,
   MiniRing,
   ProgressRing,
   ProgressStats,
   statusFill,
   useTaskStatusName,
} from '@/components/common/cycles/cycle-visuals';
import { EmptyStateLoading } from '@/components/common/empty-state';
import { ActorAvatar } from '@/components/common/issues/actor-avatar';
import { useDetailDrawerClose } from '@/components/layout/detail-drawer-context';
import {
   AlertDialog,
   AlertDialogAction,
   AlertDialogCancel,
   AlertDialogContent,
   AlertDialogDescription,
   AlertDialogFooter,
   AlertDialogHeader,
   AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useCycleIssues } from '@/hooks/use-cycle-issues';
import { BerryApiError } from '@/lib/api';
import { toUiUser } from '@/lib/catalog';
import { WORKSPACE_SLUG } from '@/lib/config';
import {
   breakdown,
   burnUp,
   cycleLength,
   formatDate,
   formatDay,
   formatRange,
   progressFromIssues,
   todayIso,
} from '@/lib/cycle-math';
import {
   archiveCycle,
   clearIssueCycle,
   cycleFailureDetail,
   getCycle,
   updateWorkspaceCycle,
   type Cycle,
   type CycleIssueRef,
} from '@/lib/cycles';
import { cn } from '@/lib/utils';
import { canEditProduct, canEditSettings } from '@/lib/workspace-role';
import { useCyclesStore } from '@/store/cycles-store';
import { useIssuesStore } from '@/store/issues-store';
import { useSessionStore } from '@/store/session-store';
import { ChevronRight, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

const STATUS_INK: Record<Cycle['status'], string> = {
   upcoming: 'text-muted-foreground',
   active: 'text-status-success',
   completed: 'text-subtle-foreground',
};

function Card({
   title,
   aside,
   children,
   className,
}: {
   title: ReactNode;
   aside?: ReactNode;
   children: ReactNode;
   className?: string;
}) {
   return (
      <section className={cn('overflow-hidden rounded-[10px] bg-accent', className)}>
         <div className="flex items-center gap-2.5 px-4 pt-3 pb-2.5">
            {title}
            {aside}
         </div>
         {children}
      </section>
   );
}

function SideCard({ title, children }: { title: string; children: ReactNode }) {
   return (
      <section className="flex flex-col overflow-hidden rounded-[10px] bg-accent">
         <h3 data-heading="label" className="px-3.5 pt-3 pb-2 text-subtle-foreground">
            {title}
         </h3>
         {children}
      </section>
   );
}

interface AssigneeTally {
   key: string;
   assignee: NonNullable<CycleIssueRef['assignee']> | null;
   total: number;
   done: number;
}

/** Each assignee's done over scheduled, cancelled work left out. */
function tallyAssignees(issues: CycleIssueRef[]): AssigneeTally[] {
   const tallies = new Map<string, AssigneeTally>();
   for (const issue of issues) {
      if (issue.status === 'cancelled') continue;
      const key = issue.assignee ? `${issue.assignee.type}:${issue.assignee.id}` : 'none';
      const tally = tallies.get(key) ?? {
         key,
         assignee: issue.assignee ?? null,
         total: 0,
         done: 0,
      };
      tally.total += 1;
      if (issue.status === 'done') tally.done += 1;
      tallies.set(key, tally);
   }
   // Most work first; nobody's work last.
   return [...tallies.values()].sort(
      (left, right) =>
         Number(left.assignee === null) - Number(right.assignee === null) ||
         right.total - left.total
   );
}

/**
 * One cycle: its progress and burn-up, its tasks, and who holds them.
 *
 * Rendered in the drawer when opened from the list, and as a page from a
 * direct link; the close and breadcrumb behave accordingly.
 */
export default function CycleDetail({ cycleId }: { cycleId: string }) {
   const t = useTranslations('cycles');
   const locale = useLocale();
   const statusName = useTaskStatusName();
   const params = useParams<{ orgId?: string }>();
   const orgId = params?.orgId || WORKSPACE_SLUG;
   const router = useRouter();
   const closeDrawer = useDetailDrawerClose();
   const role = useSessionStore((state) => state.workspace?.role);
   const canEdit = canEditProduct(role);
   const canRemove = canEditSettings(role);
   const upsertCycle = useCyclesStore((state) => state.upsertCycle);
   const removeCycle = useCyclesStore((state) => state.removeCycle);
   const cached = useCyclesStore((state) => state.getCycleById(cycleId));
   const updateIssue = useIssuesStore((state) => state.updateIssue);
   const [fetched, setFetched] = useState<Cycle | null>(null);
   const [missing, setMissing] = useState(false);
   const [busy, setBusy] = useState(false);
   const [confirmRemove, setConfirmRemove] = useState(false);
   const [adding, setAdding] = useState(false);
   const ids = useMemo(() => [cycleId], [cycleId]);
   const { issuesByCycle, loaded: issuesLoaded, reload } = useCycleIssues(ids);

   useEffect(() => {
      let cancelled = false;
      setMissing(false);
      void getCycle(cycleId)
         .then((loaded) => {
            if (cancelled) return;
            setFetched(loaded);
            upsertCycle(loaded);
         })
         .catch((error: unknown) => {
            if (cancelled) return;
            if (error instanceof BerryApiError && error.status === 404) setMissing(true);
         });
      return () => {
         cancelled = true;
      };
   }, [cycleId, upsertCycle]);

   // The store is kept live by the workspace stream; the fetch is the fallback.
   const cycle = cached ?? fetched;
   const listHref = `/${orgId}/cycles`;

   if (!cycle) {
      return (
         <div className="flex h-full min-h-0 flex-col">
            <DetailHeader name={null} onClose={closeDrawer} listHref={listHref} />
            {missing ? (
               <p className="p-6 text-muted-foreground">{t('detail.notFound')}</p>
            ) : (
               <EmptyStateLoading label={t('detail.loading')} />
            )}
         </div>
      );
   }

   const issues = issuesByCycle[cycle.id] ?? [];
   const progress = breakdown(issuesLoaded ? progressFromIssues(issues) : cycle.progress);
   const chart = burnUp(cycle, issues, todayIso());
   const assignees = tallyAssignees(issues);

   const setStatus = async (status: Cycle['status']) => {
      if (busy) return;
      setBusy(true);
      try {
         const updated = await updateWorkspaceCycle(cycle.id, { status });
         upsertCycle(updated);
         setFetched(updated);
         // Activating one completes whichever was active before.
         if (status === 'active') {
            for (const other of useCyclesStore.getState().cycles) {
               if (other.id !== updated.id && other.status === 'active') {
                  upsertCycle({ ...other, status: 'completed' });
               }
            }
            toast.success(t('detail.activated', { name: updated.name }));
         } else if (status === 'completed') {
            toast.success(t('detail.completed', { name: updated.name }));
         }
      } catch (error) {
         toast.error(t('detail.failed'), cycleFailureDetail(error));
      } finally {
         setBusy(false);
      }
   };

   const remove = async () => {
      if (busy) return;
      setBusy(true);
      try {
         await archiveCycle(cycle.id);
         removeCycle(cycle.id);
         for (const issue of useIssuesStore.getState().issues) {
            if (issue.cycleId === cycle.id) updateIssue(issue.id, { cycleId: '' });
         }
         toast.success(t('detail.removed', { name: cycle.name }));
         if (closeDrawer) closeDrawer();
         else router.push(listHref);
      } catch (error) {
         toast.error(t('detail.failed'), cycleFailureDetail(error));
         setBusy(false);
      }
   };

   const unschedule = async (issue: CycleIssueRef) => {
      try {
         await clearIssueCycle(cycle.id, issue.identifier);
         const local = useIssuesStore.getState().issues.find((entry) => entry.id === issue.id);
         if (local) updateIssue(local.id, { cycleId: '' });
         reload();
      } catch (error) {
         toast.error(t('detail.failed'), cycleFailureDetail(error));
      }
   };

   const properties: { key: string; label: string; value: ReactNode; ink?: string }[] = [
      {
         key: 'status',
         label: t('detail.propStatus'),
         value: t(`status.${cycle.status}`),
         ink: STATUS_INK[cycle.status],
      },
      { key: 'starts', label: t('detail.propStarts'), value: formatDate(cycle.startsOn, locale) },
      { key: 'ends', label: t('detail.propEnds'), value: formatDate(cycle.endsOn, locale) },
      {
         key: 'length',
         label: t('detail.propLength'),
         value: t('detail.days', { count: cycleLength(cycle) }),
         ink: 'text-muted-foreground',
      },
      {
         key: 'number',
         label: t('detail.propNumber'),
         value: `#${cycle.number}`,
         ink: 'text-muted-foreground',
      },
      ...(cycle.createdBy
         ? [
              {
                 key: 'createdBy',
                 label: t('detail.propCreatedBy'),
                 value: (
                    <>
                       <ActorAvatar user={toUiUser(cycle.createdBy)} size="sm" />
                       <span className="truncate">{cycle.createdBy.name}</span>
                    </>
                 ),
                 ink: 'text-muted-foreground',
              },
           ]
         : []),
   ];

   return (
      <div className="flex h-full min-h-0 flex-col">
         <DetailHeader name={cycle.name} onClose={closeDrawer} listHref={listHref}>
            {canRemove ? (
               <Button
                  variant="soft-destructive"
                  disabled={busy}
                  onClick={() => setConfirmRemove(true)}
               >
                  {t('detail.remove')}
               </Button>
            ) : null}
            {canEdit && cycle.status !== 'active' ? (
               <Button variant="soft" disabled={busy} onClick={() => void setStatus('active')}>
                  {t('detail.activate')}
               </Button>
            ) : null}
            {canEdit && cycle.status === 'active' ? (
               <Button disabled={busy} onClick={() => void setStatus('completed')}>
                  {t('detail.complete')}
               </Button>
            ) : null}
         </DetailHeader>

         <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_300px] md:overflow-hidden">
            <div className="flex min-w-0 flex-col gap-5 p-6 md:overflow-y-auto md:border-r">
               <div className="flex flex-col gap-1">
                  <h1>{cycle.name}</h1>
                  <span className="text-muted-foreground">
                     {formatRange(cycle, locale)} · {t(`status.${cycle.status}`)}
                  </span>
               </div>

               <Card
                  title={<h2>{t('detail.progress')}</h2>}
                  aside={
                     <span className="text-subtle-foreground">
                        {progress.total > 0
                           ? t('detail.progressSummary', {
                                percent: progress.donePercent,
                                count: progress.scope,
                             })
                           : t('detail.nothingScheduled')}
                     </span>
                  }
               >
                  <div className="flex flex-col gap-3.5 border-t px-4 pt-3.5 pb-4">
                     <div className="grid grid-cols-1 items-center gap-6 sm:grid-cols-[auto_minmax(0,1fr)]">
                        <ProgressRing progress={progress} />
                        <BurnUpChart
                           chart={chart}
                           startLabel={formatDay(cycle.startsOn, locale)}
                           endLabel={formatDay(cycle.endsOn, locale)}
                        />
                     </div>
                     <ProgressStats progress={progress} withCancelled />
                  </div>
               </Card>

               <Card
                  title={
                     <h2>
                        {t('detail.issues')}
                        <span className="ml-2 font-normal text-subtle-foreground">
                           {progress.total}
                        </span>
                     </h2>
                  }
                  aside={
                     canEdit ? (
                        <Button
                           size="xxs"
                           variant="soft"
                           className="ml-auto"
                           onClick={() => setAdding(true)}
                        >
                           <Plus className="size-3" aria-hidden />
                           {t('detail.addTasks')}
                        </Button>
                     ) : null
                  }
               >
                  {issuesLoaded && issues.length === 0 ? (
                     <p className="border-t px-4 py-3.5 text-subtle-foreground">
                        {t('detail.noIssues')}
                     </p>
                  ) : null}
                  <ul>
                     {issues.map((issue) => (
                        <li
                           key={issue.id}
                           className="group relative grid h-[42px] grid-cols-[64px_minmax(0,1fr)_auto_24px] items-center gap-3 border-t px-4 transition-colors hover:bg-secondary/50"
                        >
                           <span className="truncate text-subtle-foreground">
                              {issue.identifier}
                           </span>
                           <Link
                              href={`/${orgId}/issue/${issue.identifier}`}
                              className={cn(
                                 'truncate outline-none after:absolute after:inset-0 focus-visible:underline',
                                 issue.status === 'cancelled' &&
                                    'text-subtle-foreground line-through decoration-subtle-foreground/50'
                              )}
                           >
                              {issue.title}
                           </Link>
                           <span className="inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-[5px] bg-settings-control px-2 text-muted-foreground">
                              <span
                                 aria-hidden
                                 className={cn('size-1.5 rounded-full', statusFill(issue.status))}
                              />
                              {statusName(issue.status)}
                           </span>
                           <span className="relative flex justify-end">
                              {canEdit ? (
                                 <Button
                                    variant="quiet"
                                    size="icon"
                                    className="absolute -right-1 z-10 size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                                    aria-label={t('detail.removeFromCycle', {
                                       identifier: issue.identifier,
                                    })}
                                    onClick={() => void unschedule(issue)}
                                 >
                                    <X className="size-3.5" aria-hidden />
                                 </Button>
                              ) : null}
                              <span
                                 className={cn(canEdit && 'group-hover:opacity-0')}
                                 title={issue.assignee?.name ?? t('detail.unassigned')}
                              >
                                 {issue.assignee ? (
                                    <ActorAvatar user={toUiUser(issue.assignee)} size="md" />
                                 ) : (
                                    <span className="block size-5 rounded-full border border-dashed border-muted-foreground/40" />
                                 )}
                              </span>
                           </span>
                        </li>
                     ))}
                  </ul>
               </Card>
            </div>

            <aside className="flex min-w-0 flex-col gap-5 px-4 py-5 md:overflow-y-auto">
               <SideCard title={t('detail.properties')}>
                  <dl>
                     {properties.map((row) => (
                        <div
                           key={row.key}
                           className="flex h-[38px] items-center justify-between gap-2.5 border-t px-3.5"
                        >
                           <dt className="text-subtle-foreground">{row.label}</dt>
                           <dd
                              className={cn(
                                 'flex min-w-0 items-center gap-1.5 whitespace-nowrap',
                                 row.ink ?? 'text-foreground'
                              )}
                           >
                              {row.value}
                           </dd>
                        </div>
                     ))}
                  </dl>
               </SideCard>
               {assignees.length > 0 ? (
                  <SideCard title={t('detail.assignees')}>
                     <ul>
                        {assignees.map((tally) => (
                           <li
                              key={tally.key}
                              className="grid h-10 grid-cols-[22px_minmax(0,1fr)_auto_16px] items-center gap-2.5 border-t px-3.5"
                           >
                              {tally.assignee ? (
                                 <ActorAvatar user={toUiUser(tally.assignee)} size="md" />
                              ) : (
                                 <span className="block size-5 rounded-full border border-dashed border-muted-foreground/40" />
                              )}
                              <span
                                 className={cn(
                                    'truncate',
                                    !tally.assignee && 'text-subtle-foreground'
                                 )}
                              >
                                 {tally.assignee?.name ?? t('detail.unassigned')}
                              </span>
                              <span className="text-muted-foreground tabular-nums">
                                 {tally.done}/{tally.total}
                              </span>
                              <MiniRing
                                 percent={tally.total ? (tally.done / tally.total) * 100 : 0}
                                 size={16}
                              />
                           </li>
                        ))}
                     </ul>
                  </SideCard>
               ) : null}
            </aside>
         </div>

         <AddCycleTasksDialog
            cycle={cycle}
            open={adding}
            onOpenChange={setAdding}
            onAdded={reload}
         />

         <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
            <AlertDialogContent>
               <AlertDialogHeader>
                  <AlertDialogTitle>
                     {t('detail.removeTitle', { name: cycle.name })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>{t('detail.removeBody')}</AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
                  <AlertDialogCancel>{t('detail.cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                     className="bg-destructive text-white hover:bg-destructive/90"
                     onClick={() => void remove()}
                  >
                     {t('detail.removeConfirm')}
                  </AlertDialogAction>
               </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>
      </div>
   );
}

function DetailHeader({
   name,
   onClose,
   listHref,
   children,
}: {
   name: string | null;
   onClose: (() => void) | undefined;
   listHref: string;
   children?: ReactNode;
}) {
   const t = useTranslations('cycles.detail');
   return (
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b pr-3 pl-5">
         <nav aria-label={t('back')} className="flex min-w-0 items-center gap-2">
            {onClose ? (
               <button
                  type="button"
                  onClick={onClose}
                  className="shrink-0 cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
               >
                  {t('back')}
               </button>
            ) : (
               <Link
                  href={listHref}
                  className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
               >
                  {t('back')}
               </Link>
            )}
            {name ? (
               <>
                  <ChevronRight className="size-3 shrink-0 text-subtle-foreground" aria-hidden />
                  <span className="truncate font-semibold" aria-current="page">
                     {name}
                  </span>
               </>
            ) : null}
         </nav>
         <div className="ml-auto flex shrink-0 items-center gap-2">
            {children}
            {onClose ? (
               <Button variant="quiet" size="icon" aria-label={t('close')} onClick={onClose}>
                  <X className="size-3.5" aria-hidden />
               </Button>
            ) : null}
         </div>
      </div>
   );
}
