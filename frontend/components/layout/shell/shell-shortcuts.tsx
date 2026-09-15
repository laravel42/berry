'use client';

import { useRouter } from 'next/navigation';

import { useShortcut } from '@/components/layout/shortcut-provider';
import { useIsMobile } from '@/hooks/use-mobile';
import { useCreateIssueStore } from '@/store/create-issue-store';
import { useRightPanelStore } from '@/store/right-panel-store';
import { useShellStore } from '@/store/shell-store';

/**
 * The shell's own keyboard handlers.
 *
 * Everything here is a thing the chrome can do by itself: move the rail, move
 * through history, open the create-task modal, go to the inbox. The actions
 * that belong to a page rather than to the shell — find in task, floating
 * chat, send a composer — are declared in `lib/shortcuts.ts` and claimed by
 * whoever owns the behaviour, so they are absent from this list on purpose.
 *
 * Rendered once by `BerryShell`. Separate from it so the shell stays a
 * layout component and this stays a list of bindings.
 */
export function ShellShortcuts({ orgId }: { orgId: string }) {
   const router = useRouter();
   const isMobile = useIsMobile();
   const toggleRail = useShellStore((state) => state.toggleRail);
   const toggleRailOverlay = useShellStore((state) => state.toggleRailOverlay);
   const openIssueModal = useCreateIssueStore((state) => state.openModal);
   const openPanel = useRightPanelStore((state) => state.openPanel);
   const openPanelOfType = useRightPanelStore((state) => state.openPanelOfType);
   const closePanel = useRightPanelStore((state) => state.closePanel);

   const go = (path: string) => router.push(`/${orgId}${path}`);

   useShortcut('issue.create', () => openIssueModal());
   // The rail is a column at `lg` and an overlay below it; the key toggles
   // whichever shape is on screen rather than a stored preference the
   // narrow layout never reads.
   useShortcut('sidebar.toggle', () => (isMobile ? toggleRailOverlay() : toggleRail()));
   useShortcut('rightSidebar.toggle', () => {
      // Which panel a page shows is the page's business; the shortcut only
      // says "show it" or "hide it", and insights is the panel every page
      // that has one falls back to.
      if (openPanel) closePanel();
      else openPanelOfType('insights');
   });
   useShortcut('history.back', () => router.back());
   useShortcut('history.forward', () => router.forward());

   useShortcut('goto.myIssues', () => go('/tasks'));
   useShortcut('goto.inbox', () => go('/inbox'));
   useShortcut('goto.chat', () => go('/chat'));
   useShortcut('goto.projects', () => go('/projects'));
   useShortcut('goto.goals', () => go('/goals'));
   useShortcut('goto.reviews', () => go('/reviews'));
   useShortcut('goto.approvals', () => go('/approvals'));
   useShortcut('goto.views', () => go('/views'));
   useShortcut('goto.agents', () => go('/agents'));
   useShortcut('goto.runtimes', () => go('/settings/runtimes'));
   useShortcut('goto.settings', () => go('/settings'));

   return null;
}
