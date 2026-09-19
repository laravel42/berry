'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useParams, usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Menu } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useShellStore } from '@/store/shell-store';
import { activeShellRoute, type ShellRoute } from './shell-routes';
import { ShellRail } from './shell-rail';
// import { ShellChatButton } from './shell-chat-button';
import { shellIconButton } from './shell-icon';
import { useChatUnreadSync } from './use-chat-unread-sync';
import { NotificationToasts } from '../notifications/notification-toasts';
import { ShortcutProvider } from '../shortcut-provider';
import { NavigationProgress } from '../navigation-progress';
import { ShellShortcuts } from './shell-shortcuts';

/**
 * The application shell: a collapsible rail and the workspace canvas.
 *
 * The chrome that has to stay reachable whatever the page shows — the menu
 * button below `lg` and the chat window's button — floats in the
 * bottom-left corner of the canvas rather than taking a bar of its own.
 * The page fills the canvas; the URL is the only navigation state.
 * Notifications live on Inbox in the rail; toasts still announce arrivals.
 *
 * Below `lg` the rail leaves the grid and becomes an overlay the floating
 * menu button opens over the page. The layout switch is CSS so the server and the
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
   const isMobile = useIsMobile();

   const { railOpen, railOverlayOpen, toggleRail, setRailOverlayOpen } = useShellStore();

   useChatUnreadSync();

   const activeRoute: ShellRoute | null = activeShellRoute(pathname, search);
   // Settings replaces the rail's contents rather than sitting inside it, the
   // way AppSidebar swapped its whole body on settings routes.
   const settingsMode = pathname.includes('/settings');

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
            // `--shell-strip` is what the canvas reserves above the page.
            // Nothing does now, but the chat window still reads it, so it is
            // set to zero rather than removed from under it.
            className="grid h-full min-h-0 w-full grid-cols-[minmax(0,1fr)] overflow-hidden font-mono font-light text-[var(--shell-text)] [--shell-strip:0px] lg:grid-cols-[auto_minmax(0,1fr)]"
         >
            <ShellRail
               ref={railRef}
               orgId={orgId}
               active={activeRoute}
               settingsMode={settingsMode}
               columnOpen={railOpen}
               overlayOpen={railOverlayOpen}
               onDismiss={closeOverlay}
            />
            {!railOpen ? (
               // The collapsed column: 36px holding the expand control. A
               // column only — below `lg` the rail is an overlay and the
               // floating menu button is how it opens.
               <div className="hidden w-9 flex-none justify-center bg-[var(--shell-rail)] pt-4 lg:flex">
                  <button
                     type="button"
                     onClick={toggleRail}
                     aria-label={t('rail.expandSidebar')}
                     title={t('rail.expandSidebar')}
                     className={`size-[26px] ${shellIconButton}`}
                  >
                     {/* Restores the column after the sidebar shortcut folds it. */}
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
               className="relative flex h-full max-h-full min-h-0 min-w-0 flex-col"
            >
               {/* Radius + overflow live on an inner surface so the floating
                   chrome in the corner is not clipped by the curve.
                   `min-h-0` is load-bearing: without it a grid/flex item's
                   default min-height:auto grows with page content, the
                   rounded box becomes as tall as the list, and the bottom
                   radius (and scroll) disappear past the frame. */}
               <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[10px] lg:border-l lg:border-[var(--shell-line)]">
                  <NavigationProgress />
                  <main className="min-h-0 flex-1 overflow-hidden bg-[var(--shell-canvas)]">
                     {children}
                  </main>
                  <NotificationToasts />
               </div>
               {/* Flat Agents launcher at the bottom-left of the body frame,
                plus the menu below `lg`. Fixed to the viewport insets so it
                sits in the frame gutter, not over the canvas. */}
               <div className="pointer-events-none fixed left-[calc(var(--app-inset-l)+0.75rem+4px)] bottom-[calc(var(--app-inset-b)+0.25rem+2px)] z-50 flex items-center gap-2 *:pointer-events-auto">
                  <button
                     ref={menuRef}
                     type="button"
                     onClick={openOverlay}
                     aria-label={t('rail.openMenu')}
                     aria-expanded={railOverlayOpen}
                     aria-controls="shell-rail"
                     className={`size-9 shadow-md lg:hidden ${shellIconButton}`}
                  >
                     <Menu size={16} strokeWidth={1.8} aria-hidden="true" />
                  </button>
                  {/* Agents launcher hidden for now. */}
                  {/* <ShellChatButton /> */}
               </div>
            </div>
         </div>
      </ShortcutProvider>
   );
}
