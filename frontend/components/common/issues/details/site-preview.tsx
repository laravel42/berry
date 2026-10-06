'use client';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { artifactPreviewUrl, type RunArtifact } from '@/lib/attachments';
import { SITE_BUILD_PATH } from '@/lib/site-build';
import { loadSitePreview } from '@/lib/site-preview';
import { cn } from '@/lib/utils';
import { ExternalLink, Hammer, PanelBottom, RotateCw, Square } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PreviewPanel, type PanelAction } from './preview-panel';
import { useSiteBuild } from './site-build-frame';

/** Messages from the page's navigation bridge (injected by the preview route). */
const BRIDGE = 'berry-preview:';

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

/** The build's output as one process, so the terminal reads it the way a running app's does. */
function asAppLog(log: string, app: string): string {
   return log
      .split('\n')
      .map((line) => (line === '' ? '' : `[${app}] ${line}`))
      .join('\n');
}

/**
 * What an agent built on a task, in the same preview a repository's pull
 * request gets: the buttons in the page's bar, the log in the panel at the
 * foot, and the site filling the pane once it is up. A project that has to be
 * built is built first. A built site is loaded from its own host, so its
 * routes and its API are the app's. A plain page stays sandboxed and cannot
 * act as Berry.
 */
export function SitePreview({
   issueRef,
   path,
   toolbarSlot,
}: {
   issueRef: string;
   path?: string | null;
   /**
    * Where the page has room for the preview's buttons: the end of its own tab
    * bar. With one, the preview draws no bar of its own.
    */
   toolbarSlot?: HTMLElement | null;
}) {
   const t = useTranslations('issueDetail.sitePreview');
   const buildText = useTranslations('issueDetail.siteBuild');
   const env = useTranslations('issueDetail.environmentPreview');
   const [entry, setEntry] = useState<RunArtifact | null>(null);
   const [base, setBase] = useState<string | null>(null);
   const [unbuilt, setUnbuilt] = useState(false);
   const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'failed'>('loading');
   const [reload, setReload] = useState(0);
   const [panelOpen, setPanelOpen] = useState(true);
   // Stopped here, so looking at the tab does not put the site back.
   const [held, setHeld] = useState(false);
   // Where a built app was when the browser reloaded one of its routes from
   // Berry's host: the frame is reopened on the site at that route.
   const [route, setRoute] = useState<string | null>(null);
   const frameArea = useRef<HTMLDivElement>(null);
   const { build, error, start, rebuild } = useSiteBuild(issueRef, state === 'ready' && unbuilt);

   const frame = useCallback(
      () => frameArea.current?.querySelector('iframe')?.contentWindow ?? null,
      []
   );

   useEffect(() => {
      const onMessage = (event: MessageEvent) => {
         if (!event.source || event.source !== frame()) return;
         const data = event.data as { type?: unknown; path?: unknown };
         if (data?.type !== `${BRIDGE}lost`) return;
         setRoute(typeof data.path === 'string' && data.path.startsWith('/') ? data.path : '/');
         setReload((value) => value + 1);
      };
      window.addEventListener('message', onMessage);
      return () => window.removeEventListener('message', onMessage);
   }, [frame]);

   useEffect(() => {
      if (!issueRef) return;
      let cancelled = false;
      setState('loading');
      setHeld(false);
      const load = async () => {
         const target = await loadSitePreview(issueRef, { path });
         if (cancelled) return;
         if (!target) {
            setState('empty');
            return;
         }
         setEntry(target.entry);
         setBase(target.base);
         setUnbuilt(target.unbuilt);
         setState('ready');
      };
      load().catch(() => !cancelled && setState('failed'));
      return () => {
         cancelled = true;
      };
   }, [issueRef, path]);

   useEffect(() => {
      const onKey = (event: globalThis.KeyboardEvent) => {
         if (event.ctrlKey && event.key === '`') {
            event.preventDefault();
            setPanelOpen((open) => !open);
         }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
   }, []);

   const pageUrl = base && entry ? artifactPreviewUrl(base, entry.path) : null;
   // The site's own host: a real origin, so /admin and /api are the app's.
   // Shown as soon as the build has one, including while its server is still starting.
   const live = build?.state === 'ready' && build.url ? build.url : null;
   const builtSrc =
      base && build?.state === 'ready'
         ? `${base}${SITE_BUILD_PATH}index.html?v=${encodeURIComponent(build.finishedAt ?? '')}${
              route ? `&berry-route=${encodeURIComponent(route)}` : ''
           }`
         : null;
   const src = live ?? (unbuilt ? builtSrc : pageUrl);
   const showing = !held && Boolean(src);
   const building = unbuilt && build?.state === 'building';

   const restart = (force: boolean) => {
      setHeld(false);
      if (force) rebuild();
      else start();
   };

   let notice: string | null = null;
   if (state === 'failed') notice = t('loadFailed');
   else if (state === 'loading' && !live) notice = t('loading');
   else if (state === 'empty') notice = t('noSite');
   else if (held) notice = env('stopped');

   const panelAvailable = notice === null;
   const log = build?.log ?? '';
   const running = showing;
   const status =
      build?.state === 'failed' || error
         ? buildText('failed')
         : showing
           ? buildText('built')
           : buildText('building');

   const onPanelAction = (action: PanelAction) => {
      if (action === 'rebuild') restart(true);
      else if (action === 'start') restart(false);
      else if (action === 'stop') setHeld(true);
      else if (action === 'open' && showing && src) window.open(src, '_blank', 'noreferrer');
   };

   const tools = (
      <>
         {showing && src && (
            <ToolTip label={env('open')}>
               <Button
                  asChild
                  variant="outline"
                  size="xs"
                  className={TOOL}
                  aria-label={env('open')}
               >
                  <a href={src} target="_blank" rel="noreferrer">
                     <ExternalLink className="size-3.5" aria-hidden />
                  </a>
               </Button>
            </ToolTip>
         )}
         <ToolTip label={env('panel.toggle')}>
            <Button
               variant="outline"
               size="xs"
               className={cn(TOOL, panelOpen && panelAvailable && 'bg-muted')}
               aria-label={env('panel.toggle')}
               disabled={!panelAvailable}
               onClick={() => setPanelOpen((open) => !open)}
            >
               <PanelBottom className="size-3.5" aria-hidden />
            </Button>
         </ToolTip>
         <ToolTip label={env('reload')}>
            <Button
               variant="outline"
               size="xs"
               className={TOOL}
               aria-label={env('reload')}
               disabled={!showing}
               onClick={() => setReload((value) => value + 1)}
            >
               <RotateCw className="size-3.5" aria-hidden />
            </Button>
         </ToolTip>
         <ToolTip label={buildText('rebuildHint')}>
            <Button
               variant="outline"
               size="xs"
               className={TOOL}
               aria-label={buildText('rebuild')}
               disabled={!unbuilt || building}
               onClick={() => restart(true)}
            >
               <Hammer className="size-3.5" aria-hidden />
            </Button>
         </ToolTip>
         <ToolTip label={env('stop')}>
            <Button
               variant="outline"
               size="xs"
               className={TOOL}
               aria-label={env('stop')}
               disabled={held || (!showing && !building)}
               onClick={() => setHeld(true)}
            >
               <Square className="size-3.5" aria-hidden />
            </Button>
         </ToolTip>
      </>
   );

   return (
      <div className="flex size-full min-h-0 flex-col">
         {toolbarSlot ? (
            createPortal(tools, toolbarSlot)
         ) : (
            <div className="flex items-center justify-end gap-2 border-b px-4 py-1.5">{tools}</div>
         )}
         <div className="relative flex min-h-0 flex-1 flex-col">
            <div ref={frameArea} className="relative min-h-0 flex-1 overflow-hidden">
               {notice ? (
                  <div className="flex flex-col items-start gap-3 p-6 text-muted-foreground">
                     <p>{notice}</p>
                     {held && (
                        <Button size="xs" variant="outline" onClick={() => setHeld(false)}>
                           {env('start')}
                        </Button>
                     )}
                  </div>
               ) : showing && src ? (
                  <iframe
                     key={`${src}#${reload}`}
                     src={src}
                     title={t('title', { path: entry?.path ?? '' })}
                     // A built site has its own host. A plain page stays sandboxed,
                     // with no origin, so it cannot act as Berry.
                     {...(live
                        ? {}
                        : { sandbox: 'allow-scripts allow-forms allow-popups allow-modals' })}
                     referrerPolicy="no-referrer"
                     className="absolute inset-0 size-full border-0 bg-background"
                     allow="clipboard-write"
                  />
               ) : (
                  <div className="flex size-full flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
                     <p className="max-w-prose">
                        {error ??
                           (build?.state === 'failed'
                              ? buildText('failed')
                              : buildText('buildingHint'))}
                     </p>
                     {(error || build?.state === 'failed') && (
                        <Button size="xs" variant="outline" onClick={() => restart(false)}>
                           {buildText('retry')}
                        </Button>
                     )}
                  </div>
               )}
            </div>
            {panelAvailable && panelOpen && (
               <PreviewPanel
                  log={running ? asAppLog(log, 'web') : log}
                  processes={[
                     {
                        name: 'web',
                        ready: showing,
                        workdir: null,
                     },
                  ]}
                  issueRef={issueRef}
                  host={issueRef.toLowerCase()}
                  status={status}
                  running={running}
                  onAction={onPanelAction}
                  onClose={() => setPanelOpen(false)}
               />
            )}
         </div>
      </div>
   );
}
