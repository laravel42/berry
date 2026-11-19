'use client';

import { ChevronLeft, CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { BerryWordmark } from '@/components/brand/berry-mark';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface AuthCardProps {
   title: string;
   /** Supporting line under the title. May include emphasis. */
   description?: ReactNode;
   children: ReactNode;
   /** Quiet lines under the card: the sign-in / sign-up switch, the legal note. */
   aside?: ReactNode;
   /** Shows a Back control above the title. */
   onBack?: () => void;
   /** Banner inside the card. */
   error?: string | null;
   /** Signup-style progress: filled through `current` of `total`. */
   steps?: { total: number; current: number };
   className?: string;
}

/**
 * Auth scaffold for sign-in, registration, invitations and onboarding, after
 * the Ledger sign-in screen: one centred column — the lockup, a card, and the
 * quiet lines under it. It follows the theme like the rest of the app and is
 * drawn with the app's own tokens and controls, so a person meets the same
 * surfaces, fields and buttons before and after they sign in.
 *
 * The title is a front-depth title (a person is being asked something), so it
 * is set in the interface face rather than the mono the app's page titles use.
 */
export function AuthCard({
   title,
   description,
   children,
   aside,
   onBack,
   error,
   steps,
   className,
}: AuthCardProps) {
   return (
      <div className={cn('h-full overflow-y-auto bg-background text-foreground', className)}>
         {/*
            A page with no shell has nothing for the app frame (the body
            border) to frame, so the frame takes the page colour while an
            AuthCard is mounted, in either theme. The rule goes with the page.
         */}
         <style>{':root:root:root{--app-frame:var(--background)}'}</style>
         <main className="mx-auto flex min-h-full w-full max-w-[470px] flex-col items-center justify-center gap-5 px-5 py-10">
            <BerryWordmark size="lg" />

            <section className="flex w-full flex-col gap-5 rounded-card border bg-card p-6 shadow-sm">
               <header className="flex flex-col gap-2 text-center">
                  {onBack ? (
                     <Button
                        type="button"
                        variant="quiet"
                        size="sm"
                        className="-ml-2 self-start"
                        onClick={onBack}
                     >
                        <ChevronLeft aria-hidden />
                        Back
                     </Button>
                  ) : null}
                  <h1 data-heading="display" className="font-sans tracking-[-0.01em] text-pretty">
                     {title}
                  </h1>
                  {description ? (
                     <p className="text-pretty text-muted-foreground">{description}</p>
                  ) : null}
               </header>

               {error ? (
                  <div
                     role="alert"
                     className="flex gap-2.5 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-destructive"
                  >
                     <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                     <span>{error}</span>
                  </div>
               ) : null}

               {children}

               {steps && steps.total > 0 ? (
                  <div className="flex gap-1.5" aria-hidden>
                     {Array.from({ length: steps.total }, (_, index) => (
                        <span
                           key={index}
                           className={cn(
                              'h-1 flex-1 rounded-full',
                              index <= steps.current ? 'bg-primary' : 'bg-border'
                           )}
                        />
                     ))}
                  </div>
               ) : null}
            </section>

            {aside ? (
               <div className="flex max-w-[44ch] flex-col items-center gap-2 text-center text-muted-foreground">
                  {aside}
               </div>
            ) : null}
         </main>
      </div>
   );
}

/** The legal line under a sign-in or sign-up card. */
export function AuthLegalNote() {
   return (
      <p className="text-2xs text-subtle-foreground">
         By continuing you agree to the{' '}
         <a
            href="https://berry.pm/terms"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4 hover:text-foreground"
         >
            terms
         </a>{' '}
         and the{' '}
         <a
            href="https://berry.pm/privacy"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4 hover:text-foreground"
         >
            privacy notice
         </a>
         .
      </p>
   );
}
