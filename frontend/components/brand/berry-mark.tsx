'use client';

import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

export type BerryMarkTone = 'brand' | 'neutral' | 'working' | 'attention' | 'complete' | 'danger';

export type BerryMarkState = 'solid' | 'hollow' | 'crossed';

const toneClasses: Record<BerryMarkTone, string> = {
   brand: 'text-primary',
   neutral: 'text-status-neutral',
   working: 'text-status-info',
   attention: 'text-status-warning',
   complete: 'text-status-success',
   danger: 'text-status-danger',
};

const sizeClasses = {
   sm: 'size-4',
   md: 'size-6',
   lg: 'size-9',
} as const;

interface BerryMarkProps extends Omit<ComponentProps<'svg'>, 'children'> {
   bracketClassName?: string;
   /** Overrides the tone colour on the centre dot (and its pulse ring). */
   dotColor?: string;
   label?: string;
   pulse?: boolean;
   size?: keyof typeof sizeClasses;
   state?: BerryMarkState;
   tone?: BerryMarkTone;
}

export function BerryMark({
   bracketClassName,
   className,
   dotColor,
   label,
   pulse = false,
   size = 'md',
   state = 'solid',
   tone = 'brand',
   ...props
}: BerryMarkProps) {
   const accessibility = label
      ? { 'role': 'img', 'aria-label': label }
      : { 'aria-hidden': true as const };
   const dotStyle = dotColor ? { color: dotColor } : undefined;
   const dotTone = dotColor ? undefined : toneClasses[tone];

   return (
      <svg
         viewBox="0 0 64 64"
         fill="none"
         focusable="false"
         className={cn('shrink-0 overflow-visible', sizeClasses[size], className)}
         {...accessibility}
         {...props}
      >
         <path
            d="M20 10H10V54H20M44 10H54V54H44"
            className={cn('text-foreground', bracketClassName)}
            stroke="currentColor"
            strokeWidth="6"
            strokeLinecap="butt"
            strokeLinejoin="miter"
         />
         {state === 'crossed' ? (
            <path
               d="M24 24L40 40M40 24L24 40"
               className={dotTone}
               style={dotStyle}
               stroke="currentColor"
               strokeWidth="6"
               strokeLinecap="butt"
            />
         ) : (
            <>
               {pulse && (
                  <circle
                     cx="32"
                     cy="32"
                     r="14"
                     className={cn(
                        'origin-center fill-none stroke-current',
                        dotTone,
                        'animate-[berry-working_2s_ease-in-out_infinite]'
                     )}
                     style={dotStyle}
                     strokeWidth="3"
                  />
               )}
               <circle
                  cx="32"
                  cy="32"
                  r="10"
                  className={cn(
                     'origin-center stroke-current',
                     state === 'hollow' ? 'fill-none' : 'fill-current',
                     dotTone,
                     pulse && 'animate-[berry-working_2s_ease-in-out_infinite]'
                  )}
                  style={dotStyle}
                  strokeWidth={state === 'hollow' ? 4 : 0}
               />
            </>
         )}
      </svg>
   );
}

/**
 * Lockup sizes matching the berry.pm nav mark (`apps/web` Logo + word).
 * Mark geometry and type are the public site's; do not restyle from the UI scale.
 */
const wordmarkSizes = {
   sm: { mark: 18, type: 18 },
   md: { mark: 22, type: 23 },
   lg: { mark: 28, type: 29 },
} as const;

interface BerryWordmarkProps {
   className?: string;
   size?: keyof typeof wordmarkSizes;
   /**
    * Home link target. Pass `null` when the lockup sits inside another control
    * (e.g. the shell workspace menu) so it is not nested in an interactive
    * element of its own.
    */
   href?: string | null;
}

/** The pulsing mark and a line, centred, while a pane is still fetching. */
export function BerryLoading({ label, className }: { label: string; className?: string }) {
   return (
      <div
         role="status"
         className={cn('flex size-full min-h-64 items-center justify-center', className)}
      >
         <div className="flex items-center gap-2 text-muted-foreground">
            <BerryMark size="md" tone="brand" pulse />
            <span>{label}</span>
         </div>
      </div>
   );
}

/** Public-site mark: brackets + berry (same paths as `apps/web` Logo.astro). */
function WordmarkMark({ size }: { size: number }) {
   return (
      <svg
         width={size}
         height={size}
         viewBox="0 0 64 64"
         aria-hidden
         className="shrink-0"
         focusable="false"
      >
         <path d="M14 8H8v48h6" stroke="currentColor" strokeWidth={6} fill="none" />
         <path d="M50 8h6v48h-6" stroke="currentColor" strokeWidth={6} fill="none" />
         <circle cx="32" cy="32" r={13} fill="#c74a5e" />
      </svg>
   );
}

function WordmarkLabel({ size }: { size: keyof typeof wordmarkSizes }) {
   const sizing = wordmarkSizes[size];
   return (
      <>
         <WordmarkMark size={sizing.mark} />
         {/* Same lockup as berry.pm: DM Serif Display, lowercase, accent period. */}
         <span
            data-wordmark={size}
            className="font-[family-name:var(--font-dm-serif-display)] leading-none tracking-[-0.02em]"
            style={{ fontSize: sizing.type }}
         >
            berry<span className="text-[#de6d80]">.</span>
         </span>
      </>
   );
}

export function BerryWordmark({ className, size = 'md', href = '/' }: BerryWordmarkProps) {
   const lockup = cn('inline-flex items-center gap-[11px] text-inherit no-underline', className);

   if (href === null) {
      return (
         <span className={lockup} aria-hidden>
            <WordmarkLabel size={size} />
         </span>
      );
   }

   return (
      <a href={href} aria-label="Berry home" className={lockup}>
         <WordmarkLabel size={size} />
      </a>
   );
}
