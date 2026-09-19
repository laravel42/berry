'use client';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { BerryApiError } from '@/lib/api';
import {
   execInPreview,
   fixPreviewEnvironment,
   isStarting,
   loadPreviewEnvironment,
   startPreviewEnvironment,
   stopPreviewEnvironment,
   type PreviewEnvironment,
} from '@/lib/preview-environment';
import {
   getRun,
   isTerminalRunEvent,
   isTerminalRunStatus,
   streamRunEvents,
   textFromRunEvent,
} from '@/lib/runs';
import { cn } from '@/lib/utils';
import { ExternalLink, Hammer, PanelBottom, RotateCw, Sparkles, Square } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PreviewPanel, type PanelAction } from './preview-panel';

const TOOL =
   'size-7 cursor-pointer border-muted-foreground/15 bg-muted/40 p-0 shadow-none hover:bg-muted';

function ToolTip({ label, children }: { label: string; children: ReactNode }) {
   return (
      <Tooltip>
         <TooltipTrigger asChild>
            <span className="inline-flex">{children}</span>
         </TooltipTrigger>
         <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
   );
}

/**
 * A task's pull request, running: its apps and the services they need, started
 * on the server and shown here at an address of its own. While it starts, the
 * log takes the pane — install, build, migrate, start — so a wait is never a
 * blank. A project with more than one app (a site and its API) gets a switch.
 */
export function EnvironmentPreview({
   issueRef,
   toolbarSlot,
}: {
   issueRef: string;
   /**
    * Where the page has room for the preview's buttons: the end of its own tab
    * bar. With one, the preview draws no bar of its own; without, it keeps one
    * so it still works on a page that offers none.
    */
   toolbarSlot?: HTMLElement | null;
}) {
   const t = useTranslations('issueDetail.environmentPreview');
   const [env, setEnv] = useState<PreviewEnvironment | null>(null);
   const [failed, setFailed] = useState(false);
   const [reload, setReload] = useState(0);
   // The terminal over a running app: open until the person closes it.
   const [terminalOpen, setTerminalOpen] = useState(true);
   // Stopped by the person, so looking at the tab does not start it again behind them.
   const stopped = useRef(false);
   // "Fix with AI": the run an agent is fixing the failure in, then how it ended.
   // What the fixing agent says and runs, as it happens, continuing the log the failure is in.
   const [fixLog, setFixLog] = useState('');
   const [fix, setFix] = useState<{
      runId: string | null;
      phase: 'asking' | 'working' | 'failed';
      note?: string;
   } | null>(null);

   const start = useCallback(
      (force: boolean) => {
         stopped.current = false;
         setFailed(false);
         // A new start is a new log; the fix that led to it has done its work.
         setFixLog('');
         startPreviewEnvironment(issueRef, { force })
            .then(setEnv)
            .catch(() => setFailed(true));
      },
      [issueRef]
   );

   // Opening the tab is asking for the preview: start it unless it is already there.
   useEffect(() => {
      let cancelled = false;
      stopped.current = false;
      setEnv(null);
      loadPreviewEnvironment(issueRef)
         .then((current) => {
            if (cancelled) return;
            setEnv(current);
            if (current.available && current.previewable && current.state === 'idle') start(false);
         })
         .catch(() => !cancelled && setFailed(true));
      return () => {
         cancelled = true;
      };
   }, [issueRef, start]);

   // Quickly while it starts; slowly once it runs, which also tells the server someone is still looking.
   const state = env?.state;
   useEffect(() => {
      if (!state || state === 'idle' || state === 'failed' || state === 'unavailable') return;
      const timer = setInterval(
         () => {
            loadPreviewEnvironment(issueRef)
               .then((current) => {
                  // Reaped while idle, or the server restarted: bring it back unless it was stopped here.
                  if (current.state === 'idle' && !stopped.current && current.previewable)
                     start(false);
                  else setEnv(current);
               })
               .catch(() => undefined);
         },
         // Slowly once it runs — unless the terminal is open, where a server's output is watched as it happens.
         isStarting(state) ? 1500 : terminalOpen ? 2000 : 30_000
      );
      return () => clearInterval(timer);
   }, [issueRef, state, start, terminalOpen]);

   const logText = `${env?.log ?? ''}${fix !== null || fixLog !== '' ? `\n──── ${t('fixLogHeading')} ────\n` : ''}${fixLog}`;

   const fixWithAi = () => {
      setFixLog('');
      setFix({ runId: null, phase: 'asking' });
      fixPreviewEnvironment(issueRef)
         .then(({ runId }) => setFix({ runId, phase: 'working' }))
         .catch((error: unknown) =>
            setFix({
               runId: null,
               phase: 'failed',
               note: error instanceof BerryApiError ? error.message : t('fixNotStarted'),
            })
         );
   };

   // The fix is a run on the task. When it ends well its commit is on the
   // branch, so the preview is started again from there; otherwise say so and
   // leave the log where it was.
   const fixRunId = fix?.phase === 'working' ? fix.runId : null;
   useEffect(() => {
      if (!fixRunId) return;
      const timer = setInterval(() => {
         getRun(fixRunId)
            .then((run) => {
               if (!isTerminalRunStatus(run.status)) return;
               if (run.status === 'succeeded') {
                  setFix(null);
                  start(true);
               } else {
                  setFix({ runId: fixRunId, phase: 'failed', note: t('fixRunFailed') });
               }
            })
            .catch(() => undefined);
      }, 3000);
      return () => clearInterval(timer);
   }, [fixRunId, start, t]);

   // The agent's run, tailed into the log: its words, each command and its
   // output. The poll above still decides when it is over — a stream can drop,
   // and a dropped stream must not leave the tab waiting for ever — but a
   // terminal event here ends the wait at once.
   useEffect(() => {
      if (!fixRunId) return;
      const abort = new AbortController();
      (async () => {
         for await (const event of streamRunEvents(fixRunId, abort.signal)) {
            const text = textFromRunEvent(event);
            if (text) setFixLog((current) => (current + text).slice(-60_000));
            if (isTerminalRunEvent(event.type)) break;
         }
      })().catch(() => undefined);
      return () => abort.abort();
   }, [fixRunId]);

   // A different task is a different failure.
   useEffect(() => {
      setFix(null);
      setFixLog('');
   }, [issueRef]);

   const apps = env?.plan?.apps ?? [];
   // The app a person looks at: the plan's primary one. The others (an API beside
   // a site) are reached through it, and their output is in the panel's Terminal.
   const shown = apps.find((candidate) => candidate.primary) ?? null;
   const ready = env?.state === 'ready' && shown?.ready === true;

   const stop = () => {
      stopped.current = true;
      stopPreviewEnvironment(issueRef)
         .then(() => loadPreviewEnvironment(issueRef))
         .then(setEnv)
         .catch(() => undefined);
   };

   // Ctrl+` shows and hides the panel, as it does in an editor.
   useEffect(() => {
      const onKey = (event: globalThis.KeyboardEvent) => {
         if (event.ctrlKey && event.key === '`') {
            event.preventDefault();
            setTerminalOpen((open) => !open);
         }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
   }, []);

   const onPanelAction = (action: PanelAction) => {
      if (action === 'rebuild') start(true);
      else if (action === 'start') start(false);
      else if (action === 'stop') stop();
      else if (action === 'fix') fixWithAi();
      else if (shown) window.open(shown.url, '_blank', 'noreferrer');
   };

   const panel = (
      <PreviewPanel
         log={logText}
         // Services first, as they start; a service has no address to answer at, so it has no ready mark.
         processes={[
            ...(env?.plan?.services ?? []).map((name) => ({ name, ready: null, workdir: null })),
            ...apps.map((candidate) => ({
               name: candidate.name,
               ready: candidate.ready,
               // A shell opens at the top of the checkout. An app has one; a service does not.
               workdir: env?.plan?.root ?? (candidate.workdir ? '/work' : null),
            })),
         ]}
         issueRef={issueRef}
         host={issueRef.toLowerCase()}
         status={t('panel.statusLine', {
            state: env?.state ?? 'idle',
            commit: env?.commit?.slice(0, 7) ?? '-',
            apps:
               apps
                  .map((candidate) => `${candidate.name}${candidate.ready ? ' ✓' : ' …'}`)
                  .join(', ') || '-',
         })}
         running={ready}
         // Containers exist from the moment it starts; a shell is as useful for a build that hangs as for a server that runs.
         {...(state === 'ready' || state === 'starting'
            ? { onExec: (input, options) => execInPreview(issueRef, input, options) }
            : {})}
         onAction={onPanelAction}
         onClose={() => setTerminalOpen(false)}
      />
   );

   let notice: string | null = null;
   if (failed) notice = t('loadFailed');
   else if (!env) notice = t('loading');
   else if (!env.available) notice = t('unavailableHere');
   else if (!env.previewable) notice = t('nothingYet');
   else if (env.state === 'idle') notice = stopped.current ? t('stopped') : t('loading');

   // There is output to show from the moment a preview has been asked for.
   const panelAvailable = notice === null;

   const tools = (
      <>
         {ready && shown && (
            <ToolTip label={t('open')}>
               <Button asChild variant="outline" size="xs" className={TOOL} aria-label={t('open')}>
                  <a href={shown.url} target="_blank" rel="noreferrer">
                     <ExternalLink className="size-3.5" aria-hidden />
                  </a>
               </Button>
            </ToolTip>
         )}
         <ToolTip label={t('panel.toggle')}>
            <Button
               variant="outline"
               size="xs"
               className={cn(TOOL, terminalOpen && panelAvailable && 'bg-muted')}
               aria-label={t('panel.toggle')}
               disabled={!panelAvailable}
               onClick={() => setTerminalOpen((open) => !open)}
            >
               <PanelBottom className="size-3.5" aria-hidden />
            </Button>
         </ToolTip>
         <ToolTip label={t('reload')}>
            <Button
               variant="outline"
               size="xs"
               className={TOOL}
               aria-label={t('reload')}
               disabled={!ready}
               onClick={() => setReload((value) => value + 1)}
            >
               <RotateCw className="size-3.5" aria-hidden />
            </Button>
         </ToolTip>
         <ToolTip label={t('rebuild')}>
            <Button
               variant="outline"
               size="xs"
               className={TOOL}
               aria-label={t('rebuild')}
               disabled={!env?.previewable || (state !== undefined && isStarting(state))}
               onClick={() => start(true)}
            >
               <Hammer className="size-3.5" aria-hidden />
            </Button>
         </ToolTip>
         <ToolTip label={t('stop')}>
            <Button
               variant="outline"
               size="xs"
               className={TOOL}
               aria-label={t('stop')}
               disabled={!state || state === 'idle'}
               onClick={stop}
            >
               <Square className="size-3.5" aria-hidden />
            </Button>
         </ToolTip>
      </>
   );

   return (
      <div className="flex size-full min-h-0 flex-col">
         {/* No bar of its own under the page's: its buttons sit in the page's bar. */}
         {toolbarSlot ? (
            createPortal(tools, toolbarSlot)
         ) : (
            <div className="flex items-center justify-end gap-2 border-b px-4 py-1.5">{tools}</div>
         )}
         {/* One pane for every state: what there is to look at above, the panel
             docked at its foot. The panel keeps its place, its tab and its
             session while the preview goes from building to running. */}
         <div className="relative flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-auto">
               {notice ? (
                  <div className="flex flex-col items-start gap-3 p-6 text-muted-foreground">
                     <p>{notice}</p>
                     {env?.state === 'idle' && env.previewable && stopped.current && (
                        <Button size="xs" variant="outline" onClick={() => start(false)}>
                           {t('start')}
                        </Button>
                     )}
                  </div>
               ) : ready && shown ? (
                  <iframe
                     key={`${shown.url}#${reload}`}
                     src={shown.url}
                     title={t('title', { app: shown.name })}
                     className="size-full border-0 bg-white"
                     allow="clipboard-write"
                  />
               ) : (
                  // Building, or failed: where it stands, and the way out. The output is in the panel below.
                  <div className="flex size-full flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
                     <p className="max-w-prose">
                        {fix?.phase === 'working' || fix?.phase === 'asking'
                           ? t('fixing')
                           : (fix?.note ??
                             (env?.state === 'failed' || env?.state === 'unavailable'
                                ? (env.message ?? t('failed'))
                                : env?.state === 'fetching'
                                  ? t('fetching')
                                  : t('starting')))}
                     </p>
                     {(env?.state === 'failed' || env?.state === 'unavailable') && (
                        <Button
                           size="xs"
                           className="shrink-0 cursor-pointer gap-1.5"
                           disabled={fix?.phase === 'asking' || fix?.phase === 'working'}
                           onClick={fixWithAi}
                           title={t('fixHint')}
                        >
                           <Sparkles className="size-3.5" aria-hidden />
                           {fix?.phase === 'working' || fix?.phase === 'asking'
                              ? t('fixingShort')
                              : t('fix')}
                        </Button>
                     )}
                  </div>
               )}
            </div>
            {panelAvailable && terminalOpen && panel}
         </div>
      </div>
   );
}
