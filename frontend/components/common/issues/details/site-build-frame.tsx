'use client';

import { Button } from '@/components/ui/button';
import {
   SITE_BUILD_PATH,
   siteBuildStatus,
   startSiteBuild,
   type SiteBuild,
} from '@/lib/attachments';
import { BerryApiError } from '@/lib/api';
import { Hammer, Loader2, RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { knownSiteBuild, rememberSiteBuild } from '@/lib/site-preview';

/** How often a running build is re-read. */
const POLL_MS = 2000;

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
         `${base}${SITE_BUILD_PATH}index.html`,
         <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-muted-foreground">
            <Hammer className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{t('built')}</span>
            <Button size="xs" variant="ghost" onClick={start} title={t('rebuildHint')}>
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

/** The end of the build's output, newest line last. */
function BuildLog({ log }: { log: string }) {
   const tail = log.split('\n').slice(-40).join('\n').trim();
   return (
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 font-mono">
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
