'use client';

import { useEffect, useMemo } from 'react';
import { useParams, usePathname } from 'next/navigation';
import { useShellStore } from '@/store/shell-store';
import { describeRoute } from './shell-tab-model';

/**
 * Name the tab after the thing the page is showing.
 *
 * A tab starts out reading as its section ("Agents", "Reviews") because that
 * is all a URL says. Once the page has loaded its record it can say what the
 * record is called, and the tab follows:
 *
 * ```tsx
 * useTabLabel(agent ? agent.name : null);           // "Product Designer"
 * useTabLabel(issue ? `${issue.identifier} review` : null);
 * ```
 *
 * Pass null while loading; the section label stays until the name arrives.
 *
 * The name belongs to the tab that is showing this page's route. If the
 * active tab has already moved on — mid-navigation, or after switching to
 * another tab — nothing is written, so a name can never land on the wrong
 * tab. Leaving the route, or the page unmounting, takes the name away again,
 * and only if it is still the name this page gave: a newer page's is kept.
 */
export function useTabLabel(label: string | null): void {
   const pathname = usePathname() ?? '';
   const params = useParams<{ orgId?: string }>();
   const orgId = params?.orgId ?? '';
   const href = useMemo(() => describeRoute(pathname, orgId)?.href ?? null, [pathname, orgId]);

   const tabId = useShellStore((state) => {
      const active = state.tabs.find((tab) => tab.id === state.activeTabId);
      return active && href && active.href === href ? active.id : null;
   });
   const setTabTitle = useShellStore((state) => state.setTabTitle);
   const clearTabTitle = useShellStore((state) => state.clearTabTitle);

   useEffect(() => {
      if (!tabId || !label) return;
      setTabTitle(tabId, label);
      return () => clearTabTitle(tabId, label);
   }, [tabId, label, setTabTitle, clearTabTitle]);
}
