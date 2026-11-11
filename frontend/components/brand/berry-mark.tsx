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
   /* The asset's berry, not the product's `--berry`. The two are a step
      apart, and this mark is the logo: it has to match the file it was
      traced from, on both colourways. */
   brand: 'text-lockup-berry',
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
 * Lockup heights, in pixels. The lockup is the brand asset, so it scales as
 * one drawing; do not restyle it from the UI type scale.
 */
const wordmarkSizes = { sm: 18, md: 22, lg: 28 } as const;

/** The asset is 352 wide on a 100 grid, so a height picks the width. */
const LOCKUP_RATIO = 3.52;

/**
 * The word, traced off `public/logotipo.svg`.
 *
 * It is drawn, not set. The lockup used to render the letters as live text in
 * DM Serif Display with a styled period, which is a different typeface from
 * the asset's outlines and shifted with the webfont's loading state; and the
 * mark beside it was a 64-grid approximation ported from `apps/web`'s
 * Logo.astro that stroked the brackets at an even weight and made the dot 0.41
 * of the box instead of 0.50. So the one mark a person sees most, in the rail,
 * was the only one on screen that was not the brand asset.
 *
 * The paths below are the asset's own, on its 352x100 grid beside the same
 * `BRACKETS` and `DOT` the symbol uses, which is why the lockup needs no
 * second copy of the mark. Colour is the asset's two tones and nothing else:
 * `--lockup-ink` for the brackets and the letters, `--lockup-berry` for the
 * berry and the final period.
 */
const WORD_LETTERS = [
   'M139.6,80.5l-14.5-1.1v-.9l.9-.2c2.2-.5,3.3-1.9,3.3-4.3V28.1c0-1.2-.2-2.1-.6-2.7-.4-.6-1.1-1.1-2.3-1.3l-1.2-.3v-.9l15.3-3.7,1,.8-.3,12.1v8.7c1.9-1.3,4-2.3,6.2-3,2.2-.7,4.5-1,6.8-1,3.3,0,6.2.8,8.7,2.3,2.5,1.5,4.5,3.9,6,7,1.5,3.2,2.2,7.3,2.2,12.2s-.8,9.1-2.4,12.4c-1.6,3.3-3.8,5.8-6.5,7.4-2.7,1.7-5.7,2.5-9,2.5s-4.3-.3-6.4-.9c-2.1-.6-4.1-1.4-5.7-2.4l-1.4,3.1ZM148.8,77.7c1.8,0,3.4-.6,4.8-1.7,1.4-1.1,2.5-3.1,3.3-5.9.8-2.8,1.2-6.6,1.2-11.5s-.4-8.6-1.1-11.3c-.7-2.6-1.8-4.5-3.1-5.5-1.3-1-3-1.5-4.9-1.5-2.7,0-5.2.7-7.5,2.2v33c1.1.7,2.2,1.2,3.4,1.6,1.1.4,2.5.6,4,.6Z',
   'M196.9,36.8c3.7,0,6.9.8,9.5,2.3,2.6,1.5,4.7,3.6,6.1,6.2,1.4,2.6,2.1,5.6,2.1,8.9s0,1.3,0,1.9c0,.7-.2,1.2-.3,1.8h-25.6c0,6.2,1.2,10.6,3.3,13.4s5.3,4.1,9.6,4.1,5.2-.5,7-1.4c1.8-.9,3.4-2.3,5-4l.9.8c-1.8,3.2-4.1,5.6-7.1,7.4-3,1.8-6.5,2.7-10.6,2.7s-7.7-.9-10.8-2.6c-3.2-1.7-5.6-4.3-7.4-7.5s-2.7-7.2-2.7-11.7,1-8.7,3.1-12,4.7-5.8,8-7.5c3.2-1.7,6.6-2.6,10.2-2.6ZM196.6,38.5c-1.7,0-3.1.5-4.3,1.5s-2.1,2.8-2.7,5.3c-.7,2.5-1,6.1-1.1,10.8h14.7c.6-6.2.3-10.7-.7-13.5-1-2.7-3-4.1-5.9-4.1Z',
   'M218.9,79.4v-.9l1.3-.3c1.1-.3,1.9-.9,2.4-1.5.4-.7.6-1.6.6-2.7v-26.9c0-1.3-.2-2.2-.6-2.8s-1.2-1-2.4-1.2l-1.3-.3v-.9l14.8-5,.9.9.8,7.4v.7c.8-1.6,1.8-3.1,3.1-4.4,1.3-1.3,2.7-2.4,4.3-3.3,1.6-.9,3.1-1.3,4.7-1.3s3.8.6,5,1.8c1.1,1.2,1.7,2.7,1.7,4.6s-.6,3.5-1.7,4.5c-1.1,1.1-2.4,1.6-4,1.6-2.4,0-4.5-1.2-6.4-3.6l-.2-.2c-.6-.8-1.2-1.2-2-1.3-.7,0-1.4.3-2.1,1.1-.6.5-1,1.1-1.4,1.8-.4.7-.7,1.5-1.1,2.5v24c0,2.3,1,3.7,3,4.3l2.7.8v.9h-22.3Z',
   'M256.8,79.4v-.9l1.3-.3c1.1-.3,1.9-.9,2.4-1.5.4-.7.6-1.6.6-2.7v-26.9c0-1.3-.2-2.2-.6-2.8s-1.2-1-2.4-1.2l-1.3-.3v-.9l14.8-5,.9.9.8,7.4v.7c.8-1.6,1.8-3.1,3.1-4.4,1.3-1.3,2.7-2.4,4.3-3.3,1.6-.9,3.1-1.3,4.7-1.3s3.8.6,5,1.8,1.7,2.7,1.7,4.6-.6,3.5-1.7,4.5c-1.1,1.1-2.4,1.6-4,1.6-2.4,0-4.5-1.2-6.4-3.6l-.2-.2c-.6-.8-1.2-1.2-2-1.3-.7,0-1.4.3-2.1,1.1-.6.5-1,1.1-1.4,1.8-.4.7-.7,1.5-1.1,2.5v24c0,2.3,1,3.7,3,4.3l2.7.8v.9h-22.3Z',
   'M304,100c-2.3,0-4.1-.6-5.5-1.7-1.3-1.1-2-2.6-2-4.4s.6-2.9,1.7-3.9c1.1-1,2.4-1.5,3.9-1.5s2.6.3,3.6.9,1.8,1.5,2.6,2.6l.6.7c1.3,1.7,2.5,1.7,3.8,0,.5-.9,1.1-2,1.8-3.4.7-1.4,1.4-3.3,2.3-5.6l-16.7-39.9c-.4-1.1-.8-2-1.3-2.6-.5-.7-1.2-1.2-2.2-1.7l-1.5-.6v-.9h21.4v.8l-1.7.7c-1.3.4-1.9,1-1.9,1.9,0,.9.2,2,.7,3.3l8.9,23.2,8.5-23.5c.5-1.3.6-2.4.5-3.3-.1-.9-.8-1.5-2.1-1.8l-1.8-.4v-.9h11.9v.9l-1.9.6c-1.3.4-2.2,1-2.7,1.7-.5.7-1,1.8-1.5,3.1l-13.8,37.7c-2.2,6-4.5,10.5-6.7,13.5-2.2,3-5.1,4.5-8.7,4.5Z',
];

const WORD_PERIOD =
   'M344.6,80.7c-2.1,0-3.8-.7-5.2-2.2-1.4-1.4-2.2-3.2-2.2-5.2s.7-3.8,2.2-5.2c1.4-1.5,3.2-2.2,5.2-2.2s3.8.7,5.2,2.2c1.4,1.5,2.1,3.2,2.1,5.2s-.7,3.7-2.1,5.2c-1.4,1.4-3.2,2.2-5.2,2.2Z';

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

function WordmarkLabel({ size }: { size: keyof typeof wordmarkSizes }) {
   const height = wordmarkSizes[size];
   return (
      <svg
         data-wordmark={size}
         viewBox="0 0 352 100"
         width={Math.round(height * LOCKUP_RATIO)}
         height={height}
         className="shrink-0 text-lockup-ink"
         fill="currentColor"
         aria-hidden="true"
         focusable="false"
      >
         <path d={BRACKETS} />
         <circle cx="50" cy="50" r={DOT} className="text-lockup-berry" />
         {WORD_LETTERS.map((d) => (
            <path key={d.slice(0, 12)} d={d} />
         ))}
         <path d={WORD_PERIOD} className="text-lockup-berry" />
      </svg>
   );
}

export function BerryWordmark({ className, size = 'md', href = '/' }: BerryWordmarkProps) {
   const lockup = cn('inline-flex items-center text-inherit no-underline', className);

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
