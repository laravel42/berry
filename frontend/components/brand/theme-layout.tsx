'use client';

import type { ReactNode } from 'react';

import { BerryWordmark } from '@/components/brand/berry-mark';
import { BrandThemeCanvas, BrandThemeFooter } from '@/components/brand/theme-canvas';
import { cn } from '@/lib/utils';

export type BrandThemeNavItem = {
   id: string;
   label: string;
   href?: string;
   active?: boolean;
   onSelect?: () => void;
};

interface BrandThemeLayoutProps {
   children: ReactNode;
   /** Page title in the main panel. Uses `data-heading="display"`. */
   title?: ReactNode;
   /** Supporting line under the title. */
   description?: ReactNode;
   /** Right side of the top bar (e.g. account switch). */
   topAction?: ReactNode;
   /**
    * Left rail links. Gold underline marks the active item — same accent as
    * Auth primary controls.
    */
   nav?: BrandThemeNavItem[];
   /** Replace the default nav rail with a custom sidebar. */
   sidebar?: ReactNode;
   /** Hide the soft legal footer. */
   hideFooter?: boolean;
   className?: string;
   /** Classes on the main panel (the bordered content surface). */
   panelClassName?: string;
}

/**
 * General app shell in the Berry Auth visual language: void canvas, soft
 * grid, wordmark header, optional sidebar, bordered main panel, quiet footer.
 *
 * This is the Brand Theme layout for Auth-adjacent and brand surfaces. The
 * product workspace still uses `MainLayout` / `BerryShell`.
 */
export function BrandThemeLayout({
   children,
   title,
   description,
   topAction,
   nav,
   sidebar,
   hideFooter = false,
   className,
   panelClassName,
}: BrandThemeLayoutProps) {
   const showRail = sidebar !== undefined || (nav !== undefined && nav.length > 0);

   return (
      <BrandThemeCanvas className={className}>
         <div className="relative flex min-h-svh flex-1 flex-col px-8 py-7">
            <header className="flex items-center gap-2.5">
               <BerryWordmark size="md" />
               {topAction ? (
                  <div
                     data-auth-top
                     className="ml-auto flex shrink-0 items-center gap-2 whitespace-nowrap text-[var(--brand-slate)]"
                  >
                     {topAction}
                  </div>
               ) : null}
            </header>

            <div
               className={cn(
                  'mt-8 flex min-h-0 flex-1 gap-6',
                  showRail ? 'items-stretch' : 'justify-center'
               )}
            >
               {showRail ? (
                  <aside className="flex w-[200px] shrink-0 flex-col gap-1 pt-1">
                     {sidebar ??
                        nav?.map((item) => {
                           const className = cn(
                              'rounded-[10px] px-3 py-2.5 text-left font-medium transition-colors',
                              item.active
                                 ? 'bg-[#19191c] text-[var(--brand-chalk)] shadow-[inset_0_0_0_1px_#2a2a2f]'
                                 : 'text-[var(--brand-ash)] hover:bg-[#161618] hover:text-[var(--brand-chalk)]'
                           );
                           if (item.href) {
                              return (
                                 <a
                                    key={item.id}
                                    href={item.href}
                                    aria-current={item.active ? 'page' : undefined}
                                    className={className}
                                 >
                                    <NavLabel active={item.active}>{item.label}</NavLabel>
                                 </a>
                              );
                           }
                           return (
                              <button
                                 key={item.id}
                                 type="button"
                                 aria-current={item.active ? 'page' : undefined}
                                 className={className}
                                 onClick={item.onSelect}
                              >
                                 <NavLabel active={item.active}>{item.label}</NavLabel>
                              </button>
                           );
                        })}
                  </aside>
               ) : null}

               <main
                  className={cn(
                     'flex min-h-0 min-w-0 flex-1 flex-col gap-7 rounded-2xl border border-[#1f1f23]',
                     'bg-[color-mix(in_oklab,var(--brand-void)_85%,transparent)] p-8 backdrop-blur-[2px]',
                     !showRail && 'max-w-3xl',
                     panelClassName
                  )}
               >
                  {title || description ? (
                     <div className="flex flex-col gap-2">
                        {title ? (
                           <h1
                              data-heading="display"
                              className="m-0 leading-[1.2] font-semibold tracking-[-0.025em] text-pretty"
                           >
                              {title}
                           </h1>
                        ) : null}
                        {description ? (
                           <p className="m-0 leading-relaxed text-pretty text-[var(--brand-ash)]">
                              {description}
                           </p>
                        ) : null}
                     </div>
                  ) : null}
                  <div className="flex min-h-0 flex-1 flex-col gap-5">{children}</div>
               </main>
            </div>

            {hideFooter ? null : <BrandThemeFooter className="mt-8" />}
         </div>
      </BrandThemeCanvas>
   );
}

function NavLabel({ active, children }: { active?: boolean; children: ReactNode }) {
   return (
      <span className="inline-flex items-center gap-2">
         <span
            aria-hidden
            className={cn(
               'size-1.5 rounded-full',
               active ? 'bg-[#e3b341]' : 'bg-[var(--brand-hairline)]'
            )}
         />
         {children}
      </span>
   );
}
