'use client';

import { Button } from '@/components/ui/button';
import { BerryApiError } from '@/lib/api';
import { SITE_BUILD_PATH, siteBuildStatus, startSiteBuild, type SiteBuild } from '@/lib/site-build';
import { Hammer, Loader2, RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { knownSiteBuild, rebuildSite, rememberSiteBuild } from '@/lib/site-preview';

/** How often a running build is re-read: often enough that its log reads as a stream. */
const POLL_MS = 1000;

interface SiteBuildFrameProps {
   issueRef: string;
   /** The page under its preview base; null while the base is being fetched. */
   pageUrl: string | null;
   /** The preview base the build is served under. */
   base: string | null;
   /** The page loads source a browser cannot run, so it has to be built first. */
   unbuilt: boolean;
   /** Bumped by the viewer's reload button. */
   reload: number;
   title: string;
   /** The route a built app reopens on, when the preview lost its place (see proxy.ts). */
   route?: string | null;
}

/**
 * A page in the webview, and — when it is a build tool's source — the site
 * built from it.
 *
 * A page that loads `/src/main.tsx` renders blank in every browser, so it is
 * never shown as it is. The build starts by itself: Berry installs and builds
 * the task's project in a throwaway container, this shows how far it got and
 * the tail of its log, and the finished site then runs in the same sandboxed
 * webview. A server without Docker, or a build that fails, says so with the
 * log rather than leaving a white frame.
 */
export function SiteBuildFrame({
   issueRef,
   pageUrl,
   base,
   unbuilt,
   reload,
   title,
   route = null,
}: SiteBuildFrameProps) {
   const t = useTranslations('issueDetail.siteBuild');
   // Starts from what the review's preload saw, so a site built in the
   // background shows at once.
   const [build, setBuildState] = useState<SiteBuild | null>(() => knownSiteBuild(issueRef));
   // Every state seen is remembered, so the next opening starts from the latest.
   const setBuild = useCallback(
      (next: SiteBuild) => {
         rememberSiteBuild(issueRef, next);
         setBuildState(next);
      },
      [issueRef]
   );
   const [error, setError] = useState<string | null>(null);
   const started = useRef<string | null>(null);

   const start = useCallback(() => {
      setError(null);
      startSiteBuild(issueRef)
         .then(setBuild)
         .catch((cause: unknown) => {
            setError(
               cause instanceof BerryApiError && cause.status === 503
                  ? t('unavailable')
                  : cause instanceof Error
                    ? cause.message
                    : String(cause)
            );
         });
   }, [issueRef, t, setBuild]);

   /**
    * Rebuild: the frame goes at once and the build's log takes its place,
    * following it line by line until the new build is up, which then loads.
    */
   const rebuild = useCallback(() => {
      setError(null);
      setBuild({
         available: true,
         state: 'building',
         log: '',
         startedAt: new Date().toISOString(),
         finishedAt: null,
      });
      rebuildSite(issueRef)
         .then(setBuild)
         .catch((cause: unknown) => {
            setError(
               cause instanceof BerryApiError && cause.status === 503
                  ? t('unavailable')
                  : cause instanceof Error
                    ? cause.message
                    : String(cause)
            );
         });
   }, [issueRef, t, setBuild]);

   // Once per task: a page that needs a build asks for one as it opens.
   useEffect(() => {
      if (!unbuilt || started.current === issueRef) return;
      started.current = issueRef;
      start();
   }, [unbuilt, issueRef, start]);

   // Followed while it runs.
   useEffect(() => {
      if (build?.state !== 'building') return;
      const timer = setInterval(() => {
         siteBuildStatus(issueRef)
            .then(setBuild)
            .catch(() => undefined);
      }, POLL_MS);
      return () => clearInterval(timer);
   }, [build?.state, issueRef, setBuild]);

   const frame = (src: string, note?: React.ReactNode) => (
      <div className="flex size-full flex-col">
         {note}
         <iframe
            key={`${src}#${reload}`}
            src={src}
            title={title}
            // No allow-same-origin: the page gets an opaque origin and no way
            // to act as Berry, whatever its scripts do.
            sandbox="allow-scripts allow-forms allow-popups allow-modals"
            referrerPolicy="no-referrer"
            className="min-h-0 w-full flex-1 border-0 bg-white"
         />
      </div>
   );

   if (!unbuilt) {
      return pageUrl ? frame(pageUrl) : <Centered>{t('loading')}</Centered>;
   }

   if (error) {
      return (
         <Centered>
            <p>{error}</p>
            <Button size="xs" variant="secondary" onClick={start}>
               <RotateCw className="mr-1 size-3.5" aria-hidden />
               {t('retry')}
            </Button>
         </Centered>
      );
   }

   if (build?.state === 'ready' && base) {
      return frame(
         // A file, not the folder: Next's proxy drops a trailing slash, and the
         // built site's relative asset paths resolve against this URL.
         // The build's end time in the address, so a rebuilt site loads fresh
         // (a new frame, and no page cached from the build before).
         `${base}${SITE_BUILD_PATH}index.html?v=${encodeURIComponent(build.finishedAt ?? '')}${
            route ? `&berry-route=${encodeURIComponent(route)}` : ''
         }`,
         <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-muted-foreground">
            <Hammer className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{t('built')}</span>
            <Button
               size="xs"
               variant="outline"
               className="border-muted-foreground/15 shadow-none"
               onClick={rebuild}
               title={t('rebuildHint')}
            >
               {t('rebuild')}
            </Button>
         </div>
      );
   }

   if (build?.state === 'failed') {
      return (
         <div className="flex size-full flex-col gap-2 p-4">
            <p role="alert" className="text-status-danger">
               {t('failed')}
            </p>
            <BuildLog log={build.log} />
            <div>
               <Button size="xs" variant="secondary" onClick={start}>
                  <RotateCw className="mr-1 size-3.5" aria-hidden />
                  {t('retry')}
               </Button>
            </div>
         </div>
      );
   }

   return (
      <div className="flex size-full flex-col gap-2 p-4">
         <p role="status" className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t('building')}
         </p>
         <p className="text-muted-foreground">{t('buildingHint')}</p>
         {build?.log ? <BuildLog log={build.log} /> : null}
      </div>
   );
}

/**
 * The build's output as it grows, newest line last. Follows the end like a
 * terminal, unless the reader has scrolled up to read something.
 */
function BuildLog({ log }: { log: string }) {
   const box = useRef<HTMLPreElement>(null);
   const pinned = useRef(true);
   const tail = log.split('\n').slice(-400).join('\n').trim();
   useEffect(() => {
      const element = box.current;
      if (element && pinned.current) element.scrollTop = element.scrollHeight;
   }, [tail]);
   return (
      <pre
         ref={box}
         onScroll={(event) => {
            const element = event.currentTarget;
            pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
         }}
         aria-live="polite"
         className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 font-mono"
      >
         {tail}
      </pre>
   );
}

function Centered({ children }: { children: React.ReactNode }) {
   return (
      <div className="flex size-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
         {children}
      </div>
   );
}
