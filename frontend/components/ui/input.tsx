import * as React from 'react';

import { cn } from '@/lib/utils';

/** Search sits on a filled field without a border (Berry components v1). */
export const searchFieldClass =
   'border-0 bg-segment-track shadow-none focus-visible:border-primary';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
   return (
      <input
         type={type}
         data-slot="input"
         className={cn(
            'border-input bg-card text-foreground file:text-foreground placeholder:text-placeholder selection:bg-primary selection:text-primary-foreground flex h-[30px] w-full min-w-0 rounded-[7px] border px-3 py-1 shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
            'focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--brand-berry)_20%,transparent)]',
            'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
            className
         )}
         {...props}
      />
   );
}

export { Input };
