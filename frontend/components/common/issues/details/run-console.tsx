'use client';

import { BerryMark } from '@/components/brand/berry-mark';
import { RunTranscript } from '@/components/common/runs/transcript-dialog';
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
import { BerryApiError } from '@/lib/api';
import { cancelRun, isTerminalRunStatus, type RunRecord } from '@/lib/runs';
import { cn } from '@/lib/utils';
import { useAgentsStore } from '@/store/agents-store';
import { useIssueRuns, useIssueRunsStore } from '@/store/issue-runs-store';
import { useIssuesStore } from '@/store/issues-store';
import { useRunConsoleStore } from '@/store/run-console-store';
import { ChevronDown, ListFilter, Square, SquareTerminal } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { RunSummary, RunTab } from './run-entry';
import { useEffect, useId, useRef, useState } from 'react';

/**
 * The task's console, docked at the foot of the drawer like the build
 * terminal: a run's transcript beside the work it produced. It follows the
 * live run, or the latest one when nothing is running, until a person picks
 * another from its list or from a run's transcript button; Follow returns it
 * to the live one. Open while a run is producing output, folded to its bar
 * while it is only queued or while the task still has no comment from an
 * agent, and a person's own toggle wins either way.
 */
export function RunConsole({ issueId, cover = true }: { issueId: string; cover?: boolean }) {
   const t = useTranslations('issueDetail.console');
   const getAgentById = useAgentsStore((state) => state.getAgentById);
   const { runs, activeRun, upsert } = useIssueRuns(issueId);
   // A run starting or ending moves the task, and the board stream brings the
   // task's change here: the run list is read again then, so a run started
   // while the page was open gets its tab without a reload.
   const taskStamp = useIssuesStore((state) => {
      const issue = state.issues.find((entry) => entry.id === issueId);
      return issue ? `${issue.status.id}|${issue.updatedAt ?? ''}` : null;
   });
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
   const bodyId = useId();
   const strip = useRef<HTMLDivElement>(null);

   // A transcript button elsewhere on the task asked for a run: open.
   const seen = useRef(request);
   useEffect(() => {
      if (request === seen.current) return;
      seen.current = request;
      setToggled(true);
   }, [request]);

   const picked = chosen ? (runs.find((run) => run.id === chosen) ?? null) : null;
   const run: RunRecord | null = picked ?? activeRun ?? runs[0] ?? null;
   // A new live run clears a fold from the previous one. Opening still waits
   // until that run is going: a queued run has no transcript, and an empty
   // console would cover the task. A task with no agent comment stays
   // uncovered too, so those comments remain the thing on the page.
   const liveRunId = activeRun?.id ?? null;
   useEffect(() => {
      if (liveRunId) setToggled(null);
   }, [liveRunId]);

   const shownId =
      (chosen ? runs.find((entry) => entry.id === chosen) : null)?.id ??
      activeRun?.id ??
      runs[0]?.id ??
      null;
   useEffect(() => {
      if (!shownId) return;
      document
         .getElementById(`run-tab-${shownId}`)
         ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
   }, [shownId]);

   if (!run) return null;

   const nameOf = (entry: RunRecord) => getAgentById(entry.agentId)?.name ?? t('agent');
   const live = !isTerminalRunStatus(run.status);
   const open = toggled ?? (run.status === 'running' && cover);

   const tabs = [...runs].reverse();

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
         <div className="pointer-events-none relative z-20 h-0 shrink-0">
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
               className="pointer-events-auto absolute right-4 bottom-3 gap-1.5 rounded-full border-status-neutral/40 bg-container text-status-neutral shadow-sm hover:bg-muted hover:text-status-neutral focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
               <SquareTerminal className="size-4" aria-hidden />
               {t('title')}
               {live ? <BerryMark size="sm" tone="working" pulse label={nameOf(run)} /> : null}
            </Button>
         </div>
      );
   }

   return (
      // Open, the console takes the task's whole column: the transcript is the
      // thing being read, and folding it gives the task back.
      <section className="absolute inset-0 z-30 flex flex-col bg-container" aria-label={t('title')}>
         {/* The run tabs, in the AutoGate button's grey rather than the page's. */}
         <div
            className={cn(
               'flex h-8 min-w-0 items-center gap-2 bg-status-neutral/10 pr-2 text-status-neutral',
               open && 'border-b'
            )}
         >
            {/* Oldest to newest, left to right, as the transcript reads top to
                bottom; the strip scrolls sideways and keeps the shown run in view. */}
            <div
               ref={strip}
               role="tablist"
               aria-label={t('pick')}
               className="flex min-w-0 flex-1 self-stretch overflow-x-auto [scrollbar-width:none]"
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
               {tabs.map((entry, index) => (
                  <RunTab
                     key={entry.id}
                     run={entry}
                     ordinal={index + 1}
                     selected={entry.id === run.id}
                     panelId={bodyId}
                     onSelect={() => show(issueId, entry.id)}
                  />
               ))}
            </div>
            {picked && activeRun && picked.id !== activeRun.id ? (
               <Button
                  variant="ghost"
                  size="xs"
                  className={cn(
                     'shrink-0',
                     'text-status-neutral hover:bg-status-neutral/15 hover:text-status-neutral'
                  )}
                  onClick={() => follow(issueId)}
               >
                  {t('followLive')}
               </Button>
            ) : null}
            {live ? (
               <Button
                  variant="ghost"
                  size="xs"
                  className="shrink-0 text-status-neutral hover:bg-status-neutral/15 hover:text-status-danger"
                  disabled={stopping}
                  onClick={() => setConfirmingStop(true)}
               >
                  <Square className="size-3.5" aria-hidden />
                  {t('stop')}
               </Button>
            ) : null}
            {/* The console's own controls, at the end of its tabs: search and
                filter the log, and fold the console back into its button. */}
            <Button
               variant="ghost"
               size="xxs"
               className="relative size-6 shrink-0 px-0 text-status-neutral hover:bg-status-neutral/15 hover:text-status-neutral"
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
               className="size-6 shrink-0 px-0 text-status-neutral hover:bg-status-neutral/15 hover:text-status-neutral"
               aria-expanded
               aria-controls={bodyId}
               title={t('collapse')}
               onClick={() => setToggled(false)}
            >
               <ChevronDown className="size-4" aria-hidden />
               <span className="sr-only">{t('collapse')}</span>
            </Button>
         </div>
         {open ? (
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
                  filtersOpen={filtersOpen}
                  onFiltersOpenChange={setFiltersOpen}
                  onFiltersActiveChange={setFiltersActive}
                  onRunLoaded={upsert}
                  // The shown run in full, in the one bar: status, agent, why it
                  // ran, how long and when.
                  footerInfo={
                     <span className="flex min-w-0 flex-1 basis-64 items-center gap-2">
                        <RunSummary run={run} />
                     </span>
                  }
                  // The log on the secondary surface, a step off the page, so the
                  // console's body reads apart from the task around it.
                  listClassName="bg-muted"
               />
            </div>
         ) : null}
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
