'use client';

import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * The official isotipo, drawn from `public/isotipo.svg` rather than approximated.
 *
 * Two things differ from the mark this replaces, and both are visible: the
 * brackets fill the full height of the box instead of about 78% of it, and the
 * dot is half the box across instead of a third. Measured off the asset, not
 * guessed -- the brackets are 100x100 on a 100 grid, and the dot is 50.32.
 *
 * The asset fills its shapes; the mark this replaces stroked them. Filling is
 * what makes the bracket a shape with a bevelled inner step rather than a line
 * of even weight, which is the part an approximation cannot reach. It also
 * means `fill="currentColor"`, so every tone and state below still works by
 * setting `color`.
 */
const BRACKETS =
   'M18.75,10.42V0H0v100h18.75v-10.42h-8.33V10.42h8.33ZM81.25,0v10.42h8.33v79.17h-8.33v10.42h18.75V0h-18.75Z';

/** The dot, as the asset places it: centred, radius 25.16 of 100. */
const DOT = 25.16;

export type BerryMarkTone = 'brand' | 'neutral' | 'working' | 'attention' | 'complete' | 'danger';

/**
 * `empty` draws the brackets with nothing between them. It is the unmet half of
 * a checklist: `[ ]` becomes `[*]` once the rule is satisfied, so the change is
 * a shape and not only a colour -- which the accessibility contract in
 * docs/design-system.md requires. `hollow` is not that: it draws a ring, which
 * reads as a state the mark is IN rather than as an absence.
 */
export type BerryMarkState = 'solid' | 'hollow' | 'crossed' | 'empty';

const toneClasses: Record<BerryMarkTone, string> = {
   brand: 'text-berry',
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
         viewBox="0 0 100 100"
         fill="none"
         focusable="false"
         className={cn('shrink-0 overflow-visible', sizeClasses[size], className)}
         {...accessibility}
         {...props}
      >
         <path
            d={BRACKETS}
            className={cn('text-lockup-ink', bracketClassName)}
            fill="currentColor"
         />
         {state === 'empty' ? null : state === 'crossed' ? (
            <path
               d="M37.5 37.5L62.5 62.5M62.5 37.5L37.5 62.5"
               className={dotTone}
               style={dotStyle}
               stroke="currentColor"
               strokeWidth="9.4"
               strokeLinecap="butt"
            />
         ) : (
            <>
               {pulse && (
                  <circle
                     cx="50"
                     cy="50"
                     r="35"
                     className={cn(
                        'origin-center fill-none stroke-current',
                        dotTone,
                        'animate-[berry-working_2s_ease-in-out_infinite]'
                     )}
                     style={dotStyle}
                     strokeWidth="4.7"
                  />
               )}
               <circle
                  cx="50"
                  cy="50"
                  /* A ring has to sit inside the dot's own edge, so it gives up
                     half its stroke width in radius to land there. */
                  r={state === 'hollow' ? DOT - 4 : DOT}
                  className={cn(
                     'origin-center stroke-current',
                     state === 'hollow' ? 'fill-none' : 'fill-current',
                     dotTone,
                     pulse && 'animate-[berry-working_2s_ease-in-out_infinite]'
                  )}
                  style={dotStyle}
                  strokeWidth={state === 'hollow' ? 8 : 0}
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
