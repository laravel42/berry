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
 * The lockup's proportions, measured off `public/logotipo.svg`.
 *
 * In the official lockup the mark is 100 tall where the word's capitals are
 * 61.3, and the gap between them is 25.1. So the mark is *taller* than the
 * text, closing over the line above and below it, and the ratios against the
 * word's font size come out at 1.186 for the mark and 0.297 for the gap.
 *
 * This is where the official asset and the Ledger spec disagree, and the asset
 * wins: the spec sets the mark as a 21px mono glyph against a 32px word, which
 * makes it two thirds of the word rather than larger than it. The spec was
 * standing a text character in for artwork it did not have.
 *
 * Both ratios are in `em`, which is why `data-wordmark` sits on the wrapper
 * rather than on the word: the font size has to be set above both children for
 * them to scale off it. That also keeps the lockup correct inside the sidebar,
 * which rewrites the --text-* scale under itself.
 */

interface BerryWordmarkProps {
   className?: string;
   size?: 'sm' | 'md' | 'lg';
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

export function BerryWordmark({ className, size = 'md' }: BerryWordmarkProps) {
   return (
      <span
         role="img"
         aria-label="Berry"
         /* Sized by attribute in app/globals.css: the lockup is the one
            sanctioned departure from the type scale, and it is easier to keep
            honest sitting next to the rule it departs from than as a lone
            text-* utility out here. */
         data-wordmark={size}
         className={cn('inline-flex items-center gap-[0.297em] leading-none', className)}
      >
         <BerryMark className="size-[1.186em]" />
         <span className="font-display tracking-[-0.025em] text-lockup-ink">
            {/* The official lockup ends on a berry period. An earlier pass
                removed it on the Ledger spec's authority; the asset has it. */}
            Berry<span className="text-berry">.</span>
         </span>
      </span>
   );
}
