'use client';

import { Button } from '@/components/ui/button';
import { WORKSPACE_SLUG } from '@/lib/config';
import {
   artifactPreviewBase,
   artifactPreviewUrl,
   artifactText,
   loadIssueArtifacts,
   siteEntry,
   type RunArtifact,
} from '@/lib/attachments';
import { useShellStore } from '@/store/shell-store';
import { ArrowLeft, RotateCw } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { SiteBuildFrame } from './site-build-frame';

/** A page that loads source a browser cannot run as it is: TypeScript, JSX or a framework component. */
const NEEDS_BUILD = /<script[^>]*\bsrc\s*=\s*["'][^"']+\.(?:tsx?|jsx|vue|svelte)["']/i;

/**
 * Opens a task's site in its own "Preview" tab, full size, and goes there.
 * `path` picks a page; without it the site's entry page opens.
 */
export function useOpenSitePreview(issueRef: string) {
   const router = useRouter();
   const params = useParams<{ orgId?: string }>();
   const orgId = params?.orgId || WORKSPACE_SLUG;
   const openTab = useShellStore((state) => state.openTab);
   return useCallback(
      (page?: RunArtifact) => {
         const query = page ? `?path=${encodeURIComponent(page.path)}` : '';
         const href = `/preview/${encodeURIComponent(issueRef)}${query}`;
         openTab(href, 'Preview');
         router.push(`/${orgId}${href}`);
      },
      [issueRef, orgId, openTab, router]
   );
}

/**
 * What an agent built on a task, as a site, in a tab of its own.
 *
 * The task page shows files in a pane beside their tree; a site wants the
 * whole window, and a tab of its own so it can sit next to the task being
 * reviewed. A project that has to be built is built first (`SiteBuildFrame`),
 * and the page runs in the same sandbox as everywhere else.
 */
export function SitePreviewPage() {
   const t = useTranslations('issueDetail.sitePreview');
   const params = useParams<{ orgId?: string; issueRef?: string }>();
   const orgId = params?.orgId || WORKSPACE_SLUG;
   const issueRef = decodeURIComponent(params?.issueRef ?? '');
   const wanted = useSearchParams()?.get('path') ?? null;

   const [entry, setEntry] = useState<RunArtifact | null>(null);
   const [base, setBase] = useState<string | null>(null);
   const [unbuilt, setUnbuilt] = useState(false);
   const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'failed'>('loading');
   const [reload, setReload] = useState(0);

   useEffect(() => {
      if (!issueRef) return;
      let cancelled = false;
      setState('loading');
      const load = async () => {
         const artifacts = await loadIssueArtifacts(issueRef);
         const page =
            (wanted && artifacts.find((artifact) => artifact.path === wanted)) ||
            siteEntry(artifacts);
         if (!page) {
            if (!cancelled) setState('empty');
            return;
         }
         const [previewBase, html] = await Promise.all([
            artifactPreviewBase(issueRef),
            artifactText(page),
         ]);
         if (cancelled) return;
         setEntry(page);
         setBase(previewBase);
         setUnbuilt(NEEDS_BUILD.test(html));
         setState('ready');
      };
      load().catch(() => !cancelled && setState('failed'));
      return () => {
         cancelled = true;
      };
   }, [issueRef, wanted]);

   return (
      <div className="flex size-full min-h-0 flex-col">
         <div className="flex items-center gap-2 border-b px-3 py-1.5">
            <Button asChild variant="ghost" size="xs">
               <Link href={`/${orgId}/issue/${encodeURIComponent(issueRef)}`}>
                  <ArrowLeft className="mr-1 size-3.5" aria-hidden />
                  {t('back', { ref: issueRef })}
               </Link>
            </Button>
            <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
               {entry?.path ?? ''}
            </span>
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
         <div className="min-h-0 flex-1">
            {state === 'ready' && entry ? (
               <SiteBuildFrame
                  issueRef={issueRef}
                  pageUrl={base ? artifactPreviewUrl(base, entry.path) : null}
                  base={base}
                  unbuilt={unbuilt}
                  reload={reload}
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
