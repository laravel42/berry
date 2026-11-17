'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { settingsNav } from '@/components/layout/sidebar/nav-settings';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuLabel,
   DropdownMenuSeparator,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { isNavItemActive } from '@/lib/nav-active';

/**
 * The settings header, and the only settings navigation on a narrow screen.
 *
 * The rail carries the grouped list, but it is a fixed 232px column: below the
 * shell's breakpoint it is either crushed or in the way, and settings had no
 * other way to move between pages. This dropdown is that way. It shows only
 * where the rail does not (`lg:hidden`), so the two are never both on screen
 * competing to be the navigation.
 *
 * It reads the same `settingsNav`, keeping the groups and their order, so a
 * page added to the rail appears here without a second edit.
 */
/**
 * Pages under /settings that are not in the rail's list, which would otherwise
 * show a bare "Settings" with no page name. Labels are `workspaceAdmin.nav` keys.
 */
const offRailPages = [
   { segment: 'organization', labelKey: 'organization' },
   { segment: 'repositories', labelKey: 'repositories' },
   { segment: 'usage', labelKey: 'usage' },
] as const;

export default function HeaderNav({ trailing }: { trailing?: React.ReactNode }) {
   const t = useTranslations('settings.header');
   const admin = useTranslations('workspaceAdmin');
   const pathname = usePathname() ?? '';
   const { orgId } = useParams<{ orgId: string }>();

   const current = settingsNav
      .flatMap((group) => group.items)
      .find((item) => isNavItemActive(pathname, `/${orgId}${item.url}`));

   const currentLabelKey =
      current?.labelKey ??
      offRailPages.find((page) => isNavItemActive(pathname, `/${orgId}/settings/${page.segment}`))
         ?.labelKey;

   return (
      <div className="flex h-[52px] w-full items-center justify-between gap-3 border-b border-settings-panel-line px-5 py-1.5">
         {/* Breadcrumb: "Settings › Page". The h1 stays "Settings"; the page
             name is the section below it. */}
         <div className="flex min-w-0 items-baseline gap-2">
            <h1 className="m-0 shrink-0 font-normal text-subtle-foreground">{t('title')}</h1>
            {currentLabelKey ? (
               <>
                  {/* On a phone the selector on the right already names the page. */}
                  <ChevronRight
                     className="hidden size-2.5 shrink-0 sm:block text-settings-field-focus"
                     strokeWidth={2.5}
                     aria-hidden
                  />
                  <span className="hidden min-w-0 truncate font-semibold sm:inline">
                     {admin(`nav.${currentLabelKey}`)}
                  </span>
               </>
            ) : null}
         </div>

         <div className="flex min-w-0 items-center gap-2">
            {trailing}
            <DropdownMenu>
               <DropdownMenuTrigger
                  aria-label={admin('jump.label')}
                  className="lg:hidden inline-flex h-7 min-w-0 max-w-56 items-center gap-1.5 rounded-md border bg-container px-2.5 outline-none transition-colors hover:bg-accent"
               >
                  <span className="min-w-0 truncate">
                     {currentLabelKey ? admin(`nav.${currentLabelKey}`) : admin('jump.current')}
                  </span>
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
               </DropdownMenuTrigger>
               <DropdownMenuContent align="end" className="max-h-[70svh] min-w-52 overflow-y-auto">
                  {settingsNav.map((group, index) => (
                     <div key={group.labelKey}>
                        {index > 0 ? <DropdownMenuSeparator /> : null}
                        <DropdownMenuLabel data-heading="label" className="text-muted-foreground">
                           {admin(`groups.${group.labelKey}`)}
                        </DropdownMenuLabel>
                        {group.items.map((item) => {
                           const href = `/${orgId}${item.url}`;
                           return (
                              <DropdownMenuItem key={item.labelKey} asChild>
                                 <Link
                                    href={href}
                                    aria-current={
                                       isNavItemActive(pathname, href) ? 'page' : undefined
                                    }
                                    className="flex items-center gap-2"
                                 >
                                    <item.icon className="size-4 text-muted-foreground" />
                                    {admin(`nav.${item.labelKey}`)}
                                 </Link>
                              </DropdownMenuItem>
                           );
                        })}
                     </div>
                  ))}
               </DropdownMenuContent>
            </DropdownMenu>
         </div>
      </div>
   );
}
