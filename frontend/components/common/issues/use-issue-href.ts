'use client';

import { WORKSPACE_SLUG } from '@/lib/config';
import { useParams, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

/**
 * A task link that keeps the list's own query state.
 *
 * Opening a task from a list goes through an intercepted route: the list page
 * stays mounted behind the drawer while the address becomes the task's. Every
 * hook that scopes that list reads its state out of the URL — `tab`
 * (`use-my-issues`), `filters` (`store/filter-store`), and `group` / `layout`
 * / `order` / `dir` (`use-issue-list-view`) — so a bare `/issue/<key>` href
 * drops all of them and the page behind the overlay silently repaints as
 * "every task, no filters, default grouping" until the drawer is closed.
 * Carrying the current query string over leaves it as the reader left it.
 *
 * The identifier is passed in rather than the task, so a caller holding only a
 * key does not have to build one.
 */
export function useIssueHref(): (identifier: string) => string {
   const params = useParams<{ orgId: string }>();
   const orgId = params?.orgId ?? WORKSPACE_SLUG;
   const search = useSearchParams()?.toString() ?? '';

   return useCallback(
      (identifier: string) => {
         const href = `/${orgId}/issue/${identifier}`;
         return search ? `${href}?${search}` : href;
      },
      [orgId, search]
   );
}
