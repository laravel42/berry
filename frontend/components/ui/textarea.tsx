import * as React from 'react';

import { cn } from '@/lib/utils';

const Textarea = React.forwardRef<
   HTMLTextAreaElement,
   React.ComponentProps<'textarea'> & {
      /** Title/description chrome: no border or berry focus halo. */
      plain?: boolean;
   }
>(({ className, plain = false, ...props }, ref) => {
   return (
      <textarea
         ref={ref}
         data-slot="textarea"
         className={cn(
            'border-input bg-card text-foreground placeholder:text-placeholder aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive flex field-sizing-content min-h-16 w-full rounded-[7px] border px-3 py-2 shadow-xs transition-[color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-50',
            !plain &&
               'focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--brand-berry)_20%,transparent)]',
            className
         )}
         {...props}
      />
   );
});
Textarea.displayName = 'Textarea';

export { Textarea };
