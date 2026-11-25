'use client';

import { CreateGoalModalProvider } from '@/components/common/milestones/create-milestone-modal-provider';
import { CreateIssueModalProvider } from '@/components/common/issues/create-issue-modal-provider';
import { IssuesHydrator } from '@/components/common/issues/issues-hydrator';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

import { useCommandPaletteStore } from '@/store/command-palette-store';
import { useIssuesStore } from '@/store/issues-store';
import { useRecentIssuesStore } from '@/store/recent-issues-store';

/** True while the real palette is mounted and owns ⌘K itself. */
let paletteMounted = false;

const DynamicCommandPalette = dynamic(
   () =>
      import('@/components/layout/command-palette').then(({ CommandPalette }) => {
         function MountedPalette() {
            useEffect(() => {
               paletteMounted = true;
               return () => {
                  paletteMounted = false;
               };
            }, []);
            return <CommandPalette />;
         }
         return MountedPalette;
      }),
   { ssr: false }
);

/**
 * The command palette, fetched the first time something asks for it.
 *
 * ⌘K and the phone rail's Search row both go through the palette store, so
 * this stub listens for the key and watches the store; either one mounts the
 * real palette, which already renders open when it arrives. Once it is
 * mounted it handles ⌘K itself and the stub's listener steps aside. The stub
 * also keeps the recent-tasks list current, since that is written from the
 * palette's own view of the route and would miss every visit before the
 * first open.
 */
function LazyCommandPalette() {
   const isOpen = useCommandPaletteStore((state) => state.isOpen);
   const [wanted, setWanted] = useState(false);
   const pathname = usePathname();
   const issues = useIssuesStore((state) => state.issues);
   const visitIssue = useRecentIssuesStore((state) => state.visit);

   useEffect(() => {
      if (isOpen) setWanted(true);
   }, [isOpen]);

   useEffect(() => {
      if (wanted) return;
      const onKeyDown = (event: KeyboardEvent) => {
         if (paletteMounted || event.isComposing || event.repeat) return;
         if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            useCommandPaletteStore.getState().setOpen(true);
            setWanted(true);
         }
      };
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
   }, [wanted]);

   // Same rule as the palette: the task this route is about becomes recent.
   useEffect(() => {
      if (wanted) return;
      const match = pathname?.match(/^\/[^/]+\/issue\/([^/]+)/);
      if (!match) return;
      const issue = issues.find((entry) => entry.identifier === match[1]);
      if (issue) visitIssue({ id: issue.id, identifier: issue.identifier, title: issue.title });
   }, [wanted, pathname, issues, visitIssue]);

   return wanted ? <DynamicCommandPalette /> : null;
}

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
         <CreateGoalModalProvider />
         <LazyCommandPalette />
      </>
   );
}
