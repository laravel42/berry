'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useParams, usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useIsMobile } from '@/hooks/use-mobile';
import { useShellStore } from '@/store/shell-store';
import { activeShellRoute, type ShellRoute } from './shell-routes';
import { ShellRail } from './shell-rail';
import { ShellLauncherDock } from './shell-launcher-dock';
import { shellIconButton } from './shell-icon';
import { ShellTabBar } from './shell-tab-bar';
import { useChatUnreadSync } from './use-chat-unread-sync';
import { NotificationToasts } from '../notifications/notification-toasts';
import { ShortcutProvider } from '../shortcut-provider';
import { NavigationProgress } from '../navigation-progress';
import { WorkspaceRuntime } from '../workspace-runtime';
import { ShellShortcuts } from './shell-shortcuts';

/**
 * The application shell: a collapsible rail and the workspace canvas.
 *
 * The chrome that has to stay reachable whatever the page shows: the chat
 * window's button floats bottom-right from `lg`, and below `lg` a tab bar
 * fixed to the bottom edge takes its place and the menu button's. The canvas
 * leaves room under the page for the bar, so it never covers the last line.
 * The page fills the canvas; the URL is the only navigation state.
 * Notifications live on Inbox in the rail; toasts still announce arrivals.
 *
 * Below `lg` the rail leaves the grid and becomes an overlay the tab
 * bar's More opens over the page. The layout switch is CSS so the server and the
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
         <WorkspaceRuntime />
         <ShellShortcuts orgId={orgId} />
         <div
            // `--shell-strip` is what the canvas reserves above the page.
            // Nothing does now, but the chat window still reads it, so it is
            // set to zero rather than removed from under it.
            // No face or weight of its own. `font-mono` here painted the whole
            // app in the mono face, so `body`'s Inter never reached a screen
            // inside the shell and the titles had no face to be set in; mono is
            // now the title face plus what is actually machine text
            // (`font-mono`, `[data-identifier]`, `[data-figure]`, the code
            // editor, the console, the transcript). `font-light` is gone with
            // it: 400 is the floor (see the weight scale in globals.css).
            className="grid h-full min-h-0 w-full grid-cols-[minmax(0,1fr)] overflow-hidden text-[var(--shell-text)] [--shell-strip:0px] lg:grid-cols-[auto_minmax(0,1fr)]"
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
               // tab bar's More is how it opens.
               <div
                  data-shell-chrome
                  className="hidden w-9 flex-none justify-center bg-[var(--shell-rail)] pt-4 lg:flex"
               >
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
               // Below `lg` the canvas stops at the tab bar's top edge: under
               // it, the bar would cover whatever was last on screen — a
               // list's final row, the comment box's attach button.
               className={`relative flex h-full max-h-full min-h-0 min-w-0 flex-col pb-[calc(var(--shell-tabbar-h)+env(safe-area-inset-bottom))] lg:pb-0 ${settingsMode ? 'lg:py-2 lg:pr-2' : ''}`}
            >
               {/* Radius + overflow live on an inner surface so the floating
                   chrome in the corner is not clipped by the curve.
                   `min-h-0` is load-bearing: without it a grid/flex item's
                   default min-height:auto grows with page content, the
                   rounded box becomes as tall as the list, and the bottom
                   radius (and scroll) disappear past the frame. */}
               <div
                  className={`relative flex min-h-0 flex-1 flex-col overflow-hidden ${
                     settingsMode
                        ? // Framed on the dark theme only; on light the canvas
                          // already stands off the grey frame by its fill.
                          'rounded-[12px] dark:lg:border dark:lg:border-[var(--shell-line)]'
                        : // Same on the main canvas: the edge beside the rail
                          // is drawn on dark only.
                          'rounded-[10px] dark:lg:border-l dark:lg:border-[var(--shell-line)]'
                  }`}
               >
                  <NavigationProgress />
                  {/* `--shell-canvas` is light only inside the rail's
                      `[data-shell-chrome]`, so on light the canvas takes the
                      page background instead: it shows through while a route
                      loads or redirects, and was a dark block in a light frame. */}
                  <main className="min-h-0 flex-1 overflow-hidden bg-background dark:bg-[var(--shell-canvas)]">
                     {children}
                  </main>
                  <NotificationToasts />
               </div>
               {/* The launcher stands on top of the floating stack (see
                   floating-stack-store.ts), so page controls in the corner push
                   it up instead of sitting under it. */}
               <div className="hidden lg:contents">
                  <ShellLauncherDock />
               </div>
            </div>
            <ShellTabBar
               ref={menuRef}
               orgId={orgId}
               active={activeRoute}
               menuOpen={railOverlayOpen}
               onOpenMenu={openOverlay}
            />
         </div>
      </ShortcutProvider>
   );
}
