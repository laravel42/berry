'use client';

import { useEffect, useState, type Ref } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronRight, X } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
import { selectOpenReviewCount, useReviewsStore } from '@/store/reviews-store';
import { useRunsStore } from '@/store/runs-store';
import { useSessionStore } from '@/store/session-store';
import { useIsMobile } from '@/hooks/use-mobile';
import { SHELL_SECTIONS, type ShellRouteDef, type ShellRoute } from './shell-routes';
import { ShellBadge } from './shell-badge';
import { ShellIcon, BerryMark, shellNavRow } from './shell-icon';
import { WorkspaceMenuItems } from './workspace-menu';
import { ShellRailSettings } from './shell-rail-settings';
import { ShellPins } from './shell-pins';
import { ShellPersonal } from './shell-personal';

/** A workspace route the user can pin or hide. */
type PinnableRoute = ShellRouteDef & { prefsKey: SidebarItemKey };

interface ShellRailProps {
   orgId: string;
   active: ShellRoute | null;
   /** Settings replaces the rail's contents, as it did in AppSidebar. */
   settingsMode: boolean;
   /** At `lg` and above: shown as a column, or collapsed to its expand control. */
   columnOpen: boolean;
   /** Below `lg`: shown as an overlay over the page, or slid away. */
   overlayOpen: boolean;
   /** The close control below `lg`: put the overlay away. */
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
 * One element, two shapes. At `lg` and above it is a 218px column in the
 * shell's grid (collapsible via the shortcut and the expand control when
 * folded). Below `lg` it is a 260px overlay that slides in from the left
 * edge over the page, closed until the strip's menu button opens it. The
 * switch is made in CSS (`lg:` classes) so the server's render and the first
 * paint agree; the breakpoint hook only governs behaviour that CSS cannot
 * express, such as `inert`.
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
   const { visibility, order, manageOpen, setManageOpen } = useSidebarPrefsStore();
   const role = useSessionStore((state) => state.workspace?.role);
   const isMobile = useIsMobile();
   // A run that has not reached a terminal status is still going, which is what
   // the dot beside runtimes reports.
   const runsLive = useRunsStore((state) =>
      state.runs.some((run) => !isTerminalRunStatus(run.status))
   );
   // Reviews badge only — approvals land in Inbox, so the rail no longer
   // reads the approvals store. Kept current by `useOpenReviewsSync`; null
   // until the first load, and a count nobody has yet is not worth showing.
   const openReviews = useReviewsStore(selectOpenReviewCount) ?? 0;

   /** What a route's badge currently says, for the badge and for "show when badged". */
   const badgeCount = (route: ShellRouteDef): number => {
      if (route.badge === 'reviews') return openReviews;
      return 0;
   };

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
         .filter((route) => isSidebarItemVisible(visibility[route.prefsKey], badgeCount(route)));

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
         if (!isSidebarItemVisible(visibility[route.prefsKey], badgeCount(route))) continue;
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
         className="flex size-11 flex-none cursor-pointer items-center justify-center rounded text-[var(--shell-text-muted)] transition-colors hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)] lg:hidden"
      >
         <X size={18} strokeWidth={1.8} aria-hidden="true" />
      </button>
   );

   return (
      <nav
         ref={ref}
         id="shell-rail"
         aria-label={t('rail.workspace')}
         // Off screen and out of the tab order while closed below `lg`.
         // Opening switches visibility at once, so focus can move in on the
         // same tick; closing delays it to the end of the slide, so the panel
         // is seen leaving rather than vanishing.
         inert={isMobile && !overlayOpen}
         className={[
            'flex flex-col overflow-y-auto bg-[var(--shell-rail)]',
            'fixed inset-y-0 left-0 z-50 w-[260px] max-w-[85vw] border-r border-[var(--shell-line)]',
            'duration-200 ease-out motion-reduce:transition-none',
            overlayOpen
               ? 'visible translate-x-0 transition-transform'
               : 'invisible -translate-x-full transition-[transform,visibility] [transition-delay:0s,200ms]',
            'lg:visible lg:static lg:inset-auto lg:z-auto lg:w-[218px] lg:max-w-none lg:translate-x-0 lg:border-r-0 lg:transition-none',
            columnOpen ? 'lg:flex' : 'lg:hidden',
         ].join(' ')}
      >
         {settingsMode ? (
            <ShellRailSettings orgId={orgId} trailing={closeButton} />
         ) : (
            <>
               {/* The brand opens the workspace menu, as it does throughout the app.
             The prototype wired this row to collapse the rail, but a
             chevrons-up-down glyph reads as a switcher everywhere else in the
             product, and settings and log out have no other home. The rail
             folds via the sidebar shortcut; the expand control restores it. */}
               <div className="flex items-center gap-1 px-3 pt-3">
                  <DropdownMenu>
                     <DropdownMenuTrigger asChild>
                        <button
                           type="button"
                           aria-label={t('rail.workspaceMenu')}
                           className="group/ws flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded px-3 py-2.5 text-left transition-colors hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)] data-[state=open]:bg-[var(--shell-hover)] data-[state=open]:text-[var(--shell-text)]"
                        >
                           <BerryMark size={24} />
                           <span
                              data-wordmark="md"
                              className="font-display leading-none tracking-[-0.025em] text-[var(--shell-text)]"
                           >
                              Berry<span className="text-[var(--shell-accent)]">.</span>
                           </span>
                           <svg
                              width="18"
                              height="18"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={1.7}
                              className="ml-auto text-[var(--shell-text-dim)] transition-colors group-hover/ws:text-[var(--shell-text-muted)] group-data-[state=open]/ws:text-[var(--shell-text-muted)]"
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

               <ShellPersonal orgId={orgId} />

               {SHELL_SECTIONS.map((section) => {
                  const shown = partition(section.routes, section.prefsSection);
                  const heading = section.headingKey ? t(`sections.${section.headingKey}`) : null;
                  const list = (
                     <ul className="flex flex-col gap-0 px-3 lg:gap-1">
                        {shown.map((route) => {
                           const on = Boolean(route.href) && route.id === active;
                           const className = shellNavRow(on);
                           const count = badgeCount(route);
                           const inner = (
                              <>
                                 <ShellIcon path={route.icon} />
                                 {t(`nav.${route.labelKey}`)}
                                 {route.live === 'runs' && runsLive ? (
                                    <span
                                       aria-label={t('rail.runsInProgress')}
                                       title={t('rail.runsInProgress')}
                                       className="ml-auto size-[5px] rounded-full bg-[var(--brand-azure)] [animation:berrypulse_2s_ease-in-out_infinite] motion-reduce:animate-none"
                                    />
                                 ) : null}
                                 {route.badge === 'reviews' ? (
                                    <ShellBadge
                                       count={count}
                                       label={t('rail.reviewsWaiting', { count })}
                                    />
                                 ) : null}
                              </>
                           );
                           return (
                              <li key={route.id}>
                                 {route.href ? (
                                    <Link
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

                  if (section.headingKey !== 'manage' || heading === null) {
                     return (
                        <div key={section.heading ?? 'primary'}>
                           {heading ? (
                              <div className="px-6 pt-3 pb-1 uppercase tracking-[0.14em] text-[var(--shell-text-dim)] lg:pt-[18px] lg:pb-[7px]">
                                 {heading}
                              </div>
                           ) : null}
                           {list}
                        </div>
                     );
                  }

                  // Manage folds. Owners and admins start with it open, since
                  // they are the ones who configure the workspace; anyone
                  // else starts with it closed, unless the page they are on
                  // lives inside it. A choice, once made, is kept. Before
                  // mount the stored choice is unknown, so the role decides.
                  const activeInside = shown.some((route) => route.id === active);
                  const expanded = mounted
                     ? (manageOpen ?? (manageOpenByDefault(role) || activeInside))
                     : manageOpenByDefault(role) || activeInside;
                  return (
                     <Collapsible
                        key={section.heading}
                        open={expanded}
                        onOpenChange={setManageOpen}
                     >
                        <div className="px-3 pt-2 lg:pt-[11px]">
                           <CollapsibleTrigger asChild>
                              {/* Radix supplies aria-expanded and aria-controls; the
                                  visible word is the name, so it never changes
                                  under a screen reader as it opens and closes. */}
                              <button
                                 type="button"
                                 className="group/fold flex min-h-11 w-full cursor-pointer items-center gap-1 rounded px-3 py-[7px] text-left uppercase tracking-[0.14em] text-[var(--shell-text-dim)] transition-colors hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text-muted)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)] lg:min-h-0"
                              >
                                 {heading}
                                 <ChevronRight
                                    size={12}
                                    strokeWidth={1.8}
                                    aria-hidden="true"
                                    className="transition-transform group-data-[state=open]/fold:rotate-90 motion-reduce:transition-none"
                                 />
                              </button>
                           </CollapsibleTrigger>
                        </div>
                        <CollapsibleContent>{list}</CollapsibleContent>
                     </Collapsible>
                  );
               })}
            </>
         )}

         <ShellPins orgId={orgId} />
      </nav>
   );
}
