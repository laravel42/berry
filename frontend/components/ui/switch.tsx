'use client';

import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';

import { cn } from '@/lib/utils';

function Switch({
   className,
   variant = 'default',
   ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
   /** `settings`: a lighter off track and a soft knob shadow; 0.15s transition. */
   variant?: 'default' | 'settings';
}) {
   return (
      <SwitchPrimitive.Root
         data-slot="switch"
         className={cn(
            // Invariant 6: the switch is one of two controls allowed to draw
            // under the 44px floor, provided it extends its hit area to it. The
            // `before` pseudo is a 44px target centred on the 36x22 track, so
            // the touch target meets WCAG 2.5.8 without the control growing.
            'peer data-[state=checked]:bg-status-success focus-visible:border-ring relative inline-flex h-[22px] w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent outline-none before:absolute before:top-1/2 before:left-1/2 before:size-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-[""] disabled:cursor-not-allowed disabled:opacity-50',
            variant === 'settings'
               ? 'data-[state=unchecked]:bg-settings-switch-off transition-colors duration-150 motion-reduce:transition-none'
               : 'data-[state=unchecked]:bg-input shadow-xs transition-all',
            className
         )}
         {...props}
      >
         <SwitchPrimitive.Thumb
            data-slot="switch-thumb"
            className={cn(
               'bg-white pointer-events-none block size-[18px] rounded-full ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0',
               variant === 'settings'
                  ? 'shadow-[0_1px_2px_rgba(0,0,0,0.4)] duration-150 motion-reduce:transition-none'
                  : 'shadow-lg'
            )}
         />
      </SwitchPrimitive.Root>
   );
}

export { Switch };
