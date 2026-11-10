'use client';

import {
   Archive,
   ArchiveRestore,
   Copy,
   FileStack,
   MoreHorizontal,
   Pause,
   Play,
   TriangleAlert,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { BerryMark } from '@/components/brand/berry-mark';
import { draftFromAutopilot } from '@/components/common/autopilots/autopilot-dialog';
import { DeliveriesTable } from '@/components/common/autopilots/history-tabs';
import { EmptyStateLoading } from '@/components/common/empty-state';
import EventReceipts from '@/components/common/loops/event-receipts';
import { SectionCard, SoonPill } from '@/components/common/loops/loop-editor-parts';
import TriggerEditor, {
   applyTrigger,
   draftFromTrigger,
   sameTrigger,
   triggerComplete,
   type TriggerDraft,
} from '@/components/common/loops/trigger-editor';
import { LoopEditorFields, draftReady } from '@/components/common/loops/loop-editor-fields';
import { useDetailDrawerClose, useInDetailDrawer } from '@/components/layout/detail-drawer-context';
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
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuSeparator,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { User } from '@/data/users';
import { useAutopilot } from '@/hooks/use-autopilot';
import {
   archiveAutopilot,
   describeAutopilotFailure,
   describeReason,
   duplicateAutopilot,
   restoreAutopilot,
   runAutopilot,
   updateAutopilot,
   type AutopilotDraft,
   type AutopilotRun,
   type LoopRunState,
   type WebhookSecrets,
} from '@/lib/autopilots';
import { boardsIn, listBoards, type BoardSummary } from '@/lib/boards';
import { WORKSPACE_SLUG } from '@/lib/config';
import { loadWorkspaceMembers } from '@/lib/members';
import { agentHasRuntime, getAgentCoverage, type AgentCoverage } from '@/lib/runtimes';
import { cn } from '@/lib/utils';
import { canEditProduct } from '@/lib/workspace-role';
import { useAgentsStore } from '@/store/agents-store';
import { useSessionStore } from '@/store/session-store';

/** Runs shown before "Show all". */
const RUNS_SHOWN = 8;

/** A run's dot, by how it ended (or that it has not). */
const RUN_DOT: Record<LoopRunState, string> = {
   queued: 'bg-status-neutral',
   running: 'bg-status-warning animate-pulse',
   waiting_for_approval: 'bg-status-warning',
   succeeded: 'bg-status-success',
   failed: 'bg-status-danger',
   canceled: 'bg-status-neutral',
   timed_out: 'bg-status-danger',
   skipped: 'bg-status-neutral',
};

function sameDraft(left: AutopilotDraft, right: AutopilotDraft): boolean {
   return JSON.stringify(left) === JSON.stringify(right);
}

function formatDuration(ms: number): string {
   const seconds = Math.max(0, Math.round(ms / 1000));
   if (seconds < 60) return `${seconds}s`;
   const minutes = Math.floor(seconds / 60);
   if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
   return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * One Loop, as the page it is edited on.
 *
 * What it is (General), what starts it (Trigger), what it is told
 * (Instructions) and what it may do (Access, Limits) sit on the left; what it
 * has done (Run history) and the facts about it on the right. Fields are a
 * draft until Save; a trigger is created or changed the moment it is, because
 * the server keeps triggers apart from the Loop's own fields.
 *
 * Sections Berry cannot honour yet are shown dimmed and marked "Soon", so the
 * page is complete without pretending.
 */
export default function AutopilotDetail({ autopilotId }: { autopilotId: string }) {
   const t = useTranslations('loops');
   const te = useTranslations('loops.editor');
   const router = useRouter();
   const params = useParams<{ orgId?: string }>();
   const orgId = params?.orgId || WORKSPACE_SLUG;
   const inDrawer = useInDetailDrawer();
   const closeDrawer = useDetailDrawerClose();
   const canEdit = canEditProduct(useSessionStore((state) => state.workspace?.role));
   const workspaceId = useSessionStore((state) => state.workspace?.id);
   const agents = useAgentsStore((state) => state.agents);

   const { autopilot, runs, deliveries, error, loading, reload } = useAutopilot(autopilotId);
   const [archiving, setArchiving] = useState(false);
   const [coverage, setCoverage] = useState<AgentCoverage | null>(null);
   const [boards, setBoards] = useState<BoardSummary[]>([]);
   const [people, setPeople] = useState<User[]>([]);
   const [busy, setBusy] = useState(false);
   const [saving, setSaving] = useState(false);
   const [allRuns, setAllRuns] = useState(false);

   // The draft follows the Loop as it is re-read (a run ending, someone else
   // saving) until the person changes something; from then it is theirs.
   const baseline = useMemo(() => (autopilot ? draftFromAutopilot(autopilot) : null), [autopilot]);
   const [draft, setDraft] = useState<AutopilotDraft | null>(null);
   // The trigger is part of the same draft: the Loop's first trigger, saved
   // with the rest. Further triggers a Loop was given before stay as they are.
   const triggerBaseline = useMemo(
      () => (autopilot ? draftFromTrigger(autopilot.triggers[0]) : null),
      [autopilot]
   );
   const [triggerDraft, setTriggerDraft] = useState<TriggerDraft | null>(null);
   const [secrets, setSecrets] = useState<WebhookSecrets | null>(null);
   const [touched, setTouched] = useState(false);
   useEffect(() => {
      if (baseline && !touched) setDraft(baseline);
      if (triggerBaseline && !touched) setTriggerDraft(triggerBaseline);
   }, [baseline, triggerBaseline, touched]);
   const fieldsChanged = Boolean(draft && baseline && !sameDraft(draft, baseline));
   const triggerChanged = Boolean(
      triggerDraft && triggerBaseline && !sameTrigger(triggerDraft, triggerBaseline)
   );
   const dirty = touched && (fieldsChanged || triggerChanged);

   useEffect(() => {
      if (!dirty) return;
      const warn = (event: BeforeUnloadEvent) => event.preventDefault();
      window.addEventListener('beforeunload', warn);
      return () => window.removeEventListener('beforeunload', warn);
   }, [dirty]);

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
            // Only this workspace's: the list spans every workspace.
            if (!cancelled) setBoards(boardsIn(found, workspaceId));
         },
         () => undefined
      );
      if (workspaceId) {
         void loadWorkspaceMembers(workspaceId).then(
            (found) => {
               if (!cancelled) setPeople(found);
            },
            () => undefined
         );
      }
      return () => {
         cancelled = true;
      };
   }, [workspaceId]);

   if (loading) {
      return <EmptyStateLoading label={t('detail.loading')} />;
   }

   if (error || !autopilot || !draft) {
      return (
         <div className="flex min-h-64 flex-col items-center justify-center gap-4 px-8 py-16 text-center">
            <BerryMark size="lg" tone="neutral" state="crossed" label={t('detail.loadFailed')} />
            <p className="max-w-sm text-muted-foreground" role="alert">
               {error ?? t('detail.loadFailed')}
            </p>
            {closeDrawer ? (
               <Button variant="secondary" size="sm" onClick={closeDrawer}>
                  {t('detail.back')}
               </Button>
            ) : (
               <Button asChild variant="secondary" size="sm">
                  <Link href={`/${orgId}/loops`}>{t('detail.back')}</Link>
               </Button>
            )}
         </div>
      );
   }

   const archived = autopilot.status === 'archived';
   const paused = autopilot.status === 'paused';
   const editable = canEdit && !archived;
   const assigneeName =
      agents.find((agent) => agent.id === autopilot.assigneeId)?.name ?? autopilot.assigneeId;
   const runsOn = autopilot.assigneeType === 'agent' ? autopilot.assigneeId : undefined;
   const hasRuntime = runsOn ? agentHasRuntime(coverage, runsOn) : true;
   const blocked: 'paused' | 'noRuntime' | null = !hasRuntime
      ? 'noRuntime'
      : paused
        ? 'paused'
        : null;
   const listensForEvents =
      triggerDraft?.kind === 'event' ||
      triggerDraft?.kind === 'pr' ||
      autopilot.triggers.slice(1).some((trigger) => trigger.kind === 'event');
   const ready = draftReady(draft) && (triggerDraft === null || triggerComplete(triggerDraft));

   const patch = (next: Partial<AutopilotDraft>) => {
      setTouched(true);
      setDraft((current) => (current ? { ...current, ...next } : current));
   };

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

   const save = async () => {
      if (!dirty || !ready || saving) return;
      setSaving(true);
      try {
         if (fieldsChanged) await updateAutopilot(autopilot.id, draft);
         if (triggerChanged && triggerDraft) {
            const made = await applyTrigger(autopilot.id, autopilot.triggers[0], triggerDraft);
            // A new webhook's URL and secret, readable this once.
            if (made) setSecrets(made);
         }
         toast.success(te('saved'));
         setTouched(false);
         reload();
      } catch (failure) {
         toast.error(describeAutopilotFailure(failure));
      } finally {
         setSaving(false);
      }
   };

   const discard = () => {
      setTouched(false);
      if (baseline) setDraft(baseline);
      if (triggerBaseline) setTriggerDraft(triggerBaseline);
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

   const duplicate = () =>
      act(
         async () => {
            const copy = await duplicateAutopilot(autopilot.id);
            router.push(`/${orgId}/loop/${copy.id}`);
         },
         t('row.duplicated', { name: autopilot.name })
      );

   const restore = () =>
      act(() => restoreAutopilot(autopilot.id), t('row.restored', { name: autopilot.name }));

   const togglePaused = () =>
      act(
         () => updateAutopilot(autopilot.id, { status: paused ? 'active' : 'paused' }),
         paused ? t('row.resumed') : t('row.paused')
      );

   const owner = autopilot.createdBy
      ? (people.find((person) => person.id === autopilot.createdBy)?.name ?? t('row.someone'))
      : t('row.someone');

   const statePill = (
      <span
         className={cn(
            'inline-flex h-5 shrink-0 items-center gap-1.5 rounded-[5px] bg-accent px-1.5 leading-none',
            autopilot.status === 'active' ? 'text-status-success' : 'text-muted-foreground'
         )}
      >
         <span
            className={cn(
               'size-1.5 rounded-full',
               autopilot.status === 'active' ? 'bg-status-success' : 'bg-muted-foreground/60'
            )}
            aria-hidden
         />
         {t(`status.${autopilot.status}`)}
      </span>
   );

   return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
         <header className="flex h-[52px] shrink-0 items-center gap-2.5 border-b px-5">
            <nav aria-label={t('title')} className="flex min-w-0 items-center gap-2.5">
               {inDrawer ? null : (
                  <>
                     <Link
                        href={`/${orgId}/loops`}
                        data-heading="h1"
                        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                     >
                        {t('title')}
                     </Link>
                     <span data-heading="h1" className="text-subtle-foreground" aria-hidden>
                        /
                     </span>
                  </>
               )}
               <h1 className="m-0 truncate">{autopilot.name}</h1>
            </nav>
            {statePill}

            <div className="ml-auto flex shrink-0 items-center gap-2">
               {dirty ? (
                  <>
                     <span className="hidden text-subtle-foreground md:inline">
                        {te('unsaved')}
                     </span>
                     <Button type="button" variant="ghost" disabled={saving} onClick={discard}>
                        {te('discard')}
                     </Button>
                  </>
               ) : null}
               <Button
                  type="button"
                  variant="secondary"
                  disabled={busy || blocked !== null || !canEdit || archived}
                  title={blocked ? t(`detail.blocked_${blocked}`) : undefined}
                  onClick={() => void runNow()}
               >
                  <Play className="size-3" aria-hidden />
                  {t('detail.runNow')}
               </Button>
               {canEdit ? (
                  <DropdownMenu>
                     <DropdownMenuTrigger asChild>
                        <Button
                           type="button"
                           variant="secondary"
                           size="icon"
                           className="size-[30px]"
                           aria-label={t('row.menu')}
                           disabled={busy}
                        >
                           <MoreHorizontal className="size-4" aria-hidden />
                        </Button>
                     </DropdownMenuTrigger>
                     <DropdownMenuContent align="end" className="min-w-52">
                        {archived ? (
                           <DropdownMenuItem onClick={() => void restore()}>
                              <ArchiveRestore className="size-4" aria-hidden />
                              {t('row.restore')}
                           </DropdownMenuItem>
                        ) : (
                           <>
                              <DropdownMenuItem onClick={() => void duplicate()}>
                                 <Copy className="size-4" aria-hidden />
                                 {t('row.duplicate')}
                              </DropdownMenuItem>
                              <DropdownMenuItem disabled>
                                 <FileStack className="size-4" aria-hidden />
                                 {te('saveAsTemplate')}
                                 <span className="ml-auto">
                                    <SoonPill />
                                 </span>
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => void togglePaused()}>
                                 {paused ? (
                                    <Play className="size-4" aria-hidden />
                                 ) : (
                                    <Pause className="size-4" aria-hidden />
                                 )}
                                 {paused ? t('row.resume') : t('row.pause')}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                 className="text-status-danger focus:text-status-danger"
                                 onClick={() => setArchiving(true)}
                              >
                                 <Archive className="size-4" aria-hidden />
                                 {t('row.delete')}
                              </DropdownMenuItem>
                           </>
                        )}
                     </DropdownMenuContent>
                  </DropdownMenu>
               ) : (
                  <span className="text-muted-foreground">{t('row.locked')}</span>
               )}
               {editable ? (
                  <Button
                     type="button"
                     disabled={!dirty || !ready || saving}
                     title={dirty && !ready ? te('incomplete') : undefined}
                     onClick={() => void save()}
                  >
                     {saving ? te('saving') : te('save')}
                  </Button>
               ) : null}
            </div>
         </header>

         <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <div className="flex w-full flex-col gap-5">
               {blocked === 'noRuntime' ? (
                  <Banner tone="warning">
                     {t('detail.noRuntimeBanner', { name: assigneeName })}{' '}
                     <span className="text-muted-foreground">{t('detail.noRuntimeHint')}</span>{' '}
                     <Link
                        href={`/${orgId}/settings/runtimes`}
                        className="underline underline-offset-2"
                     >
                        {t('detail.runtimesLink')}
                     </Link>
                  </Banner>
               ) : null}
               {archived ? (
                  <Banner
                     tone="neutral"
                     action={
                        canEdit ? (
                           <Button
                              size="xs"
                              variant="secondary"
                              disabled={busy}
                              onClick={() => void restore()}
                           >
                              {t('row.restore')}
                           </Button>
                        ) : null
                     }
                  >
                     {t('detail.archivedBanner')}
                  </Banner>
               ) : null}

               <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] 2xl:grid-cols-[minmax(0,1fr)_24rem]">
                  <div className="flex min-w-0 flex-col gap-5">
                     <LoopEditorFields
                        draft={draft}
                        onPatch={patch}
                        editable={editable}
                        boards={boards}
                        coverage={coverage}
                        listensForEvents={listensForEvents}
                        trigger={
                           triggerDraft ? (
                              <TriggerEditor
                                 draft={triggerDraft}
                                 onChange={(next) => {
                                    setTouched(true);
                                    setTriggerDraft(next);
                                 }}
                                 disabled={!editable}
                                 autopilotId={autopilot.id}
                                 current={autopilot.triggers[0]}
                                 others={Math.max(0, autopilot.triggers.length - 1)}
                                 secrets={secrets}
                                 onSecrets={(next) => {
                                    setSecrets(next);
                                    reload();
                                 }}
                              />
                           ) : null
                        }
                     />
                  </div>

                  <div className="flex min-w-0 flex-col gap-5">
                     <RunHistory
                        runs={runs}
                        orgId={orgId}
                        all={allRuns}
                        onShowAll={() => setAllRuns(true)}
                     />

                     <SectionCard title={te('versions')} hint={te('versionsHint')}>
                        <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-2.5 border-t border-border/60 px-4 py-2.5">
                           <span className="font-medium">v{autopilot.version}</span>
                           <span className="flex min-w-0 flex-col">
                              <span className="truncate text-muted-foreground">
                                 {te('currentVersion')}
                              </span>
                              <span className="truncate text-subtle-foreground">
                                 {new Date(autopilot.updatedAt).toLocaleDateString()}
                              </span>
                           </span>
                           <span className="text-status-success">{te('live')}</span>
                        </div>
                        <p className="flex items-center gap-2 border-t border-border/60 px-4 py-2.5 text-subtle-foreground">
                           {te('versionHistory')}
                           <SoonPill />
                        </p>
                     </SectionCard>

                     <section
                        className="overflow-hidden rounded-[10px] bg-settings-group"
                        aria-label={te('details')}
                     >
                        <dl>
                           <Detail label={te('owner')}>{owner}</Detail>
                           <Detail label={t('detail.created')}>
                              {new Date(autopilot.createdAt).toLocaleDateString()}
                           </Detail>
                           <Detail label={te('runs7')}>
                              {autopilot.activity.failedLast7Days > 0
                                 ? te('runsFailed', {
                                      runs: autopilot.activity.runsLast7Days,
                                      failed: autopilot.activity.failedLast7Days,
                                   })
                                 : autopilot.activity.runsLast7Days}
                           </Detail>
                           <Detail label={te('credits30')}>
                              <span className="flex items-center gap-2">
                                 —<SoonPill />
                              </span>
                           </Detail>
                        </dl>
                     </section>
                  </div>
               </div>

               {listensForEvents ? (
                  <SectionCard title={t('detail.tabEvents')}>
                     <div className="border-t border-border/60">
                        <EventReceipts
                           autopilotId={autopilot.id}
                           orgId={orgId}
                           refresh={runs.length}
                        />
                     </div>
                  </SectionCard>
               ) : null}
               {autopilot.triggerKinds.includes('webhook') || deliveries.length > 0 ? (
                  <SectionCard title={t('detail.tabDeliveries')}>
                     <div className="border-t border-border/60">
                        <DeliveriesTable
                           autopilotId={autopilot.id}
                           deliveries={deliveries}
                           canReplay={canEdit}
                           onReplayed={reload}
                        />
                     </div>
                  </SectionCard>
               ) : null}
            </div>
         </div>

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
                              if (closeDrawer) closeDrawer();
                              else router.push(`/${orgId}/loops`);
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

function Banner({
   tone,
   action,
   children,
}: {
   tone: 'warning' | 'neutral';
   action?: ReactNode;
   children: ReactNode;
}) {
   return (
      <p
         role="status"
         className={cn(
            'flex flex-wrap items-center gap-2.5 rounded-[10px] px-3.5 py-2.5',
            tone === 'warning'
               ? 'border border-status-warning/40 bg-status-warning/10'
               : 'bg-settings-group text-muted-foreground'
         )}
      >
         {tone === 'warning' ? (
            <TriangleAlert className="size-4 shrink-0 text-status-warning" aria-hidden />
         ) : (
            <Archive className="size-4 shrink-0 text-subtle-foreground" aria-hidden />
         )}
         <span className="min-w-0 flex-1 text-pretty">{children}</span>
         {action}
      </p>
   );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
   return (
      <div className="flex h-[38px] items-center justify-between gap-3 border-t border-border/60 px-4 first:border-t-0">
         <dt className="text-subtle-foreground">{label}</dt>
         <dd className="truncate text-muted-foreground">{children}</dd>
      </div>
   );
}

/** What the Loop has done, newest first, each run one line that opens it. */
function RunHistory({
   runs,
   orgId,
   all,
   onShowAll,
}: {
   runs: AutopilotRun[];
   orgId: string;
   all: boolean;
   onShowAll: () => void;
}) {
   const te = useTranslations('loops.editor');
   const tState = useTranslations('loops.runState');
   const format = useFormatter();
   const shown = all ? runs : runs.slice(0, RUNS_SHOWN);

   return (
      <SectionCard
         title={te('runHistory')}
         hint={runs.length > 0 ? te('runCount', { count: runs.length }) : undefined}
      >
         {runs.length === 0 ? (
            <p className="border-t border-border/60 px-4 py-3.5 text-subtle-foreground">
               {te('noRuns')}
            </p>
         ) : (
            <ul>
               {shown.map((run) => {
                  const started = run.startedAt ?? run.createdAt;
                  const duration = run.completedAt
                     ? Date.parse(run.completedAt) - Date.parse(started)
                     : null;
                  const failed = run.state === 'failed' || run.state === 'timed_out';
                  const detail =
                     run.summary ?? (run.reasonCode ? describeReason(run.reasonCode) : null);
                  return (
                     <li key={run.id} className="border-t border-border/60">
                        <Link
                           href={`/${orgId}/loop/${run.autopilotId}/runs/${run.id}`}
                           className="grid grid-cols-[6px_minmax(0,1fr)_auto] items-center gap-2.5 px-4 py-2.5 hover:bg-settings-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
                        >
                           <span
                              className={cn('size-1.5 rounded-full', RUN_DOT[run.state])}
                              aria-hidden
                           />
                           <span className="flex min-w-0 flex-col gap-px">
                              <span
                                 className={cn(
                                    'truncate',
                                    failed ? 'text-status-danger' : 'text-foreground'
                                 )}
                              >
                                 {tState(run.state)}
                                 {detail ? (
                                    <span className="text-muted-foreground"> · {detail}</span>
                                 ) : null}
                              </span>
                              <time
                                 className="text-subtle-foreground"
                                 dateTime={run.createdAt}
                                 title={new Date(run.createdAt).toLocaleString()}
                              >
                                 {format.relativeTime(new Date(run.createdAt))}
                              </time>
                           </span>
                           <span className="tabular-nums text-subtle-foreground">
                              {duration !== null ? formatDuration(duration) : ''}
                           </span>
                        </Link>
                     </li>
                  );
               })}
            </ul>
         )}
         {!all && runs.length > RUNS_SHOWN ? (
            <button
               type="button"
               onClick={onShowAll}
               className="w-full border-t border-border/60 px-4 py-2.5 text-left text-muted-foreground hover:bg-settings-row-hover hover:text-foreground"
            >
               {te('showAllRuns', { count: runs.length })}
            </button>
         ) : null}
         {runs.length > 0 ? (
            <p className="flex items-center gap-2 border-t border-border/60 px-4 py-2.5 text-subtle-foreground">
               {te('askAboutRun')}
               <SoonPill />
            </p>
         ) : null}
      </SectionCard>
   );
}
