'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Void canvas + soft radial grid from the Berry Auth canvas. Shared by the
 * centred Auth panel and the Brand Theme app shell so both stay on one
 * surface language.
 */
export function BrandThemeCanvas({
   children,
   className,
}: {
   children: ReactNode;
   className?: string;
}) {
   return (
      <div
         className={cn(
            'relative isolate flex min-h-svh flex-col bg-[var(--brand-void)] text-[var(--brand-chalk)]',
            className
         )}
      >
         <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(rgba(242,240,237,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(242,240,237,0.035)_1px,transparent_1px)] bg-size-[48px_48px] bg-position-[center] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_45%,#000_0%,rgba(0,0,0,0.5)_45%,transparent_80%)]"
         />
         {children}
      </div>
   );
}

/** Quiet legal footer used under Auth and Brand Theme shells. */
export function BrandThemeFooter({ className }: { className?: string }) {
   return (
      <footer className={cn('flex gap-5 text-[var(--brand-slate)]', className)}>
         <span>© 2026 Laravel42</span>
         <a
            className="ml-auto text-[var(--brand-slate)] hover:text-[var(--brand-ash)]"
            href="https://berry.pm/privacy"
            target="_blank"
            rel="noreferrer"
         >
            Privacy
         </a>
         <a
            className="text-[var(--brand-slate)] hover:text-[var(--brand-ash)]"
            href="https://berry.pm/terms"
            target="_blank"
            rel="noreferrer"
         >
            Terms
         </a>
         <a
            className="text-[var(--brand-slate)] hover:text-[var(--brand-ash)]"
            href="https://status.berry.pm"
            target="_blank"
            rel="noreferrer"
         >
            Status
         </a>
      </footer>
   );
}
