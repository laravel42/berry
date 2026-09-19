'use client';

import { Button } from '@/components/ui/button';
import { artifactPreviewUrl, type RunArtifact } from '@/lib/attachments';
import { loadSitePreview } from '@/lib/site-preview';
import { ArrowLeft, ArrowRight, RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SiteBuildFrame } from './site-build-frame';

/** Messages between this bar and the page's navigation bridge (injected by the preview route). */
const BRIDGE = 'berry-preview:';

/**
 * What an agent built on a task, running as a site, filling its container —
 * the review's Preview section. A project that has to be built is built first
 * (`SiteBuildFrame`), and the page runs in the same sandbox as everywhere else.
 * `path` picks a page; without it the site's entry page opens.
 */
export function SitePreview({ issueRef, path }: { issueRef: string; path?: string | null }) {
   const t = useTranslations('issueDetail.sitePreview');
   const [entry, setEntry] = useState<RunArtifact | null>(null);
   const [base, setBase] = useState<string | null>(null);
   const [unbuilt, setUnbuilt] = useState(false);
   const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'failed'>('loading');
   const [reload, setReload] = useState(0);
   // What the page says it can do. It has no origin of its own, so its history
   // is asked for by message, not read.
   const [nav, setNav] = useState({ canBack: false, canForward: false });
   // Where a built app was when the browser reloaded one of its routes from
   // Berry's host: the frame is reopened on the site at that route.
   const [route, setRoute] = useState<string | null>(null);
   const frameArea = useRef<HTMLDivElement>(null);

   const frame = useCallback(
      () => frameArea.current?.querySelector('iframe')?.contentWindow ?? null,
      []
   );

   useEffect(() => {
      const onMessage = (event: MessageEvent) => {
         // Only the page in this preview; anything else on the window is not ours.
         if (!event.source || event.source !== frame()) return;
         const data = event.data as {
            type?: unknown;
            canBack?: unknown;
            canForward?: unknown;
            path?: unknown;
         };
         if (data?.type === `${BRIDGE}lost`) {
            setRoute(typeof data.path === 'string' && data.path.startsWith('/') ? data.path : '/');
            setReload((value) => value + 1);
            return;
         }
         if (data?.type !== `${BRIDGE}state`) return;
         setNav({ canBack: data.canBack === true, canForward: data.canForward === true });
      };
      window.addEventListener('message', onMessage);
      return () => window.removeEventListener('message', onMessage);
   }, [frame]);

   // A reloaded or rebuilt frame starts over and reports again.
   useEffect(() => setNav({ canBack: false, canForward: false }), [reload, entry?.id]);

   const go = (dir: -1 | 1) => {
      // Both arrows wait for the page to say where it landed: a second click
      // before then would ask for a step the page may not have.
      setNav({ canBack: false, canForward: false });
      frame()?.postMessage({ type: `${BRIDGE}go`, dir }, '*');
   };

   useEffect(() => {
      if (!issueRef) return;
      let cancelled = false;
      setState('loading');
      const load = async () => {
         // Usually already in hand: the review preloads it on selection.
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

   return (
      <div className="flex size-full min-h-0 flex-col">
         <div className="flex items-center gap-2 border-b px-4 py-1.5">
            <Button
               variant="ghost"
               size="xs"
               aria-label={t('back')}
               title={t('back')}
               disabled={!nav.canBack}
               onClick={() => go(-1)}
            >
               <ArrowLeft className="size-3.5" aria-hidden />
            </Button>
            <Button
               variant="ghost"
               size="xs"
               aria-label={t('forward')}
               title={t('forward')}
               disabled={!nav.canForward}
               onClick={() => go(1)}
            >
               <ArrowRight className="size-3.5" aria-hidden />
            </Button>
            <span className="flex-1" />
            <Button
               variant="ghost"
               size="xs"
               aria-label={t('reload')}
               title={t('reload')}
               onClick={() => setReload((value) => value + 1)}
            >
               <RotateCw className="size-3.5" aria-hidden />
            </Button>
         </div>
         <div ref={frameArea} className="min-h-0 flex-1">
            {state === 'ready' && entry ? (
               <SiteBuildFrame
                  issueRef={issueRef}
                  pageUrl={base ? artifactPreviewUrl(base, entry.path) : null}
                  base={base}
                  unbuilt={unbuilt}
                  reload={reload}
                  route={route}
                  title={t('title', { path: entry.path })}
               />
            ) : (
               <p className="p-6 text-muted-foreground">
                  {state === 'empty'
                     ? t('noSite')
                     : state === 'failed'
                       ? t('loadFailed')
                       : t('loading')}
               </p>
            )}
         </div>
      </div>
   );
}
