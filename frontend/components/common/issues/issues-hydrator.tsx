'use client';

import { useHydrateWorkspaceData } from '@/hooks/use-hydrate-workspace-data';

/**
 * Client boundary that loads Berry API data into the shared stores.
 * Mounted from the workspace shell so a page change does not refetch.
 */
export function IssuesHydrator() {
   useHydrateWorkspaceData();
   return null;
}
