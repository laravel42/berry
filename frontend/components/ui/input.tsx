import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * One field for the whole app: a pill, `--field-h` tall.
 *
 * - `variant="search"` is the filled field without a border that every list
 *   filters with. The redesign once split field shape by what the field was
 *   for; that split is withdrawn, so a search differs only in its fill.
 * - `variant="inline"` reads as the text it holds until it is pointed at
 *   (a label's or a tier's name in its row): no fill or edge at rest, the
 *   text lined up with its neighbours, the field look on hover and focus.
 * - `size="lg"` lifts the field to the 44px button floor, for the one case
 *   where a field shares a line with a `default` button (a page header with
 *   a search beside its primary action).
 *
 * Settings uses these same fields; it has no variant of its own.
 */
const focusRing =
   'focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--ring)_20%,transparent)]';

const variantClass = {
   default: cn('border-input bg-card shadow-xs', focusRing),
   search: cn('border-0 bg-segment-track', focusRing),
   inline: cn(
      '-ml-1.5 border-transparent bg-transparent px-1.5 [font:inherit] hover:border-input focus-visible:bg-card',
      focusRing
   ),
} as const;

const sizeClass = {
   default: 'min-h-(--field-h)',
   lg: 'min-h-(--ctl-h)',
} as const;

function Input({
   className,
   type,
   plain = false,
   variant = 'default',
   size = 'default',
   ...props
}: Omit<React.ComponentProps<'input'>, 'size'> & {
   /** Title/description chrome: no border or berry focus halo. */
   plain?: boolean;
   variant?: keyof typeof variantClass;
   size?: keyof typeof sizeClass;
}) {
   return (
      <input
         type={type}
         data-slot="input"
         className={cn(
            'text-foreground file:text-foreground placeholder:text-placeholder selection:bg-primary selection:text-primary-foreground flex w-full min-w-0 rounded-pill border px-(--ctl-px) transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
            sizeClass[size],
            plain ? 'border-input bg-card shadow-xs' : variantClass[variant],
            'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
            className
         )}
         {...props}
      />
   );
}

export { Input };
