'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Menu } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { INDEX_TAB, useShellStore, type ShellTab } from '@/store/shell-store';
import { activeShellRoute, type ShellRoute } from './shell-routes';
import { describeRoute } from './shell-tab-model';
import { ShellRail } from './shell-rail';
import { ShellTabs } from './shell-tabs';
import { ShellChatButton } from './shell-chat-button';
import { shellIconButton } from './shell-icon';
import { useChatUnreadSync } from './use-chat-unread-sync';
import { NotificationBell } from '../notifications/notification-bell';
import { NotificationsDrawer } from '../notifications/notifications-drawer';
import { NotificationToasts } from '../notifications/notification-toasts';
import { ShortcutProvider } from '../shortcut-provider';
import { NavigationProgress } from '../navigation-progress';
import { ShellShortcuts } from './shell-shortcuts';

/**
 * The application shell from `Berry Prototype.dc.html`: a collapsible rail, a
 * browser-style tab strip, and the workspace canvas.
 *
 * The active tab shows the current URL. Everything follows from that:
 * navigating anywhere — a rail item, a link in the page, browser back, a deep
 * link — changes what the active tab displays rather than opening a new one,
 * which is why a rail click replaces the current view. Opening an additional
 * tab is the one action that is explicit, via "+".
 *
 * Below `lg` the rail leaves the grid and becomes an overlay the strip's menu
 * button opens over the page. The layout switch is CSS so the server and the
 * first paint agree; what this component adds is the behaviour a menu needs:
 * the page goes inert underneath it, focus moves in and comes back, Escape
 * and the backdrop close it, and so does going somewhere.
 */
export function BerryShell({ children }: { children: React.ReactNode }) {
   const t = useTranslations('shell');
   const pathname = usePathname() ?? '';
   const search = useSearchParams()?.toString() ?? '';
   const params = useParams<{ orgId?: string }>();
   const orgId = params?.orgId ?? '';
   const router = useRouter();
   const isMobile = useIsMobile();

   const {
      tabs,
      activeTabId,
      railOpen,
      railOverlayOpen,
      showInActiveTab,
      openTab,
      activateTab,
      closeTab,
      toggleRail,
      setRailOverlayOpen,
   } = useShellStore();

   useChatUnreadSync();

   // describeRoute is pure, so memoising gives the effect below a stable
   // dependency instead of a fresh object every render.
   const current = useMemo(() => describeRoute(pathname, orgId), [pathname, orgId]);
   const activeRoute: ShellRoute | null = activeShellRoute(pathname, search);
   // Settings replaces the rail's contents rather than sitting inside it, the
   // way AppSidebar swapped its whole body on settings routes. It is not a
   // tab either, so nothing in the strip reads as selected while you are there.
   const settingsMode = pathname.includes('/settings');

   // The URL is the source of truth; the active tab follows it.
   useEffect(() => {
      if (current) showInActiveTab(current.href, current.label);
   }, [current, showInActiveTab]);

   const push = useCallback((href: string) => router.push(`/${orgId}${href}`), [orgId, router]);

   const handleActivate = useCallback(
      (tab: ShellTab) => {
         activateTab(tab.id);
         push(tab.href);
      },
      [activateTab, push]
   );

   const handleClose = useCallback(
      (id: string) => {
         const next = closeTab(id);
         if (next) push(next.href);
      },
      [closeTab, push]
   );

   // "+" opens an additional tab on the index route, even when a tab is
   // already showing it — the same as a browser opening a second homepage.
   const handleNew = useCallback(() => {
      openTab(INDEX_TAB.href, INDEX_TAB.label);
      push(INDEX_TAB.href);
   }, [openTab, push]);

   // Browser-style shortcuts. Ctrl rather than Cmd, so the bindings do not
   // collide with Safari and Chrome's own tab shortcuts on macOS.
   useEffect(() => {
      const onKey = (event: KeyboardEvent) => {
         if (!event.ctrlKey || event.metaKey || event.altKey) return;
         const index = tabs.findIndex((tab) => tab.id === activeTabId);

         if (event.key === 't') {
            event.preventDefault();
            handleNew();
            return;
         }
         if (event.key === 'w' && activeTabId) {
            event.preventDefault();
            handleClose(activeTabId);
            return;
         }
         if (event.key === 'Tab' && tabs.length > 1) {
            event.preventDefault();
            const step = event.shiftKey ? -1 : 1;
            const from = index === -1 ? 0 : index;
            handleActivate(tabs[(from + step + tabs.length) % tabs.length]);
         }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
   }, [tabs, activeTabId, handleNew, handleClose, handleActivate]);

   // --- The overlay rail, below `lg` -------------------------------------
   const railRef = useRef<HTMLElement>(null);
   const menuRef = useRef<HTMLButtonElement>(null);
   const overlayWasOpen = useRef(false);
   const openOverlay = useCallback(() => setRailOverlayOpen(true), [setRailOverlayOpen]);
   const closeOverlay = useCallback(() => setRailOverlayOpen(false), [setRailOverlayOpen]);

   // Going somewhere closes it: the page it navigated to is underneath. It
   // starts closed, so the first run on mount changes nothing — a deep link
   // on a phone opens with the page, as it should.
   useEffect(() => {
      setRailOverlayOpen(false);
   }, [pathname, setRailOverlayOpen]);

   // Widening past `lg` turns the overlay back into a column. Left open, it
   // would hold the page inert behind a rail that is no longer over it.
   useEffect(() => {
      if (!isMobile) setRailOverlayOpen(false);
   }, [isMobile, setRailOverlayOpen]);

   // Focus follows the menu: into the rail when it opens, back to the button
   // that opened it when it closes. Only a close that follows an open returns
   // focus, so the shell never grabs it on load.
   useEffect(() => {
      if (railOverlayOpen) {
         overlayWasOpen.current = true;
         railRef.current?.querySelector<HTMLElement>('button:not([disabled]), a[href]')?.focus();
      } else if (overlayWasOpen.current) {
         overlayWasOpen.current = false;
         menuRef.current?.focus();
      }
   }, [railOverlayOpen]);

   useEffect(() => {
      if (!railOverlayOpen) return;
      const onKey = (event: KeyboardEvent) => {
         if (event.key !== 'Escape') return;
         event.preventDefault();
         closeOverlay();
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
   }, [railOverlayOpen, closeOverlay]);

   return (
      <ShortcutProvider>
         <ShellShortcuts orgId={orgId} />
         <div
            // `--shell-strip` is the tab strip's height: 44px where fingers
            // do the tapping, 34px where a pointer does. Tabs, the chat window
            // and anything else that must clear the strip read it from here.
            className="grid h-dvh w-full grid-cols-[minmax(0,1fr)] overflow-hidden bg-[var(--shell-surface)] font-mono font-light text-[var(--shell-text)] [--shell-strip:44px] lg:grid-cols-[auto_minmax(0,1fr)] lg:[--shell-strip:34px]"
         >
            <ShellRail
               ref={railRef}
               orgId={orgId}
               active={activeRoute}
               settingsMode={settingsMode}
               columnOpen={railOpen}
               overlayOpen={railOverlayOpen}
               onCollapse={toggleRail}
               onDismiss={closeOverlay}
            />
            {!railOpen ? (
               // The collapsed column: 36px holding the expand control. A
               // column only — below `lg` the rail is an overlay and the
               // strip's menu button is how it opens.
               <div className="hidden w-9 flex-none justify-center bg-[var(--shell-rail)] pt-4 lg:flex">
                  <button
                     type="button"
                     onClick={toggleRail}
                     aria-label={t('rail.expandSidebar')}
                     title={t('rail.expandSidebar')}
                     className={`size-[26px] ${shellIconButton}`}
                  >
                     {/* Mirrors the collapse control at the foot of the rail. */}
                     <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.7}
                     >
                        <path d="M10 6l5 6-5 6" />
                     </svg>
                  </button>
               </div>
            ) : null}

            {railOverlayOpen ? (
               // The page dimmed under the open rail; a tap anywhere on it
               // closes the menu. A button rather than a div so it is a
               // control with a name, not a dead area that happens to react.
               <button
                  type="button"
                  onClick={closeOverlay}
                  aria-label={t('rail.closeMenu')}
                  className="fixed inset-0 z-40 cursor-default bg-black/50 lg:hidden"
               />
            ) : null}

            <div
               // Nothing behind the open rail can be reached, by finger or by
               // Tab, until it closes: that is what makes the rail a menu
               // rather than a panel that happens to be on top.
               inert={railOverlayOpen}
               className="relative flex h-dvh max-h-dvh min-w-0 flex-col overflow-hidden lg:border-l lg:border-[var(--shell-line)]"
            >
               <NavigationProgress />
               {/* The strip's controls sit outside the scrolling tab list: an
                unread count that can scroll out of view is not a count, and
                a menu button that can is not a menu. */}
               <div className="flex h-[var(--shell-strip)] flex-none items-stretch bg-[var(--shell-rail)]">
                  <button
                     ref={menuRef}
                     type="button"
                     onClick={openOverlay}
                     aria-label={t('rail.openMenu')}
                     aria-expanded={railOverlayOpen}
                     aria-controls="shell-rail"
                     className="flex size-11 flex-none cursor-pointer items-center justify-center text-[var(--shell-text-muted)] transition-colors hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)] lg:hidden"
                  >
                     <Menu size={18} strokeWidth={1.8} aria-hidden="true" />
                  </button>
                  <ShellTabs
                     tabs={tabs}
                     activeTabId={settingsMode ? null : activeTabId}
                     onActivate={handleActivate}
                     onClose={handleClose}
                     onNew={handleNew}
                  />
                  <ShellChatButton />
                  <NotificationBell />
               </div>
               <main className="min-h-0 flex-1 overflow-auto bg-[var(--shell-canvas)]">
                  {children}
               </main>
               <NotificationsDrawer />
               <NotificationToasts />
            </div>
         </div>
      </ShortcutProvider>
   );
}
