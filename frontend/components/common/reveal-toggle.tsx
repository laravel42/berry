'use client';

import { MorphIcon } from 'morphicons/react';
import type { ComponentProps } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The eye pair, as icon data rather than as components.
 *
 * `morphicons` interpolates between two sets of outlines, so it needs the
 * geometry, and `lucide-react` only hands out rendered components -- the node
 * data behind `<Eye />` is not on its public surface. These two arrays are that
 * data, copied from lucide-react 1.55 (ISC) for `eye` and `eye-off`: the same
 * icons the rest of the app renders from the package, so if lucide redraws them
 * these have to be refreshed in step or the toggle will quietly stop matching
 * every other eye in the product.
 *
 * Both are on lucide's 24x24 grid, which is also the morph engine's default, so
 * no `fitIcon` call is needed. The counts differ -- the eye is 2 subpaths (the
 * lid, and the pupil as a closed loop) against eye-off's 4 -- and the engine
 * pads the shorter side itself.
 */
const EYE = [
   [
      'path',
      {
         d: 'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0',
      },
   ],
   ['circle', { cx: '12', cy: '12', r: '3' }],
] as const;

const EYE_OFF = [
   [
      'path',
      {
         d: 'M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49',
      },
   ],
   ['path', { d: 'M14.084 14.158a3 3 0 0 1-4.242-4.242' }],
   [
      'path',
      {
         d: 'M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143',
      },
   ],
   ['path', { d: 'm2 2 20 20' }],
] as const;

interface RevealToggleProps extends Omit<ComponentProps<typeof Button>, 'children' | 'onClick'> {
   /** Whether the value it guards is currently legible. */
   revealed: boolean;
   onRevealedChange: (next: boolean) => void;
   /** Accessible name while hidden, naming the action: "Show password". */
   showLabel: string;
   /** Accessible name while revealed: "Hide password". */
   hideLabel: string;
}

/**
 * Reveals or hides a masked value, morphing between the two eyes instead of
 * swapping them.
 *
 * The swap is the thing worth getting right: two icons exchanged on click read
 * as one icon replaced by a different one, and the user has to recognise the
 * second shape to know what happened. Drawing the slash on means the control
 * says what it did, so the state is legible from the motion and not only from
 * the shape it lands on.
 *
 * The name changes with the state rather than carrying `aria-pressed`, which
 * matches the eye this replaced in the autopilot secrets field. Both are
 * correct; using one of them everywhere is what keeps the product speaking
 * with one voice.
 *
 * Motion honours `prefers-reduced-motion`: with it on, the morph degrades to an
 * instant swap rather than being drawn.
 */
export function RevealToggle({
   revealed,
   onRevealedChange,
   showLabel,
   hideLabel,
   className,
   variant = 'ghost',
   size = 'icon',
   ...props
}: RevealToggleProps) {
   return (
      <Button
         type="button"
         variant={variant}
         size={size}
         // 36px, the floor the accessibility contract allows a dense control,
         // where `icon`'s own 28px would be under it.
         className={cn('size-9 text-muted-foreground hover:text-foreground', className)}
         aria-label={revealed ? hideLabel : showLabel}
         onClick={() => onRevealedChange(!revealed)}
         {...props}
      >
         <MorphIcon
            icon={revealed ? EYE_OFF : EYE}
            spring="snappy"
            reducedMotion="user"
            size={16}
            strokeWidth={2}
            stroke="currentColor"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
         />
      </Button>
   );
}
