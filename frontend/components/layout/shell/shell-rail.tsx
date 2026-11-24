'use client';

import { useEffect, useState, type Ref } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Layers, LogOut, MessageSquare, Play, Search, Settings, X } from 'lucide-react';
import { useSignOut } from '@/components/auth/use-sign-out';
import { WORKSPACE_SLUG } from '@/lib/config';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
   isSidebarItemVisible,
   manageOpenByDefault,
   resolveOrder,
   useSidebarPrefsStore,
   type SidebarItemKey,
   type SidebarSection,
} from '@/store/sidebar-prefs-store';
import { isTerminalRunStatus } from '@/lib/runs';
import { useRunsStore } from '@/store/runs-store';
import { useSessionStore } from '@/store/session-store';
import { useCommandPaletteStore } from '@/store/command-palette-store';
import { useIsShellOverlay } from '@/hooks/use-mobile';
import { SHELL_SECTIONS, type ShellRouteDef, type ShellRoute } from './shell-routes';
import { BerryWordmark } from '@/components/brand/berry-mark';
import { ShellIcon, ShellNavIcon, shellNavRow } from './shell-icon';
import { WorkspaceMenuItems } from './workspace-menu';
import { ShellRailSettings } from './shell-rail-settings';
import { ShellPins } from './shell-pins';
import { ShellPersonal } from './shell-personal';
import { ShellSectionFold } from './shell-section-fold';

/** A workspace route the user can pin or hide. */
type PinnableRoute = ShellRouteDef & { prefsKey: SidebarItemKey };

interface ShellRailProps {
   orgId: string;
   active: ShellRoute | null;
   /** Settings replaces the rail's contents, as it did in AppSidebar. */
   settingsMode: boolean;
   /** At `md` and above: shown as a column, or collapsed to its expand control. */
   columnOpen: boolean;
   /** Below `md`: shown as an overlay over the page, or slid away. */
   overlayOpen: boolean;
   /** The close control below `md`: put the overlay away. */
   onDismiss: () => void;
   /** The shell moves focus into the rail when the overlay opens. */
   ref?: Ref<HTMLElement>;
}

/**
 * The left rail: brand, primary routes, workspace routes, configure routes.
 *
 * Ported from `Berry Prototype.dc.html`. Nav items are links rather than click
 * handlers so middle-click, cmd-click, and "copy link address" behave the way
 * they do everywhere else — the prototype used div+onClick, which silently
 * removes all three.
 *
 * One element, two shapes. At `md` and above it is a 232px column in the
 * shell's grid, collapsible via the shortcut and the expand control when
 * folded. Below `md` it is a 312px overlay that slides in from the left edge over the
 * page, closed until the strip's menu button opens it. The switch is made
 * in CSS (`md:` classes) so the server's render and the first paint agree;
 * the breakpoint hook only governs behaviour that CSS cannot express, such
 * as `inert`.
 */
export function ShellRail({
   orgId,
   active,
   settingsMode,
   columnOpen,
   overlayOpen,
   onDismiss,
   ref,
}: ShellRailProps) {
   const t = useTranslations('shell');
   const tWorkspaces = useTranslations('navigation.workspaces');
   const { visibility, order, manageOpen, workOpen, setManageOpen, setWorkOpen } =
      useSidebarPrefsStore();
   const activeWorkspace = useSessionStore((state) => state.workspace);
   const role = activeWorkspace?.role;
   const slug = activeWorkspace?.slug || orgId || WORKSPACE_SLUG;
   const { signOut, pending: signingOut } = useSignOut();
   const isMobile = useIsShellOverlay();
   const pathname = usePathname();
   const onSettings = pathname === `/${slug}/settings` || pathname.startsWith(`/${slug}/settings/`);
   const openPalette = useCommandPaletteStore((state) => state.open);
   // A run that has not reached a terminal status is still going, which is what
   // the dot beside runtimes reports.
   const runsLive = useRunsStore((state) =>
      state.runs.some((run) => !isTerminalRunStatus(run.status))
   );

   // The preference store is persisted, so its first client value differs from
   // what the server rendered. Rendering the unfiltered list until mount keeps
   // hydration consistent, matching the legacy sidebar's behaviour.
   const [mounted, setMounted] = useState(false);
   useEffect(() => setMounted(true), []);

   /**
    * Apply the user's pin preferences to a section, returning what is shown in
    * the rail.
    */
   const partition = (routes: ShellRouteDef[], prefsSection?: SidebarSection) => {
      // Narrowing here rather than asserting later keeps prefsKey non-optional
      // for the rest of the function.
      const pinnable = routes.filter((route): route is PinnableRoute => Boolean(route.prefsKey));
      if (!mounted || pinnable.length === 0) return routes;

      const ordered = resolveOrder(
         prefsSection ? order[prefsSection] : undefined,
         pinnable.map((route) => route.prefsKey)
      )
         .map((key) => pinnable.find((route) => route.prefsKey === key))
         .filter((route): route is PinnableRoute => Boolean(route))
         .filter((route) => isSidebarItemVisible(visibility[route.prefsKey], 0));

      // Placeholders have no prefsKey and always show. Pinnable items keep the
      // user's order in the slots they occupy; hidden pins drop out.
      if (pinnable.length === routes.length) return ordered;

      const queue = [...ordered];
      const shown: ShellRouteDef[] = [];
      for (const route of routes) {
         if (!route.prefsKey) {
            shown.push(route);
            continue;
         }
         if (!isSidebarItemVisible(visibility[route.prefsKey], 0)) continue;
         const next = queue.shift();
         if (next) shown.push(next);
      }
      return shown;
   };

   // The overlay's way out, on the row the rail starts with whatever it is
   // showing. Escape and the backdrop close it too; this is the one you can see.
   const closeButton = (
      <button
         type="button"
         onClick={onDismiss}
         aria-label={t('rail.closeMenu')}
         className="flex size-11 flex-none cursor-pointer items-center justify-center rounded text-[var(--shell-text-muted)] transition-colors hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)] md:hidden"
      >
         <X size={18} strokeWidth={1.8} aria-hidden="true" />
      </button>
   );

   return (
      <nav
         ref={ref}
         id="shell-rail"
         data-shell-chrome
         aria-label={t('rail.workspace')}
         // Off screen and out of the tab order while closed below `md`.
         // Opening switches visibility at once, so focus can move in on the
         // same tick; closing delays it to the end of the slide, so the panel
         // is seen leaving rather than vanishing.
         inert={isMobile && !overlayOpen}
         className={[
            'flex h-full min-h-0 flex-col overflow-hidden bg-[var(--shell-rail)]',
            'fixed inset-y-0 left-0 z-50 max-w-[85vw] border-r border-[var(--shell-line)]',
            'w-[312px] md:w-[232px]',
            'duration-200 ease-out motion-reduce:transition-none',
            overlayOpen
               ? 'visible translate-x-0 transition-transform'
               : 'invisible -translate-x-full transition-[transform,visibility] [transition-delay:0s,200ms]',
            'md:visible md:static md:inset-auto md:z-auto md:max-w-none md:translate-x-0 md:border-r-0 md:transition-none',
            columnOpen ? 'md:flex' : 'md:hidden',
         ].join(' ')}
      >
         {settingsMode ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
               <ShellRailSettings orgId={orgId} trailing={closeButton} />
            </div>
         ) : (
            <>
               {/* The brand opens the workspace switcher directly. The rail
                   folds via the sidebar shortcut; the expand control restores it. */}
               <div className="flex shrink-0 items-center gap-1 px-3 pt-2">
                  <DropdownMenu>
                     <DropdownMenuTrigger asChild>
                        <button
                           type="button"
                           aria-label={t('rail.workspaceMenu')}
                           className="group/ws flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded px-3 py-2.5 text-left transition-colors hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)] data-[state=open]:bg-[var(--shell-hover)] data-[state=open]:text-[var(--shell-text)]"
                        >
                           <BerryWordmark size="md" href={null} />
                           <svg
                              width="18"
                              height="18"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={1.7}
                              className="ml-auto translate-x-1 text-[var(--shell-text-dim)] transition-colors group-hover/ws:text-[var(--shell-text-muted)] group-data-[state=open]/ws:text-[var(--shell-text-muted)]"
                              aria-hidden="true"
                           >
                              <path d="M8 10l4-4 4 4M8 14l4 4 4-4" />
                           </svg>
                        </button>
                     </DropdownMenuTrigger>
                     <DropdownMenuContent
                        className="min-w-60 rounded-lg"
                        side="bottom"
                        align="start"
                     >
                        <WorkspaceMenuItems orgId={orgId} />
                     </DropdownMenuContent>
                  </DropdownMenu>
                  {closeButton}
               </div>

               <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                  {/* Search on a phone, where there is no ⌘K to press. The menu
                      goes away first, so the palette opens over the page rather than
                      over the menu. A column at `md` has the shortcut and no row. */}
                  <div className="px-3 md:hidden">
                     <button
                        type="button"
                        data-shell-nav
                        onClick={() => {
                           onDismiss();
                           openPalette();
                        }}
                        className={`${shellNavRow(false)} w-full cursor-pointer text-left`}
                     >
                        <ShellNavIcon on={false}>
                           <Search size={13} strokeWidth={2} />
                        </ShellNavIcon>
                        {t('rail.search')}
                     </button>
                  </div>

                  <ShellPersonal orgId={orgId} />

                  {SHELL_SECTIONS.map((section) => {
                     const shown = partition(section.routes, section.prefsSection);
                     const heading = section.headingKey
                        ? t(`sections.${section.headingKey}`)
                        : null;
                     const list = (
                        <ul className="flex flex-col gap-0 px-3 md:gap-1">
                           {shown.map((route) => {
                              const on = Boolean(route.href) && route.id === active;
                              const className = shellNavRow(on);
                              const inner = (
                                 <>
                                    <ShellNavIcon on={on}>
                                       <ShellIcon path={route.icon} size={13} />
                                    </ShellNavIcon>
                                    {t(`nav.${route.labelKey}`)}
                                    {route.live === 'runs' && runsLive ? (
                                       <span
                                          aria-label={t('rail.runsInProgress')}
                                          title={t('rail.runsInProgress')}
                                          className="ml-auto size-[5px] rounded-full bg-[var(--brand-azure)] [animation:berrypulse_2s_ease-in-out_infinite] motion-reduce:animate-none"
                                       />
                                    ) : null}
                                 </>
                              );
                              return (
                                 <li key={route.id}>
                                    {route.href ? (
                                       <Link
                                          prefetch={false}
                                          data-shell-nav
                                          href={`/${orgId}${route.href}`}
                                          aria-current={on ? 'page' : undefined}
                                          className={className}
                                       >
                                          {inner}
                                       </Link>
                                    ) : (
                                       <span data-shell-nav className={className}>
                                          {inner}
                                       </span>
                                    )}
                                 </li>
                              );
                           })}
                        </ul>
                     );

                     if (heading === null) {
                        return <div key="primary">{list}</div>;
                     }

                     // Manage starts open for owners and admins, and for anyone
                     // whose current page lives inside it, until they choose.
                     // Work starts open. A choice, once made, is kept. Before
                     // mount the stored choice is unknown, so the default shows.
                     const activeInside = shown.some((route) => route.id === active);
                     const manageExpanded = mounted
                        ? (manageOpen ?? (manageOpenByDefault(role) || activeInside))
                        : manageOpenByDefault(role) || activeInside;
                     const workExpanded = mounted ? (workOpen ?? true) : true;
                     const expanded =
                        section.headingKey === 'manage' ? manageExpanded : workExpanded;
                     return (
                        <ShellSectionFold
                           key={section.heading}
                           heading={heading}
                           open={expanded}
                           onOpenChange={
                              section.headingKey === 'manage' ? setManageOpen : setWorkOpen
                           }
                        >
                           {list}
                        </ShellSectionFold>
                     );
                  })}

                  {/* Pages a phone has no other way to reach: the column has ⌘K
                      and the Agents pill. Below `md` only. */}
                  <div className="md:hidden">
                     <div className="px-3 pt-2">
                        <div
                           data-heading="label"
                           className="flex min-h-11 w-full items-center gap-1 px-3 py-[7px] text-left text-[var(--shell-text-dim)]"
                        >
                           {t('sections.more')}
                        </div>
                     </div>
                     <ul className="flex flex-col gap-0 px-3">
                        {(
                           [
                              { path: '/chat', label: 'chat', Icon: MessageSquare },
                              { path: '/views', label: 'views', Icon: Layers },
                              { path: '/runs', label: 'runs', Icon: Play },
                           ] as const
                        ).map(({ path, label, Icon }) => {
                           const href = `/${orgId}${path}`;
                           const on = pathname === href || pathname.startsWith(`${href}/`);
                           return (
                              <li key={path}>
                                 <Link
                                    prefetch={false}
                                    data-shell-nav
                                    href={href}
                                    aria-current={on ? 'page' : undefined}
                                    className={shellNavRow(on)}
                                 >
                                    <ShellNavIcon on={on}>
                                       <Icon size={13} strokeWidth={2} />
                                    </ShellNavIcon>
                                    {t(`nav.${label}`)}
                                 </Link>
                              </li>
                           );
                        })}
                     </ul>
                  </div>

                  {/* Pins are shortcuts into the work, so they belong to the main
                      rail only; the settings rail lists settings pages and nothing else. */}
                  <ShellPins orgId={orgId} />
               </div>
            </>
         )}

         {/* Settings and Log out stay anchored at the bottom of the rail so they
             sit flush at the bottom even on very tall screens. */}
         <div
            data-shell-rail-footer
            className="mt-auto shrink-0 border-t border-[var(--shell-line)] px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-3"
         >
            <ul className="flex flex-col gap-0 md:gap-1">
               {!settingsMode ? (
                  <li>
                     <Link
                        prefetch={false}
                        data-shell-nav
                        href={`/${slug}/settings`}
                        aria-current={onSettings ? 'page' : undefined}
                        className={shellNavRow(onSettings)}
                     >
                        <ShellNavIcon on={onSettings}>
                           <Settings size={13} strokeWidth={2} />
                        </ShellNavIcon>
                        {t('nav.settings')}
                     </Link>
                  </li>
               ) : null}
               <li>
                  <button
                     type="button"
                     data-shell-nav
                     disabled={signingOut}
                     onClick={() => void signOut()}
                     className={`${shellNavRow(false)} w-full cursor-pointer text-left disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                     <ShellNavIcon on={false}>
                        <LogOut size={13} strokeWidth={2} />
                     </ShellNavIcon>
                     {tWorkspaces('logOut')}
                  </button>
               </li>
            </ul>
         </div>
      </nav>
   );
}
