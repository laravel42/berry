'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';

import { settingsNav } from '@/components/layout/sidebar/nav-settings';
import { isNavItemActive } from '@/lib/nav-active';

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
      <div className="flex flex-col gap-0.5 px-2.5 pt-3.5 pb-3.5">
         <div className="mb-2 flex items-center justify-between gap-2">
            <Link
               href={`/${orgId}/tasks`}
               className="inline-flex min-h-11 w-fit items-center gap-1.5 rounded-[7px] bg-segment-track px-2.5 text-[var(--shell-text-muted)] transition-colors hover:bg-[var(--brand-hairline)] hover:text-[var(--shell-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)] lg:h-[30px] lg:min-h-0"
            >
               <ChevronLeft className="size-3" strokeWidth={2.2} />
               Back to app
            </Link>
            {trailing}
         </div>

         {settingsNav.map((group) => (
            <div key={group.labelKey} className="flex flex-col gap-0.5">
               <div
                  data-settings-type="small"
                  className="px-2.5 pt-4 pb-1 font-semibold text-[var(--shell-text-dim)]"
               >
                  {t(`groups.${group.labelKey}`)}
               </div>
               <ul className="flex flex-col gap-0.5">
                  {group.items.map((item) => {
                     const href = `/${orgId}${item.url}`;
                     const active = isNavItemActive(pathname, href);
                     return (
                        <li key={`${group.labelKey}-${item.labelKey}`}>
                           <Link
                              data-shell-nav
                              href={href}
                              aria-current={active ? 'page' : undefined}
                              className={settingsNavRow(active)}
                           >
                              <item.icon
                                 className="size-4 flex-none opacity-85"
                                 strokeWidth={1.7}
                              />
                              <span className="min-w-0 truncate">{t(`nav.${item.labelKey}`)}</span>
                           </Link>
                        </li>
                     );
                  })}
               </ul>
            </div>
         ))}
      </div>
   );
}

/** A settings rail row: 30px, radius 7; the active page sits on the input fill. */
function settingsNavRow(on: boolean): string {
   return [
      'flex min-h-11 items-center gap-2.5 rounded-[7px] px-2.5 transition-colors lg:h-[30px] lg:min-h-0',
      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]',
      on
         ? 'bg-segment-track text-[var(--shell-text)]'
         : 'text-[var(--shell-text-muted)] hover:bg-[var(--sidebar-accent)] hover:text-[var(--shell-text)]',
   ].join(' ');
}
