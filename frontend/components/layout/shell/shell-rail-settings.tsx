'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChevronLeft } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { settingsNav } from '@/components/layout/sidebar/nav-settings';
import { isNavItemActive } from '@/lib/nav-active';
import { ShellNavIcon, shellNavRow } from './shell-icon';
import { ShellSectionFold } from './shell-section-fold';

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
 * Rows, spacing and group headings are the workspace rail's own
 * (`shellNavRow`, `ShellSectionFold`), so the two modes read as one rail. Each
 * group folds; every group starts open, and a choice lasts while the rail is
 * mounted.
 *
 * `trailing` is the rail's close control below `lg`, placed on the back row
 * so the overlay has a visible way out whatever the rail is showing.
 */
export function ShellRailSettings({ orgId, trailing }: { orgId: string; trailing?: ReactNode }) {
   const pathname = usePathname() ?? '';
   const t = useTranslations('workspaceAdmin');

   const [folded, setFolded] = useState<Record<string, boolean>>({});

   return (
      <div className="flex flex-col pb-3.5">
         <div className="flex items-center justify-between gap-2 px-3 pt-3.5 pb-1">
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
            <ShellSectionFold
               key={group.labelKey}
               heading={t(`groups.${group.labelKey}`)}
               open={!folded[group.labelKey]}
               onOpenChange={(open) =>
                  setFolded((current) => ({ ...current, [group.labelKey]: !open }))
               }
            >
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
                              <ShellNavIcon on={active}>
                                 <item.icon className="size-[13px] flex-none" />
                              </ShellNavIcon>
                              <span className="min-w-0 truncate">{t(`nav.${item.labelKey}`)}</span>
                           </Link>
                        </li>
                     );
                  })}
               </ul>
            </ShellSectionFold>
         ))}
      </div>
   );
}
