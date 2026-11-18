'use client';

import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { CheckIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

const TOUCH_TARGET =
   "[@media(hover:none)]:relative [@media(hover:none)]:size-6 [@media(hover:none)]:border-transparent [@media(hover:none)]:bg-transparent [@media(hover:none)]:shadow-none [@media(hover:none)]:data-[state=checked]:border-transparent [@media(hover:none)]:data-[state=checked]:bg-transparent [@media(hover:none)]:focus-visible:border-transparent [@media(hover:none)]:before:pointer-events-none [@media(hover:none)]:before:absolute [@media(hover:none)]:before:border [@media(hover:none)]:before:border-input [@media(hover:none)]:before:content-[''] [@media(hover:none)]:data-[state=checked]:before:border-primary [@media(hover:none)]:data-[state=checked]:before:bg-primary [@media(hover:none)]:focus-visible:before:border-ring";
// 24px minus the 14px (default) or 16px (settings) box, split either side.
const TOUCH_DEFAULT =
   '[@media(hover:none)]:-m-[5px] [@media(hover:none)]:p-[5px] [@media(hover:none)]:before:inset-[5px] [@media(hover:none)]:before:rounded-[3px]';
const TOUCH_SETTINGS =
   '[@media(hover:none)]:-m-1 [@media(hover:none)]:p-1 [@media(hover:none)]:before:inset-1 [@media(hover:none)]:before:rounded-[4px] [@media(hover:none)]:before:border-settings-field-focus [@media(hover:none)]:disabled:data-[state=checked]:before:border-settings-check-dim [@media(hover:none)]:disabled:data-[state=checked]:before:bg-settings-check-dim';

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
            // Touch screens: the button itself is 24px (the WCAG 2.2 minimum target) and the
            // negative margin keeps its layout footprint. The box the eye sees is drawn by
            // ::before at the old size, so it looks the same as on desktop.
            TOUCH_TARGET,
            variant === 'settings' ? TOUCH_SETTINGS : TOUCH_DEFAULT,
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
