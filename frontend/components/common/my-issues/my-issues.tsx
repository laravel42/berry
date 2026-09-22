'use client';

import { BatchToolbar } from '@/components/common/issues/batch-toolbar';
import { GroupedIssuesView } from '@/components/common/issues/grouped-issues-view';
import { InsightsPanel } from '@/components/common/issues/insights-panel';
import { IssueFilterBar } from '@/components/common/issues/issue-filter-bar';
import {
   applyIssueFilters,
   usePropertyFilterMatches,
} from '@/components/common/issues/issue-filter-columns';
import { IssueTable } from '@/components/common/issues/issue-table';
import {
   IssueListError,
   IssueListSkeleton,
   useIssueListLoad,
} from '@/components/common/issues/list-states';
import { SearchIssues } from '@/components/common/issues/search-issues';
import { useIssueListView } from '@/components/common/issues/use-issue-list-view';
import { BreakdownPanel } from './breakdown-panel';
import { displayOrderedStatus } from '@/data/status';
import { Button } from '@/components/ui/button';
import type { Issue } from '@/data/issues';
import { useFilterStore } from '@/store/filter-store';
import { useIssuesStore } from '@/store/issues-store';
import { useRightPanelStore } from '@/store/right-panel-store';
import { useSearchStore } from '@/store/search-store';
import { useSessionStore } from '@/store/session-store';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { scopeMyIssues, useMyIssuesScope, useMyIssuesTab } from './use-my-issues';

const DISCOVERY_DISMISSED_KEY = 'berry:discovery-notice-dismissed';

/** A task an agent filed on its sweep: agent-authored, in the backlog, titled for it. */
function isDiscoveryTask(issue: Issue): boolean {
   return (
      issue.status.id === 'backlog' &&
      issue.createdBy?.role === 'Application' &&
      issue.title.startsWith('Discovery:')
   );
}

/**
 * One line over a fresh workspace's backlog, explaining where its eighteen
 * "Discovery:" tasks came from. Shown only while the viewer has filed nothing
 * of their own -- after that they know what a task is -- and gone for good
 * once dismissed.
 */
function DiscoveryNotice({ issues }: { issues: Issue[] }) {
   const t = useTranslations('tasks.discovery');
   const userId = useSessionStore((state) => state.user?.id ?? null);
   // Unknown until the browser has been asked, so the server render and the
   // first client render agree; a store that cannot be read counts as seen.
   const [dismissed, setDismissed] = useState<boolean | null>(null);

   useEffect(() => {
      try {
         setDismissed(window.localStorage.getItem(DISCOVERY_DISMISSED_KEY) === '1');
      } catch {
         setDismissed(true);
      }
   }, []);

   const relevant = useMemo(() => {
      if (!userId) return false;
      const filedOne = issues.some((issue) => issue.createdById === userId);
      return !filedOne && issues.some(isDiscoveryTask);
   }, [issues, userId]);

   if (dismissed !== false || !relevant) return null;

   const dismiss = () => {
      setDismissed(true);
      try {
         window.localStorage.setItem(DISCOVERY_DISMISSED_KEY, '1');
      } catch {
         /* Not remembering the dismissal is a nuisance next visit, not a failure now. */
      }
   };

   return (
      <div
         role="status"
         className="flex items-center gap-3 border-b border-border/45 bg-actor-agent/5 px-4 py-1.5 sm:px-6"
      >
         <p className="min-w-0 flex-1 text-muted-foreground">{t('body')}</p>
         <Button size="xs" variant="ghost" className="shrink-0" onClick={dismiss}>
            {t('dismiss')}
         </Button>
      </div>
   );
}

/**
 * "My issues" body — the same machinery as the team views (search, filters,
 * every layout, insights), scoped to the tab: everything, what this person is
 * holding, or what they opened.
 */
export default function MyIssues() {
   const [tab] = useMyIssuesTab();
   const scope = useMyIssuesScope();
   const { isSearchOpen, searchQuery } = useSearchStore();
   const view = useIssueListView();
   const { filters } = useFilterStore();
   const { issues } = useIssuesStore();
   const { openPanel } = useRightPanelStore();
   const load = useIssueListLoad();

   const isSearching = isSearchOpen && searchQuery.trim() !== '';

   const scopedIssues = useMemo(() => scopeMyIssues(issues, tab, scope), [issues, tab, scope]);

   const propertyMatches = usePropertyFilterMatches(filters);

   const displayedIssues = useMemo(
      () => applyIssueFilters(scopedIssues, filters, propertyMatches),
      [scopedIssues, filters, propertyMatches]
   );

   if (isSearching) {
      return (
         <div className="w-full h-full">
            <div className="px-6 mb-6">
               <SearchIssues />
            </div>
         </div>
      );
   }

   // Only while there is nothing to show: a refresh that already has rows on
   // screen should not replace them with a skeleton.
   if (load.loadState === 'loading' && issues.length === 0) {
      return <IssueListSkeleton mode={view.mode} />;
   }

   if (load.loadState === 'error' && issues.length === 0) {
      return <IssueListError message={load.loadError ?? ''} onRetry={load.retry} />;
   }

   return (
      <div className="w-full h-full flex flex-col overflow-hidden">
         <IssueFilterBar showActions={false} />
         <BatchToolbar visibleIds={displayedIssues.map((issue) => issue.id)} />
         <DiscoveryNotice issues={issues} />
         <div className="flex-1 min-h-0 w-full flex overflow-hidden">
            <div className="flex-1 min-w-0 h-full overflow-hidden">
               {view.mode === 'table' ? (
                  <IssueTable
                     issues={displayedIssues}
                     statuses={displayOrderedStatus}
                     totalIssues={scopedIssues}
                  />
               ) : (
                  <GroupedIssuesView
                     issues={displayedIssues}
                     totalIssues={scopedIssues}
                     statuses={displayOrderedStatus}
                     isViewTypeGrid={view.mode === 'grid'}
                  />
               )}
            </div>

            {openPanel === 'insights' && (
               <aside className="hidden lg:flex w-[420px] shrink-0 border-l h-full overflow-hidden bg-container">
                  <InsightsPanel issues={displayedIssues} />
               </aside>
            )}
            {openPanel === 'breakdown' && (
               <aside className="hidden lg:flex w-80 shrink-0 border-l h-full overflow-hidden bg-container">
                  <BreakdownPanel issues={displayedIssues} />
               </aside>
            )}
         </div>
      </div>
   );
}
