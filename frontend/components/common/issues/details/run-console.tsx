'use client';

import { BerryMark } from '@/components/brand/berry-mark';
import { isAgentUser } from '@/components/common/issues/actor-avatar';
import { RunTranscript } from '@/components/common/runs/transcript-dialog';
import { RuntimeSelectionControl } from '@/components/common/runtimes/runtime-selection';
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
   DropdownMenuRadioGroup,
   DropdownMenuRadioItem,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BerryApiError } from '@/lib/api';
import {
   cancelRun,
   formatRunDuration,
   isReviewGateRun,
   isTerminalRunStatus,
   restartIssueRun,
   type RunRecord,
} from '@/lib/runs';
import { cn } from '@/lib/utils';
import { useAgentsStore } from '@/store/agents-store';
import { useIssueRuns, useIssueRunsStore } from '@/store/issue-runs-store';
import { useIssuesStore } from '@/store/issues-store';
import { useRunConsoleStore } from '@/store/run-console-store';
import { ChevronDown, History, ListFilter, RotateCcw, SquareTerminal } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { markTone, runConsoleTabLabel, RunTab, statusTone, useRunDuration } from './run-entry';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** Board states where an idle agent task can be started again. */
const RESTARTABLE_STATUSES = new Set(['to-do', 'in-progress']);

/** Folded Restart/Console sit on the task pane, flush to its right edge. */
function FoldedRunActions({ children }: { children: ReactNode }) {
   return (
      <div className="pointer-events-none absolute inset-0 z-20">
         <div className="pointer-events-auto absolute right-4 bottom-3 flex items-center justify-end gap-2">
            {children}
         </div>
      </div>
   );
}

/**
 * The task's console, docked at the foot of the drawer like the build
 * terminal: a run's transcript beside the work it produced. It follows the
 * live agent run, or the latest one when nothing is running. Past runs open
 * from the history control as a list. AutoGate reviews are not listed here:
 * they sit on the task's activity with their transcript.
 * It stays folded when the task opens. The floating button opens it, and a
 * person's own toggle wins after that. Open, it covers the full drawer.
 */
export function RunConsole({ issueId }: { issueId: string }) {
   const t = useTranslations('issueDetail.console');
   const getAgentById = useAgentsStore((state) => state.getAgentById);
   const { runs, activeRun, upsert } = useIssueRuns(issueId);
   const workRuns = runs.filter((entry) => !isReviewGateRun(entry));
   const workActive = workRuns.find((entry) => !isTerminalRunStatus(entry.status)) ?? null;
   // A run starting or ending moves the task, and the board stream brings the
   // task's change here: the run list is read again then, so a run started
   // while the page was open gets its tab without a reload.
   const issue = useIssuesStore(
      (state) => state.issues.find((entry) => entry.id === issueId) ?? null
   );
   const taskStamp = issue ? `${issue.status.id}|${issue.updatedAt ?? ''}` : null;
   const reloadRuns = useIssueRunsStore((state) => state.load);
   useEffect(() => {
      if (taskStamp) reloadRuns(issueId);
   }, [taskStamp, issueId, reloadRuns]);
   const chosen = useRunConsoleStore((state) => state.chosen[issueId] ?? null);
   const request = useRunConsoleStore((state) => state.request);
   const follow = useRunConsoleStore((state) => state.follow);
   const show = useRunConsoleStore((state) => state.show);
   const [toggled, setToggled] = useState<boolean | null>(null);
   const [filtersOpen, setFiltersOpen] = useState(false);
   const [filtersActive, setFiltersActive] = useState(false);
   const [confirmingStop, setConfirmingStop] = useState(false);
   const [stopping, setStopping] = useState(false);
   const [restarting, setRestarting] = useState(false);
   const bodyId = useId();
   const strip = useRef<HTMLDivElement>(null);

   // A transcript button elsewhere on the task asked for a run: open.
   const seen = useRef(request);
   useEffect(() => {
      if (request === seen.current) return;
      seen.current = request;
      setToggled(true);
   }, [request]);

   const picked = chosen ? (workRuns.find((entry) => entry.id === chosen) ?? null) : null;
   const run: RunRecord | null = picked ?? workActive ?? workRuns[0] ?? null;
   const canRestart = Boolean(
      issue?.assignee &&
      isAgentUser(issue.assignee) &&
      RESTARTABLE_STATUSES.has(issue.status.id) &&
      !activeRun
   );

   // An idle agent task starts again from the work already saved, or from
   // scratch when it has never run. A queued or running task is left alone.
   const restart = async () => {
      setRestarting(true);
      try {
         const next = await restartIssueRun(issueId);
         upsert(next);
         follow(issueId);
         toast.success(t('restarted'));
      } catch (error) {
         toast.error(error instanceof BerryApiError ? error.message : t('restartFailed'));
      } finally {
         setRestarting(false);
      }
   };

   const shownId = run?.id ?? null;
   useEffect(() => {
      if (!shownId) return;
      document
         .getElementById(`run-tab-${shownId}`)
         ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
   }, [shownId]);
   // The history menu is the same width as the run tab it lists.
   const [menuWidth, setMenuWidth] = useState<number | null>(null);
   useLayoutEffect(() => {
      if (!shownId) return;
      const tab = document.getElementById(`run-tab-${shownId}`);
      if (!tab) return;
      const apply = () => setMenuWidth(Math.round(tab.getBoundingClientRect().width));
      apply();
      const observer = new ResizeObserver(apply);
      observer.observe(tab);
      return () => observer.disconnect();
   }, [shownId]);

   if (!run) {
      if (!canRestart) return null;
      return (
         <FoldedRunActions>
            <RuntimeSelectionControl
               target={{ kind: 'issue', id: issueId }}
               disabled={restarting}
            />
            <Button
               variant="outline"
               size="sm"
               disabled={restarting}
               onClick={() => void restart()}
               className="gap-1.5 rounded-full border-transparent bg-berry text-chalk shadow-sm hover:bg-berry hover:text-chalk hover:brightness-110"
            >
               <RotateCcw className="size-4" aria-hidden />
               {t('restart')}
            </Button>
         </FoldedRunActions>
      );
   }

   const nameOf = (entry: RunRecord) => getAgentById(entry.agentId)?.name ?? t('agent');
   const live = !isTerminalRunStatus(run.status);
   const open = toggled === true;

   const current = workActive ?? workRuns[0] ?? null;
   const past = workRuns.filter((entry) => entry.id !== current?.id);
   const ordered = [...workRuns].reverse();
   const tabs = [run];

   // Stopping a live run: what it already did stays; asked first, as a stop cannot be taken back.
   const stop = async (target: RunRecord) => {
      setStopping(true);
      try {
         upsert(await cancelRun(target.id));
         toast.success(t('stopped'));
         setConfirmingStop(false);
      } catch (error) {
         toast.error(error instanceof BerryApiError ? error.message : t('stopFailed'));
      } finally {
         setStopping(false);
      }
   };

   // Folded, the console is a button floating at the bottom right of the task,
   // over its last lines: it takes no room until it is asked for.
   if (!open) {
      return (
         <FoldedRunActions>
            {canRestart ? (
               <Button
                  variant="outline"
                  size="sm"
                  disabled={restarting}
                  onClick={() => void restart()}
                  className="gap-1.5 rounded-full border-transparent bg-berry text-chalk shadow-sm hover:bg-berry hover:text-chalk hover:brightness-110"
               >
                  <RotateCcw className="size-4" aria-hidden />
                  {t('restart')}
               </Button>
            ) : null}
            <Button
               variant="outline"
               size="sm"
               aria-expanded={false}
               onClick={() => {
                  // Opened by hand, the console starts on the latest run, not
                  // on one picked before it was folded.
                  follow(issueId);
                  setToggled(true);
               }}
               className="gap-1.5 rounded-full border-status-neutral/40 bg-container text-status-neutral shadow-sm hover:bg-muted hover:text-status-neutral focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
               <SquareTerminal className="size-4" aria-hidden />
               {t('title')}
               {live ? <BerryMark size="sm" tone="working" pulse label={nameOf(run)} /> : null}
            </Button>
         </FoldedRunActions>
      );
   }

   const actionClass = 'shrink-0 text-muted-foreground hover:bg-muted hover:text-foreground';

   return (
      <section className="absolute inset-0 z-30 flex flex-col bg-container" aria-label={t('title')}>
         <div
            id={bodyId}
            role="tabpanel"
            aria-labelledby={`run-tab-${run.id}`}
            className="flex min-h-0 flex-1 flex-col"
         >
            <RunTranscript
               key={run.id}
               runId={run.id}
               className="min-h-0 flex-1"
               order="oldest-first"
               paged
               filtersOpen={filtersOpen}
               onFiltersOpenChange={setFiltersOpen}
               onFiltersActiveChange={setFiltersActive}
               onRunLoaded={upsert}
               listClassName="bg-muted font-thin [&_*]:font-thin"
            />
         </div>
         <div className="flex min-h-8 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-t px-2 py-1 text-muted-foreground">
            <div
               ref={strip}
               role="tablist"
               aria-label={t('pick')}
               className="flex h-7 min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]"
               onKeyDown={(event) => {
                  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                  event.preventDefault();
                  const index = tabs.findIndex((entry) => entry.id === run.id);
                  const next = tabs[index + (event.key === 'ArrowRight' ? 1 : -1)];
                  if (!next) return;
                  show(issueId, next.id);
                  document.getElementById(`run-tab-${next.id}`)?.focus();
               }}
            >
               {tabs.map((entry) => (
                  <RunTab
                     key={entry.id}
                     run={entry}
                     runs={ordered}
                     selected={entry.id === run.id}
                     panelId={bodyId}
                     onSelect={() => show(issueId, entry.id)}
                  />
               ))}
            </div>
            {current && run.id !== current.id ? (
               <Button
                  variant="ghost"
                  size="xs"
                  className={actionClass}
                  onClick={() => follow(issueId)}
               >
                  {workActive ? t('followLive') : t('currentRun')}
               </Button>
            ) : null}
            {canRestart ? (
               <Button
                  variant="ghost"
                  size="xs"
                  className="shrink-0 text-berry hover:bg-berry/15 hover:text-berry"
                  disabled={restarting}
                  onClick={() => void restart()}
               >
                  <RotateCcw className="size-3.5" aria-hidden />
                  {t('restart')}
               </Button>
            ) : null}
            {live ? (
               <Button
                  variant="ghost"
                  size="xs"
                  className="shrink-0 text-muted-foreground hover:bg-muted hover:text-status-danger"
                  disabled={stopping}
                  onClick={() => setConfirmingStop(true)}
               >
                  <span className="size-3.5 shrink-0 bg-berry" aria-hidden />
                  {t('stop')}
               </Button>
            ) : null}
            {live ? <span aria-hidden className="h-3 w-px shrink-0 bg-current opacity-30" /> : null}
            {past.length > 0 ? (
               <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                     <Button
                        variant="ghost"
                        size="xxs"
                        className={cn('size-6 px-0', actionClass)}
                        aria-pressed={run.id !== current?.id}
                        title={t('history')}
                     >
                        <History className="size-4" aria-hidden />
                        <span className="sr-only">{t('history')}</span>
                     </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                     align="end"
                     className="min-w-0 p-0"
                     style={menuWidth === null ? undefined : { width: menuWidth }}
                  >
                     <div className="max-h-64 overflow-y-auto p-1">
                        <DropdownMenuRadioGroup
                           value={run.id}
                           onValueChange={(id) => show(issueId, id)}
                        >
                           {past.map((entry) => (
                              <DropdownMenuRadioItem
                                 key={entry.id}
                                 value={entry.id}
                                 className="gap-1.5 px-3 data-[state=checked]:bg-accent [&>span:first-child]:hidden"
                              >
                                 <PastRunChoice run={entry} runs={ordered} />
                              </DropdownMenuRadioItem>
                           ))}
                        </DropdownMenuRadioGroup>
                     </div>
                  </DropdownMenuContent>
               </DropdownMenu>
            ) : null}
            <Button
               variant="ghost"
               size="xxs"
               className={cn('relative size-6 px-0', actionClass)}
               aria-pressed={filtersOpen}
               title={filtersOpen ? t('hideFilters') : t('showFilters')}
               onClick={() => setFiltersOpen((value) => !value)}
            >
               <ListFilter className="size-4" aria-hidden />
               <span className="sr-only">{filtersOpen ? t('hideFilters') : t('showFilters')}</span>
               {!filtersOpen && filtersActive ? (
                  <span
                     className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-status-info"
                     aria-label={t('filtersApplied')}
                  />
               ) : null}
            </Button>
            <Button
               variant="ghost"
               size="xxs"
               className={cn('size-6 px-0', actionClass)}
               aria-expanded
               aria-controls={bodyId}
               title={t('collapse')}
               onClick={() => setToggled(false)}
            >
               <ChevronDown className="size-4" aria-hidden />
               <span className="sr-only">{t('collapse')}</span>
            </Button>
         </div>
         <AlertDialog open={confirmingStop} onOpenChange={setConfirmingStop}>
            <AlertDialogContent>
               <AlertDialogHeader>
                  <AlertDialogTitle>{t('stopTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>
                     {t('stopBody', { name: nameOf(run) })}
                  </AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
                  <AlertDialogCancel disabled={stopping}>{t('keepRunning')}</AlertDialogCancel>
                  <AlertDialogAction
                     disabled={stopping}
                     onClick={(event) => {
                        event.preventDefault();
                        void stop(run);
                     }}
                  >
                     {t('stopConfirm')}
                  </AlertDialogAction>
               </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>
      </section>
   );
}

/** One past run in the history list: its place, and how long it took. */
function PastRunChoice({ run, runs }: { run: RunRecord; runs: readonly RunRecord[] }) {
   const t = useTranslations('issueDetail.log');
   const duration = useRunDuration(run);
   return (
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
         <BerryMark size="sm" tone={markTone(run.status)} label={run.status} />
         <span className="shrink-0">
            {runConsoleTabLabel(run, runs, {
               run: (n) => t('tab', { n }),
               review: t('tabReview'),
               reviewN: (n) => t('tabReviewN', { n }),
            })}
         </span>
         <span aria-hidden className="h-3 w-px shrink-0 bg-current opacity-30" />
         <span className={cn('shrink-0 tabular-nums', statusTone(run.status))}>
            {formatRunDuration(duration)}
         </span>
      </span>
   );
}
