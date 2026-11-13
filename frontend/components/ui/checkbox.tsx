'use client';

import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { CheckIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

function Checkbox({
   className,
   variant = 'default',
   ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root> & {
   /**
    * `settings`: a 16px box, filled with the primary colour when checked. A disabled checked box is dimmed
    * (it is covered by a broader choice, such as Full access).
    */
   variant?: 'default' | 'settings';
}) {
   return (
      <CheckboxPrimitive.Root
         data-slot="checkbox"
         className={cn(
            'peer shrink-0 cursor-pointer border outline-none transition-shadow data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground focus-visible:border-ring disabled:cursor-not-allowed aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
            variant === 'settings'
               ? 'size-4 rounded-[4px] border-settings-field-focus disabled:opacity-100 disabled:data-[state=checked]:border-settings-check-dim disabled:data-[state=checked]:bg-settings-check-dim'
               : 'size-3.5 rounded-[3px] border-input shadow-xs disabled:opacity-50',
            className
         )}
         {...props}
      >
         <CheckboxPrimitive.Indicator
            data-slot="checkbox-indicator"
            className="flex items-center justify-center text-current transition-none"
         >
            {/* `text-current` keeps menu rows (CommandItem, menu items) from
                greying the tick: they recolour any svg without a text- class. */}
            <CheckIcon
               className={cn('text-current', variant === 'settings' ? 'size-2.5' : 'size-3.5')}
               strokeWidth={variant === 'settings' ? 3.5 : 2}
            />
         </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
   );
}

export { Checkbox };
