'use client';

import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';

import { cn } from '@/lib/utils';

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
   return (
      <TabsPrimitive.Root
         data-slot="tabs"
         className={cn('flex flex-col gap-2', className)}
         {...props}
      />
   );
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
   return (
      <TabsPrimitive.List
         data-slot="tabs-list"
         className={cn(
            'inline-flex h-7 w-fit items-center justify-center rounded-[7px] bg-segment-track p-0.5 text-muted-foreground',
            className
         )}
         {...props}
      />
   );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
   return (
      <TabsPrimitive.Trigger
         data-slot="tabs-trigger"
         className={cn(
            "data-[state=active]:bg-segment-selected data-[state=active]:text-foreground inline-flex h-6 items-center justify-center gap-1.5 rounded-[5px] px-3 font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:ring-primary/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
            className
         )}
         {...props}
      />
   );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
   return (
      <TabsPrimitive.Content
         data-slot="tabs-content"
         className={cn('flex-1 outline-none', className)}
         {...props}
      />
   );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
