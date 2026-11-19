'use client';

import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { CheckIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

// Touch screens: the button itself is 24px (the WCAG 2.2 minimum target) and
// the negative margin (24px minus the 14px box, split either side) keeps its
// layout footprint. The box the eye sees is drawn by ::before at the old size,
// so it looks the same as on desktop.
const TOUCH_TARGET =
   "[@media(hover:none)]:relative [@media(hover:none)]:-m-[5px] [@media(hover:none)]:size-6 [@media(hover:none)]:border-transparent [@media(hover:none)]:bg-transparent [@media(hover:none)]:p-[5px] [@media(hover:none)]:shadow-none [@media(hover:none)]:data-[state=checked]:border-transparent [@media(hover:none)]:data-[state=checked]:bg-transparent [@media(hover:none)]:focus-visible:border-transparent [@media(hover:none)]:before:pointer-events-none [@media(hover:none)]:before:absolute [@media(hover:none)]:before:inset-[5px] [@media(hover:none)]:before:rounded-[3px] [@media(hover:none)]:before:border [@media(hover:none)]:before:border-input [@media(hover:none)]:before:content-[''] [@media(hover:none)]:data-[state=checked]:before:border-primary [@media(hover:none)]:data-[state=checked]:before:bg-primary [@media(hover:none)]:focus-visible:before:border-ring";

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
   return (
      <CheckboxPrimitive.Root
         data-slot="checkbox"
         className={cn(
            'peer size-3.5 shrink-0 cursor-pointer rounded-[3px] border border-input shadow-xs outline-none transition-shadow data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
            TOUCH_TARGET,
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
            <CheckIcon className="size-3.5 text-current" />
         </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
   );
}

export { Checkbox };
