'use client';

import { Button } from '@/components/ui/button';
import {
   isStarting,
   loadPreviewEnvironment,
   startPreviewEnvironment,
   stopPreviewEnvironment,
   type PreviewEnvironment,
} from '@/lib/preview-environment';
import { cn } from '@/lib/utils';
import { ExternalLink, Hammer, RotateCw, Square } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

const TOOL =
   'size-7 cursor-pointer border-muted-foreground/15 bg-muted/40 p-0 shadow-none hover:bg-muted';

/**
 * A task's pull request, running: its apps and the services they need, started
 * on the server and shown here at an address of its own. While it starts, the
 * log takes the pane — install, build, migrate, start — so a wait is never a
 * blank. A project with more than one app (a site and its API) gets a switch.
 */
export function EnvironmentPreview({ issueRef }: { issueRef: string }) {
   const t = useTranslations('issueDetail.environmentPreview');
   const [env, setEnv] = useState<PreviewEnvironment | null>(null);
   const [failed, setFailed] = useState(false);
   const [app, setApp] = useState<string | null>(null);
   const [reload, setReload] = useState(0);
   const log = useRef<HTMLPreElement>(null);
   // Stopped by the person, so looking at the tab does not start it again behind them.
   const stopped = useRef(false);

   const start = useCallback(
      (force: boolean) => {
         stopped.current = false;
         setFailed(false);
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
      setApp(null);
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
         isStarting(state) ? 1500 : 30_000
      );
      return () => clearInterval(timer);
   }, [issueRef, state, start]);

   useEffect(() => {
      if (log.current) log.current.scrollTop = log.current.scrollHeight;
   }, [env?.log]);

   const apps = env?.plan?.apps ?? [];
   const shown =
      apps.find((candidate) => candidate.name === app) ??
      apps.find((candidate) => candidate.primary) ??
      null;
   const ready = env?.state === 'ready' && shown?.ready === true;

   const stop = () => {
      stopped.current = true;
      stopPreviewEnvironment(issueRef)
         .then(() => loadPreviewEnvironment(issueRef))
         .then(setEnv)
         .catch(() => undefined);
   };

   let notice: string | null = null;
   if (failed) notice = t('loadFailed');
   else if (!env) notice = t('loading');
   else if (!env.available) notice = t('unavailableHere');
   else if (!env.previewable) notice = t('nothingYet');
   else if (env.state === 'idle') notice = stopped.current ? t('stopped') : t('loading');

   return (
      <div className="flex size-full min-h-0 flex-col">
         <div className="flex items-center gap-2 border-b px-4 py-1.5">
            {apps.length > 1 &&
               apps.map((candidate) => (
                  <Button
                     key={candidate.name}
                     variant="outline"
                     size="xs"
                     className={cn(
                        'h-7 cursor-pointer border-muted-foreground/15 px-2 shadow-none',
                        candidate.name === shown?.name
                           ? 'bg-muted'
                           : 'bg-transparent text-muted-foreground'
                     )}
                     onClick={() => setApp(candidate.name)}
                  >
                     {candidate.name}
                  </Button>
               ))}
            {env?.commit && (
               <span className="font-mono text-muted-foreground" title={t('commit')}>
                  {env.commit.slice(0, 7)}
               </span>
            )}
            <span className="flex-1" />
            {ready && shown && (
               <Button
                  asChild
                  variant="outline"
                  size="xs"
                  className={TOOL}
                  aria-label={t('open')}
                  title={t('open')}
               >
                  <a href={shown.url} target="_blank" rel="noreferrer">
                     <ExternalLink className="size-3.5" aria-hidden />
                  </a>
               </Button>
            )}
            <Button
               variant="outline"
               size="xs"
               className={TOOL}
               aria-label={t('reload')}
               title={t('reload')}
               disabled={!ready}
               onClick={() => setReload((value) => value + 1)}
            >
               <RotateCw className="size-3.5" aria-hidden />
            </Button>
            <Button
               variant="outline"
               size="xs"
               className={TOOL}
               aria-label={t('rebuild')}
               title={t('rebuild')}
               disabled={!env?.previewable || (state !== undefined && isStarting(state))}
               onClick={() => start(true)}
            >
               <Hammer className="size-3.5" aria-hidden />
            </Button>
            <Button
               variant="outline"
               size="xs"
               className={TOOL}
               aria-label={t('stop')}
               title={t('stop')}
               disabled={!state || state === 'idle'}
               onClick={stop}
            >
               <Square className="size-3.5" aria-hidden />
            </Button>
         </div>
         <div className="min-h-0 flex-1">
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
               <div className="flex size-full min-h-0 flex-col">
                  <p className="border-b px-4 py-2 text-muted-foreground">
                     {env?.state === 'failed' || env?.state === 'unavailable'
                        ? (env.message ?? t('failed'))
                        : env?.state === 'fetching'
                          ? t('fetching')
                          : t('starting')}
                  </p>
                  <pre
                     ref={log}
                     className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-4 font-mono text-muted-foreground"
                  >
                     {env?.log}
                  </pre>
               </div>
            )}
         </div>
      </div>
   );
}
