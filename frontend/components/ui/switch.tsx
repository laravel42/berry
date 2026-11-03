'use client';

import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';

import { cn } from '@/lib/utils';

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
   return (
      <SwitchPrimitive.Root
         data-slot="switch"
         className={cn(
            // Invariant 6: the switch is one of two controls allowed to draw
            // under the 44px floor, provided it extends its hit area to it. The
            // `before` pseudo is a 44px target centred on the 36x22 track, so
            // the touch target meets WCAG 2.5.8 without the control growing.
            'peer data-[state=checked]:bg-status-success data-[state=unchecked]:bg-input focus-visible:border-ring relative inline-flex h-[22px] w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-xs transition-all outline-none before:absolute before:top-1/2 before:left-1/2 before:size-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-[""] disabled:cursor-not-allowed disabled:opacity-50',
            className
         )}
         {...props}
      >
         <SwitchPrimitive.Thumb
            data-slot="switch-thumb"
            className={cn(
               'bg-white pointer-events-none block size-[18px] rounded-full ring-0 shadow-lg transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0'
            )}
         />
      </SwitchPrimitive.Root>
   );
}

export { Switch };
