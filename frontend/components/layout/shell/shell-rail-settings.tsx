'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';

import { settingsNav } from '@/components/layout/sidebar/nav-settings';
import { isNavItemActive } from '@/lib/nav-active';
import { shellNavRow } from './shell-icon';

/**
 * Settings mode for the rail.
 *
 * `AppSidebar` swapped its whole contents on settings routes — back-to-app plus
 * the settings groups — and the shell rail had no equivalent, so settings lost
 * its navigation entirely.
 *
 * The route data comes from `settingsNav` in `nav-settings.tsx`,
 * so the two cannot list different settings pages. Only the presentation is
 * reimplemented: the legacy components render sidebar primitives styled for the
 * light Circle sidebar, which would sit wrong in the dark rail and, being
 * outside SidebarProvider here, would throw.
 *
 * `trailing` is the rail's close control below `lg`, placed on the back row
 * so the overlay has a visible way out whatever the rail is showing.
 */
export function ShellRailSettings({ orgId, trailing }: { orgId: string; trailing?: ReactNode }) {
   const pathname = usePathname() ?? '';
   const t = useTranslations('workspaceAdmin');

   return (
      <>
         <div className="flex items-center justify-between gap-2 px-3.5 pt-4 pb-3.5">
            <Link
               href={`/${orgId}/tasks`}
               className="flex min-h-11 w-fit items-center gap-1.5 rounded-[5px] bg-[var(--shell-line)] px-2 py-1 text-[var(--shell-text-muted)] transition-colors hover:bg-[var(--shell-line-strong)] hover:text-[var(--shell-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)] lg:min-h-0"
            >
               <ChevronLeft className="size-4" />
               Back to app
            </Link>
            {trailing}
         </div>

         {settingsNav.map((group) => (
            <div key={group.labelKey}>
               <div className="px-6 pt-3 pb-1 uppercase tracking-[0.14em] text-[var(--shell-text-dim)] lg:pt-[18px] lg:pb-[7px]">
                  {t(`groups.${group.labelKey}`)}
               </div>
               <ul className="flex flex-col gap-0 px-3 lg:gap-1">
                  {group.items.map((item) => {
                     const href = `/${orgId}${item.url}`;
                     const active = isNavItemActive(pathname, href);
                     return (
                        <li key={`${group.labelKey}-${item.labelKey}`}>
                           <Link
                              data-shell-nav
                              href={href}
                              aria-current={active ? 'page' : undefined}
                              className={shellNavRow(active)}
                           >
                              <item.icon className="size-[15px] flex-none" />
                              {t(`nav.${item.labelKey}`)}
                           </Link>
                        </li>
                     );
                  })}
               </ul>
            </div>
         ))}
      </>
   );
}
