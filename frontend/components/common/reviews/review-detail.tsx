'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyStateLoading } from '@/components/common/empty-state';
import { IssueArtifacts } from '@/components/common/issues/details/issue-artifacts';
import { EnvironmentPreview } from '@/components/common/issues/details/environment-preview';
import { SitePreview } from '@/components/common/issues/details/site-preview';
import { loadIssueArtifacts, siteEntry } from '@/lib/attachments';
import { loadReviews, preloadReviewDiff, type ReviewItem } from '@/lib/reviews';
import { loadPreviewEnvironment } from '@/lib/preview-environment';
import { preloadSitePreview } from '@/lib/site-preview';
import { useSessionStore } from '@/store/session-store';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { type ReviewOutcome } from './review-decision-bar';
import { RepositoryFiles } from './repository-files';
import { ReviewDiff } from './review-diff';
import { ReviewVerdicts } from './review-guide';
import { ReviewOverview } from './review-overview';
import { DiffStat, IssueCheckIcon, PrIcon } from './review-shared';
import { reviewStatusOf } from './reviews';

export type { ReviewOutcome } from './review-decision-bar';

export type ReviewSection = 'overview' | 'guide' | 'diff' | 'files' | 'preview';

const SECTION_PATH: Record<ReviewSection, string> = {
   overview: '',
   guide: '/review',
   diff: '/changes',
   files: '/files',
   preview: '/preview',
};

/**
 * Right pane of the Reviews split view: the task, the pull request, and the
 * decision. The item is found in either list, because a decided task is still
 * worth opening; the decision bar shows only while it waits.
 */
export function ReviewDetail({
   reviewId,
   section,
   listTab = 'for-you',
   onDecided,
   onBack,
}: {
   reviewId: string;
   section: ReviewSection;
   /** The list beside this pane, kept when switching sections. */
   listTab?: 'for-you' | 'created';
   onDecided?: (outcome: ReviewOutcome) => void | Promise<void>;
   /** Narrow screens show one pane at a time; this returns to the list. */
   onBack?: () => void;
}) {
   const t = useTranslations('reviews');
   const { orgId } = useParams<{ orgId: string }>();
   const workspace = useSessionStore((state) => state.workspace);
   const [item, setItem] = useState<ReviewItem | null | undefined>(undefined);
   // Switching sections is local: a route change per tab would remount this
   // pane and refetch both review lists for what is only a different view.
   const [active, setActive] = useState<ReviewSection>(section);
   // Whether the task's output holds a page, so the Preview tab has a site to run.
   const [hasSite, setHasSite] = useState(false);
   // Whether the task has a pull request the server can run. When it does, the
   // Preview is the running app — a Next.js site has no page file to find — and
   // the saved files are only the fallback for a task without a repository.
   const [hasEnvironment, setHasEnvironment] = useState(false);
   // The end of the tab bar, as an element a section can render its own buttons into.
   const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null);

   useEffect(() => {
      setActive(section);
   }, [section]);

   const load = useCallback(async () => {
      if (!workspace) return;
      const [open, completed] = await Promise.all([
         loadReviews(workspace.id, 'open'),
         loadReviews(workspace.id, 'completed'),
      ]);
      setItem([...open, ...completed].find((candidate) => candidate.id === reviewId) ?? null);
   }, [workspace, reviewId]);

   useEffect(() => {
      void load();
   }, [load]);

   const issueRef = item?.issue.identifier;
   useEffect(() => {
      if (!issueRef) return;
      let cancelled = false;
      loadIssueArtifacts(issueRef)
         .then((artifacts) => {
            if (cancelled) return;
            const site = siteEntry(artifacts) !== null;
            setHasSite(site);
            // Ready before it is asked for: the preview's target, and the
            // container build when the site is a build tool's source.
            if (site) preloadSitePreview(issueRef, artifacts);
         })
         .catch(() => !cancelled && setHasSite(false));
      loadPreviewEnvironment(issueRef)
         .then(
            (environment) =>
               !cancelled && setHasEnvironment(environment.available && environment.previewable)
         )
         .catch(() => !cancelled && setHasEnvironment(false));
      return () => {
         cancelled = true;
      };
   }, [issueRef]);

   // The diff too, so the Diff tab opens on it instead of on "Loading".
   const diffRun = item?.pullRequest ? item.run.id : null;
   useEffect(() => {
      if (diffRun) preloadReviewDiff(diffRun);
   }, [diffRun]);

   const decided = useCallback(
      async (outcome: ReviewOutcome) => {
         if (onDecided) await onDecided(outcome);
         else await load();
      },
      [onDecided, load]
   );

   if (item === undefined) {
      return <EmptyStateLoading label={t('detail.loading')} />;
   }
   if (item === null) {
      return (
         <div className="flex h-full items-center justify-center px-6 text-muted-foreground">
            {t('detail.notFound')}
         </div>
      );
   }

   const status = reviewStatusOf(item);
   const waiting = item.issue.status === 'in_review';
   const hasFiles = item.delivery.producedFiles > 0;
   // A pull request has a repository to browse at its branch, and that is what
   // the tab shows: the agent's saved files are in it once committed. A task with
   // no pull request shows the files saved on it instead.
   const hasRepository = item.pullRequest !== null;
   const showFiles = hasFiles || hasRepository;
   // Verdicts exist only where AutoGate asked agents to review, a diff only
   // where a pull request was opened, and files only when the run produced
   // some; a task without one has no such tab, and an old link opens overview.
   const shown: ReviewSection =
      (active === 'guide' && !item.issue.autoGate) ||
      (active === 'diff' && !item.pullRequest) ||
      (active === 'files' && !showFiles) ||
      (active === 'preview' && !hasSite && !hasEnvironment)
         ? 'overview'
         : active;

   const selectSection = (next: ReviewSection) => {
      setActive(next);
      // The address follows the tab, so a reload or a shared link opens this
      // section, without navigating.
      window.history.replaceState(
         null,
         '',
         `/${orgId}/review/${item.id}${SECTION_PATH[next]}${listTab === 'created' ? '?list=created' : ''}`
      );
   };

   return (
      <div className="flex h-full flex-col overflow-hidden">
         <div className="flex h-10 min-w-0 shrink-0 items-center gap-2 border-b px-4">
            {onBack && (
               <button
                  type="button"
                  onClick={onBack}
                  className="-ml-1 inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none md:hidden"
                  aria-label={t('detail.backToList')}
               >
                  <ArrowLeft className="size-4" aria-hidden />
               </button>
            )}
            <Link
               href={`/${orgId}/issue/${item.issue.identifier}`}
               className="flex shrink-0 items-center gap-1.5 rounded-sm hover:opacity-80 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
               <IssueCheckIcon />
               <span className="font-medium">{item.issue.identifier}</span>
            </Link>
            <span className="shrink-0 text-muted-foreground" aria-hidden>
               ›
            </span>
            <PrIcon status={status} muted={waiting && !item.delivery.committed} />
            <h2 className="min-w-0 truncate" title={item.issue.title}>
               {item.issue.title}
            </h2>
            {item.delivery.committed && (
               <DiffStat
                  additions={item.delivery.insertions}
                  deletions={item.delivery.deletions}
                  className="shrink-0"
               />
            )}
            <span className="flex-1" />
            {item.pullRequest?.url && (
               <a
                  href={item.pullRequest.url}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
               >
                  {t('detail.pullRequest', { number: item.pullRequest.number })}
               </a>
            )}
         </div>
         <Tabs
            value={shown}
            onValueChange={(value) => selectSection(value as ReviewSection)}
            className="flex min-h-0 flex-1 flex-col gap-0"
         >
            <div className="flex h-10 shrink-0 items-center border-b px-4">
               <TabsList className="h-8">
                  <TabsTrigger value="overview">{t('sections.overview')}</TabsTrigger>
                  {item.issue.autoGate && (
                     <TabsTrigger value="guide">
                        {t('sections.verdicts')}
                        {item.verdicts.length > 0 && (
                           <span className="text-muted-foreground">{item.verdicts.length}</span>
                        )}
                     </TabsTrigger>
                  )}
                  {item.pullRequest && <TabsTrigger value="diff">{t('sections.diff')}</TabsTrigger>}
                  {showFiles && <TabsTrigger value="files">{t('sections.files')}</TabsTrigger>}
                  {(hasSite || hasEnvironment) && (
                     <TabsTrigger value="preview">{t('sections.preview')}</TabsTrigger>
                  )}
               </TabsList>
               {/* Filled by the section that is open — the build's buttons, the diff's
                   filter — instead of each drawing a second bar under this one. */}
               <div ref={setToolbarSlot} className="ml-auto flex items-center gap-2" />
            </div>
            <TabsContent value="overview" className="min-h-0 flex-1 overflow-hidden">
               <ReviewOverview
                  item={item}
                  onOpenFiles={() => selectSection('files')}
                  onDecided={decided}
               />
            </TabsContent>
            {item.issue.autoGate && (
               <TabsContent value="guide" className="min-h-0 flex-1 overflow-hidden">
                  <ReviewVerdicts item={item} />
               </TabsContent>
            )}
            {item.pullRequest && (
               <TabsContent value="diff" className="min-h-0 flex-1 overflow-hidden">
                  <ReviewDiff item={item} toolbarSlot={toolbarSlot} />
               </TabsContent>
            )}
            {showFiles && (
               // The repository at the branch under review when there is a pull
               // request; the files the agent saved on the task otherwise.
               <TabsContent
                  value="files"
                  className="flex min-h-0 flex-1 flex-col overflow-hidden p-4"
               >
                  {hasRepository ? (
                     <RepositoryFiles issueRef={item.issue.identifier} runId={item.run.id} />
                  ) : (
                     <IssueArtifacts
                        issueRef={item.issue.identifier}
                        runId={item.run.id}
                        heading={null}
                        defaultOpen
                        className="h-full min-h-0 flex-1"
                     />
                  )}
               </TabsContent>
            )}
            {(hasSite || hasEnvironment) && (
               // The pull request running as it would deployed, when there is one;
               // otherwise the task's saved site, built first when it needs building.
               <TabsContent value="preview" className="min-h-0 flex-1 overflow-hidden">
                  {hasEnvironment ? (
                     <EnvironmentPreview
                        issueRef={item.issue.identifier}
                        toolbarSlot={toolbarSlot}
                     />
                  ) : (
                     <SitePreview issueRef={item.issue.identifier} />
                  )}
               </TabsContent>
            )}
         </Tabs>
      </div>
   );
}
