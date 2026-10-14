'use client';

import { CreateIssueModalProvider } from '@/components/common/issues/create-issue-modal-provider';
import { IssuesHydrator } from '@/components/common/issues/issues-hydrator';
import { CreatePlanModalProvider } from '@/components/common/plans/create-plan-modal-provider';
import { CommandPalette } from '@/components/layout/command-palette';

/**
 * Workspace-wide client runtime that must outlive a page.
 *
 * Mounted from the org shell, not from `MainLayout`: every workspace route
 * used to remount the hydrator, the command palette, and the create dialogs,
 * which re-fetched the board and tore down the event streams on each click.
 */
export function WorkspaceRuntime() {
   return (
      <>
         <IssuesHydrator />
         <CreateIssueModalProvider />
         <CreatePlanModalProvider />
         <CommandPalette />
      </>
   );
}
