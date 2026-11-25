'use client';

import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';

import { cn } from '@/lib/utils';

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
   return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
   return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
   className,
   align = 'center',
   sideOffset = 4,
   pointerThrough = false,
   ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & {
   /** For a popover that only reports something: lets clicks reach whatever it
    *  is laid over, so it cannot block the form it describes. Only for content
    *  with nothing interactive in it. Paired with a rule in app/globals.css,
    *  because the element that captures the click is a wrapper Radix owns. */
   pointerThrough?: boolean;
}) {
   return (
      <PopoverPrimitive.Portal>
         <PopoverPrimitive.Content
            data-slot="popover-content"
            data-pointer-through={pointerThrough ? '' : undefined}
            align={align}
            sideOffset={sideOffset}
            className={cn(
               'bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-72 rounded-md border p-4 shadow-md outline-hidden',
               className
            )}
            {...props}
         />
      </PopoverPrimitive.Portal>
   );
}

function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
   return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

/**
 * Points the popover at what it is about, for a popover that the user did not
 * open themselves. A menu needs no arrow -- the user just clicked the thing it
 * belongs to, so the tie is obvious. Feedback that appears on its own does need
 * one, or it reads as a floating card that happens to be nearby.
 *
 * Radix draws the arrow as one filled polygon, so it cannot carry the content's
 * 1px border on its two slanted sides. Rather than fake that with a rotated
 * square, this fills with the border colour and covers all but the outer edge
 * with a `--popover`-filled inset, which leaves a hairline that reads as the
 * border running around the point.
 */
function PopoverArrow({
   className,
   ...props
}: React.ComponentProps<typeof PopoverPrimitive.Arrow>) {
   return (
      <PopoverPrimitive.Arrow
         data-slot="popover-arrow"
         width={14}
         height={7}
         className={cn('fill-border', className)}
         {...props}
      >
         <polygon points="1.6,0 12.4,0 7,5.4" className="fill-popover" />
      </PopoverPrimitive.Arrow>
   );
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor, PopoverArrow };
