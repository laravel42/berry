import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Search sits on a filled field without a border, and takes the pill.
 *
 * The redesign splits field shape by what the field is FOR, not by taste: a
 * field you search, filter or compose in is a pill, and a field you enter a
 * value into is a 10px rectangle. Across the 53 screens that is 17 pills --
 * every one of them a "Search...", "Filter by..." or "Leave a comment..." --
 * against 50 square form fields. So the pill belongs here, on the search
 * affordance, rather than on `Input` itself.
 */
export const searchFieldClass =
   'rounded-pill border-0 bg-segment-track shadow-none focus-visible:border-primary';

function Input({
   className,
   type,
   plain = false,
   ...props
}: React.ComponentProps<'input'> & {
   /** Title/description chrome: no border or berry focus halo. */
   plain?: boolean;
}) {
   return (
      <input
         type={type}
         data-slot="input"
         className={cn(
            'border-input bg-card text-foreground file:text-foreground placeholder:text-placeholder selection:bg-primary selection:text-primary-foreground flex min-h-(--ctl-h) w-full min-w-0 rounded-lg border px-(--ctl-px) shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
            !plain &&
               'focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--ring)_20%,transparent)]',
            'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
            className
         )}
         {...props}
      />
   );
}

export { Input };
