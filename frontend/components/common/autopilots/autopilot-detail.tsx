'use client';

import { ChevronLeft, Play } from 'lucide-react';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { BerryMark } from '@/components/brand/berry-mark';
import AutopilotDialog from '@/components/common/autopilots/autopilot-dialog';
import { DeliveriesTable, RunsTable } from '@/components/common/autopilots/history-tabs';
import TriggersTab from '@/components/common/autopilots/triggers-tab';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAutopilot } from '@/hooks/use-autopilot';
import {
   archiveAutopilot,
   describeAutopilotFailure,
   runAutopilot,
   updateAutopilot,
   type AutopilotDetail as Autopilot,
} from '@/lib/autopilots';
import { listBoards, type BoardSummary } from '@/lib/boards';
import { WORKSPACE_SLUG } from '@/lib/config';
import { agentHasRuntime, getAgentCoverage, type AgentCoverage } from '@/lib/runtimes';
import { cn } from '@/lib/utils';
import { canEditProduct } from '@/lib/workspace-role';
import { useAgentsStore } from '@/store/agents-store';
import { useSessionStore } from '@/store/session-store';

const TABS = ['overview', 'triggers', 'runs', 'deliveries'] as const;
type DetailTab = (typeof TABS)[number];

const isTab = (value: string | null): value is DetailTab =>
   value !== null && (TABS as readonly string[]).includes(value);

/**
 * One autopilot: whether it is on, what it will do, and everything it has
 * already done.
 *
 * Identity and the one primary action stay above the fold. Tabs carry the
 * work of configuring triggers and reading history — never the fact of what
 * this autopilot is.
 */
export default function AutopilotDetail({ autopilotId }: { autopilotId: string }) {
   const t = useTranslations('areas.autopilots');
   const router = useRouter();
   const pathname = usePathname();
   const searchParams = useSearchParams();
   const params = useParams<{ orgId?: string }>();
   const orgId = params?.orgId || WORKSPACE_SLUG;
   const canEdit = canEditProduct(useSessionStore((state) => state.workspace?.role));
   const agents = useAgentsStore((state) => state.agents);

   const { autopilot, runs, deliveries, error, loading, reload } = useAutopilot(autopilotId);
   const [editing, setEditing] = useState(false);
   const [archiving, setArchiving] = useState(false);
   const [coverage, setCoverage] = useState<AgentCoverage | null>(null);
   const [boards, setBoards] = useState<BoardSummary[]>([]);
   const [busy, setBusy] = useState(false);

   const view: DetailTab = isTab(searchParams?.get('view') ?? null)
      ? (searchParams?.get('view') as DetailTab)
      : 'overview';

   const setView = (next: DetailTab) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      if (next === 'overview') params.delete('view');
      else params.set('view', next);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
   };

   useEffect(() => {
      let cancelled = false;
      void getAgentCoverage().then(
         (found) => {
            if (!cancelled) setCoverage(found);
         },
         () => undefined
      );
      void listBoards().then(
         (found) => {
            if (!cancelled) setBoards(found);
         },
         () => undefined
      );
      return () => {
         cancelled = true;
      };
   }, []);

   if (loading) {
      return (
         <div className="flex flex-col gap-4 px-8 py-8">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-full max-w-xl" />
            <Skeleton className="mt-4 h-10 w-full max-w-2xl" />
            <Skeleton className="h-40 w-full max-w-3xl" />
         </div>
      );
   }

   if (error || !autopilot) {
      return (
         <div className="flex min-h-64 flex-col items-center justify-center gap-4 px-8 py-16 text-center">
            <BerryMark size="lg" tone="neutral" state="crossed" label={t('detail.loadFailed')} />
            <p className="max-w-sm text-muted-foreground" role="alert">
               {error ?? t('detail.loadFailed')}
            </p>
            <Button asChild variant="secondary" size="sm">
               <Link href={`/${orgId}/autopilots`}>{t('detail.back')}</Link>
            </Button>
         </div>
      );
   }

   const paused = autopilot.status === 'paused';
   const assigneeName =
      agents.find((agent) => agent.id === autopilot.assigneeId)?.name ?? autopilot.assigneeId;
   const runsOn = autopilot.assigneeType === 'agent' ? autopilot.assigneeId : undefined;
   const hasRuntime = runsOn ? agentHasRuntime(coverage, runsOn) : true;
   const blocked: 'paused' | 'noRuntime' | null = !hasRuntime
      ? 'noRuntime'
      : paused
        ? 'paused'
        : null;

   const act = async (work: () => Promise<unknown>, done: string) => {
      setBusy(true);
      try {
         await work();
         toast.success(done);
         reload();
      } catch (failure) {
         toast.error(describeAutopilotFailure(failure));
      } finally {
         setBusy(false);
      }
   };

   const runNow = () =>
      act(async () => {
         const outcome = await runAutopilot(autopilot.id);
         if (outcome.status !== 'enqueued') {
            throw new Error(
               t('detail.notQueued', { reason: outcome.reasonCode ?? outcome.status })
            );
         }
      }, t('detail.queued'));

   const board = boards.find((entry) => entry.id === autopilot.boardId);
   const quotaLabel =
      autopilot.quotaPeriod === 'none'
         ? t('quota.none')
         : t('quota.some', {
              count: autopilot.quotaMax ?? 0,
              period: t(`quota.${autopilot.quotaPeriod}`),
           });

   const tabLabel: Record<DetailTab, string> = {
      overview: t('detail.tabOverview'),
      triggers: t('detail.tabTriggers'),
      runs: t('detail.tabRuns'),
      deliveries: t('detail.tabDeliveries'),
   };

   return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
         <div className="border-b px-8 py-6">
            <Link
               href={`/${orgId}/autopilots`}
               className="mb-4 inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
            >
               <ChevronLeft className="size-3.5" aria-hidden />
               {t('title')}
            </Link>

            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
               <div className="flex min-w-0 gap-4">
                  <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-muted/40">
                     <BerryMark
                        size="lg"
                        tone={paused ? 'neutral' : 'working'}
                        state={paused ? 'hollow' : undefined}
                        label={autopilot.name}
                     />
                  </span>
                  <div className="min-w-0">
                     <div className="flex flex-wrap items-center gap-2">
                        <h1 className="font-medium leading-none">{autopilot.name}</h1>
                        <span
                           className={cn(
                              'inline-flex items-center gap-1.5 rounded-md border px-2 py-1',
                              paused
                                 ? 'border-border/70 text-muted-foreground'
                                 : 'border-border/70 text-foreground'
                           )}
                        >
                           <span
                              className={cn(
                                 'size-1.5 rounded-full',
                                 paused ? 'bg-muted-foreground/40' : 'bg-status-success'
                              )}
                              aria-hidden
                           />
                           {t(`status.${autopilot.status}`)}
                        </span>
                     </div>
                     <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
                        <span className="truncate">{assigneeName}</span>
                        <span aria-hidden>·</span>
                        <span>{t(`mode.${autopilot.executionMode}`)}</span>
                        <span aria-hidden>·</span>
                        <span>{t('detail.version', { version: autopilot.version })}</span>
                     </p>
                  </div>
               </div>

               <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {canEdit ? (
                     <label className="mr-1 flex items-center gap-2 rounded-md border border-border/70 px-2.5 py-1.5">
                        <Switch
                           checked={!paused}
                           disabled={busy}
                           aria-label={t('detail.active')}
                           onCheckedChange={(on) =>
                              void act(
                                 () =>
                                    updateAutopilot(autopilot.id, {
                                       status: on ? 'active' : 'paused',
                                    }),
                                 on ? t('row.resumed') : t('row.paused')
                              )
                           }
                        />
                        <span className="text-muted-foreground">{t('detail.active')}</span>
                     </label>
                  ) : (
                     <span className="text-muted-foreground">{t('row.locked')}</span>
                  )}
                  <Button
                     type="button"
                     size="sm"
                     disabled={busy || blocked !== null || !canEdit}
                     title={blocked ? t(`detail.blocked_${blocked}`) : undefined}
                     onClick={() => void runNow()}
                  >
                     <Play className="size-3.5" aria-hidden />
                     {t('detail.runNow')}
                  </Button>
                  {canEdit ? (
                     <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => setEditing(true)}
                     >
                        {t('detail.edit')}
                     </Button>
                  ) : null}
               </div>
            </div>

            {blocked === 'noRuntime' ? (
               <p
                  className="mt-4 flex flex-wrap items-center gap-2 rounded-md border border-status-warning/40 bg-status-warning/5 px-3 py-2"
                  role="status"
               >
                  <span>{t('detail.noRuntimeBanner', { name: assigneeName })}</span>
                  <span className="text-muted-foreground">{t('detail.noRuntimeHint')}</span>
                  <Link
                     href={`/${orgId}/settings/runtimes`}
                     className="underline underline-offset-2"
                  >
                     {t('detail.runtimesLink')}
                  </Link>
               </p>
            ) : null}
         </div>

         <Tabs
            value={view}
            onValueChange={(value) => setView(value as DetailTab)}
            className="flex min-h-0 flex-1 flex-col"
         >
            <div className="border-b px-8">
               <TabsList className="h-10 gap-1 rounded-none bg-transparent p-0">
                  {TABS.map((tab) => (
                     <TabsTrigger
                        key={tab}
                        value={tab}
                        className="rounded-none border-b-2 border-transparent px-3 py-2 data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                     >
                        {tabLabel[tab]}
                     </TabsTrigger>
                  ))}
               </TabsList>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
               {view === 'overview' ? (
                  <OverviewPanel
                     autopilot={autopilot}
                     assigneeName={assigneeName}
                     boardName={board?.name}
                     quotaLabel={quotaLabel}
                     canEdit={canEdit}
                     busy={busy}
                     onArchive={() => setArchiving(true)}
                  />
               ) : null}
               {view === 'triggers' ? (
                  <TriggersTab autopilot={autopilot} canEdit={canEdit} onChanged={reload} />
               ) : null}
               {view === 'runs' ? <RunsTable runs={runs} orgId={orgId} /> : null}
               {view === 'deliveries' ? (
                  <DeliveriesTable
                     autopilotId={autopilot.id}
                     deliveries={deliveries}
                     canReplay={canEdit}
                     onReplayed={reload}
                  />
               ) : null}
            </div>
         </Tabs>

         <AutopilotDialog
            open={editing}
            onOpenChange={(open) => {
               setEditing(open);
               if (!open) reload();
            }}
            autopilot={autopilot}
         />

         <AlertDialog open={archiving} onOpenChange={setArchiving}>
            <AlertDialogContent>
               <AlertDialogHeader>
                  <AlertDialogTitle>
                     {t('row.confirmDeleteTitle', { name: autopilot.name })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>{t('row.confirmDeleteBody')}</AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
                  <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                     onClick={() =>
                        void archiveAutopilot(autopilot.id)
                           .then(() => {
                              toast.success(t('row.deleted', { name: autopilot.name }));
                              router.push(`/${orgId}/autopilots`);
                           })
                           .catch((failure: unknown) =>
                              toast.error(describeAutopilotFailure(failure))
                           )
                     }
                  >
                     {t('row.delete')}
                  </AlertDialogAction>
               </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>
      </div>
   );
}

function OverviewPanel({
   autopilot,
   assigneeName,
   boardName,
   quotaLabel,
   canEdit,
   busy,
   onArchive,
}: {
   autopilot: Autopilot;
   assigneeName: string;
   boardName: string | undefined;
   quotaLabel: string;
   canEdit: boolean;
   busy: boolean;
   onArchive: () => void;
}) {
   const t = useTranslations('areas.autopilots');

   return (
      <div className="mx-auto grid max-w-5xl gap-8 px-8 py-6 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
         <dl className="flex flex-col gap-4">
            <div>
               <dt className="text-muted-foreground">{t('detail.assignee')}</dt>
               <dd className="mt-0.5 truncate">{assigneeName}</dd>
            </div>
            <div>
               <dt className="text-muted-foreground">{t('columns.mode')}</dt>
               <dd className="mt-0.5">{t(`mode.${autopilot.executionMode}`)}</dd>
            </div>
            <div>
               <dt className="text-muted-foreground">{t('detail.project')}</dt>
               <dd className="mt-0.5 truncate">{boardName ?? '—'}</dd>
            </div>
            <div>
               <dt className="text-muted-foreground">{t('columns.quota')}</dt>
               <dd className="mt-0.5">{quotaLabel}</dd>
            </div>
            <div>
               <dt className="text-muted-foreground">{t('detail.created')}</dt>
               <dd className="mt-0.5">{new Date(autopilot.createdAt).toLocaleDateString()}</dd>
            </div>
            <div>
               <dt className="text-muted-foreground">{t('detail.updated')}</dt>
               <dd className="mt-0.5">{new Date(autopilot.updatedAt).toLocaleDateString()}</dd>
            </div>
         </dl>

         <div className="flex min-w-0 flex-col gap-8">
            <section className="min-w-0">
               <h2 className="font-medium">{t('detail.runbook')}</h2>
               <pre className="mt-3 max-h-[min(28rem,60vh)] overflow-auto whitespace-pre-wrap rounded-md border border-border/70 bg-muted/20 p-4 leading-relaxed text-muted-foreground">
                  {autopilot.promptTemplate}
               </pre>
            </section>

            {canEdit ? (
               <section className="border-t border-border/70 pt-6">
                  <h2 className="font-medium">{t('detail.danger')}</h2>
                  <p className="mt-1 text-muted-foreground">{t('detail.dangerHint')}</p>
                  <Button
                     size="sm"
                     variant="secondary"
                     className="mt-3"
                     disabled={busy}
                     onClick={onArchive}
                  >
                     {t('row.delete')}
                  </Button>
               </section>
            ) : null}
         </div>
      </div>
   );
}
