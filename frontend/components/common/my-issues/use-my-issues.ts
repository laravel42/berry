'use client';

import { Issue } from '@/data/issues';
import { useSessionStore } from '@/store/session-store';
import { parseAsStringLiteral, useQueryState } from 'nuqs';
import { useMemo } from 'react';

export const MY_ISSUES_TABS = ['all', 'assigned', 'created'] as const;
export type MyIssuesTab = (typeof MY_ISSUES_TABS)[number];

/** Default Issues tab when the URL omits `?tab=`. */
export const DEFAULT_MY_ISSUES_TAB: MyIssuesTab = 'all';

/** Shared tab state (URL-backed) between the header and the page body. */
export function useMyIssuesTab() {
   const [tab, setTab] = useQueryState(
      'tab',
      parseAsStringLiteral(MY_ISSUES_TABS).withDefault(DEFAULT_MY_ISSUES_TAB)
   );
   const activeTab = tab ?? DEFAULT_MY_ISSUES_TAB;
   return [activeTab, setTab] as const;
}

export interface MyIssuesScope {
   /** The signed-in person, for "assigned to me" and "created by me". */
   userId: string;
}

/** The signed-in person this Issues page scopes to. */
export function useMyIssuesScope(): MyIssuesScope {
   const userId = useSessionStore((state) => state.user?.id ?? '');
   return useMemo(() => ({ userId }), [userId]);
}

/** Issues shown by each Issues actor tab. */
export function scopeMyIssues(issues: Issue[], tab: MyIssuesTab, scope: MyIssuesScope): Issue[] {
   switch (tab) {
      case 'assigned':
         return issues.filter((issue) => issue.assignee?.id === scope.userId);
      case 'created':
         return issues.filter((issue) => issue.creator?.id === scope.userId);
      case 'all':
      default:
         return issues;
   }
}
