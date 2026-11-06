'use client';

import type { ReactNode } from 'react';

import { BerryWordmark } from '@/components/brand/berry-mark';
import { BrandThemeCanvas, BrandThemeFooter } from '@/components/brand/theme-canvas';
import { cn } from '@/lib/utils';

interface AuthCardProps {
   title: string;
   /** Supporting line under the title. May include emphasis. */
   description?: ReactNode;
   children: ReactNode;
   /** Cross-link under the card body (legacy callers). Prefer `topAction`. */
   footer?: ReactNode;
   /** Right-side header action, e.g. "No account? Sign up". */
   topAction?: ReactNode;
   /** Shows a Back control above the title. */
   onBack?: () => void;
   /** Banner inside the card. */
   error?: string | null;
   /** Signup-style progress: filled through `current` of `total`. */
   steps?: { total: number; current: number };
   className?: string;
}

/**
 * Auth scaffold for sign-in, registration and onboarding. Matches the Berry
 * Auth canvas: void canvas, soft grid, wordmark in the header, one centred
 * panel, and a quiet legal footer.
 */
export function AuthCard({
   title,
   description,
   children,
   footer,
   topAction,
   onBack,
   error,
   steps,
   className,
}: AuthCardProps) {
   return (
      <BrandThemeCanvas className={className}>
         <div className="flex min-h-full flex-1 flex-col px-8 py-7">
            <header className="flex items-center gap-2.5">
               <BerryWordmark size="lg" />
               {topAction ? (
                  <div
                     data-auth-top
                     className="ml-auto flex shrink-0 items-center gap-2 whitespace-nowrap text-[var(--brand-slate)]"
                  >
                     {topAction}
                  </div>
               ) : null}
            </header>

            <div className="flex flex-1 items-center justify-center py-10">
               <div
                  className={cn(
                     'flex w-full max-w-[400px] flex-col gap-7 rounded-2xl border border-[#1f1f23]',
                     'bg-[color-mix(in_oklab,var(--brand-void)_85%,transparent)] p-8 backdrop-blur-[2px]'
                  )}
               >
                  <div className="flex flex-col gap-2">
                     {onBack ? (
                        <button
                           type="button"
                           onClick={onBack}
                           className="mb-2 inline-flex items-center gap-1.5 self-start text-[var(--brand-ash)] transition-colors hover:text-[var(--brand-chalk)]"
                        >
                           <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              aria-hidden
                           >
                              <path d="M15 6l-6 6 6 6" />
                           </svg>
                           Back
                        </button>
                     ) : null}
                     <h1
                        data-heading="display"
                        className="m-0 leading-[1.2] font-semibold tracking-[-0.025em] text-pretty"
                     >
                        {title}
                     </h1>
                     {description ? (
                        <p className="m-0 leading-relaxed text-pretty text-[var(--brand-ash)]">
                           {description}
                        </p>
                     ) : null}
                  </div>

                  {error ? (
                     <div
                        role="alert"
                        className="flex gap-2.5 rounded-[10px] bg-[color-mix(in_oklab,var(--brand-danger)_10%,#19191c)] px-3 py-2.5 leading-normal text-[#f0a49d]"
                     >
                        <svg
                           width="14"
                           height="14"
                           viewBox="0 0 24 24"
                           fill="none"
                           stroke="currentColor"
                           strokeWidth="2"
                           className="mt-0.5 shrink-0"
                           aria-hidden
                        >
                           <circle cx="12" cy="12" r="9" />
                           <path d="M12 8v5M12 16v.5" />
                        </svg>
                        <span>{error}</span>
                     </div>
                  ) : null}

                  {children}

                  {footer ? <div className="text-[var(--brand-slate)]">{footer}</div> : null}

                  {steps && steps.total > 0 ? (
                     <div className="flex gap-1.5" aria-hidden>
                        {Array.from({ length: steps.total }, (_, index) => (
                           <span
                              key={index}
                              className={cn(
                                 'h-0.5 flex-1 rounded-sm',
                                 index <= steps.current
                                    ? 'bg-[#e3b341]'
                                    : 'bg-[var(--brand-hairline)]'
                              )}
                           />
                        ))}
                     </div>
                  ) : null}
               </div>
            </div>

            <BrandThemeFooter />
         </div>
      </BrandThemeCanvas>
   );
}
