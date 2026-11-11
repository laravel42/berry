import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Search sits on a filled field without a border. It no longer owns the pill.
 *
 * The redesign split field shape by what the field was FOR -- a pill to search
 * or compose in, a rectangle to enter a value into -- which put 17 pills
 * against 50 rectangles across the 53 screens. That split is withdrawn: every
 * field is a pill now, so this class carries only the fill and the missing
 * border, and `Input` itself carries the shape.
 */
export const searchFieldClass =
   'border-0 bg-segment-track shadow-none focus-visible:border-primary';

/** The settings field (Input, Select trigger, Textarea): 30px, filled, a hairline edge that darkens on focus. */
export const settingsFieldClass =
   'border-settings-field-line bg-settings-field px-2.5 shadow-none placeholder:text-settings-placeholder focus-visible:border-settings-field-focus';

function Input({
   className,
   type,
   plain = false,
   variant = 'default',
   ...props
}: React.ComponentProps<'input'> & {
   /** Title/description chrome: no border or berry focus halo. */
   plain?: boolean;
   /** `settings`: the settings field — filled, hairline edge, quiet focus. */
   variant?: 'default' | 'settings';
}) {
   return (
      <input
         type={type}
         data-slot="input"
         className={cn(
            'border-input bg-card text-foreground file:text-foreground placeholder:text-placeholder selection:bg-primary selection:text-primary-foreground flex min-h-(--field-h) w-full min-w-0 rounded-pill border px-(--ctl-px) shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
            !plain &&
               variant === 'default' &&
               'focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--ring)_20%,transparent)]',
            variant === 'settings' && settingsFieldClass,
            'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
            className
         )}
         {...props}
      />
   );
}

export { Input };
