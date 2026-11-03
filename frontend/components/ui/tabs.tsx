'use client';

import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';

import { cn } from '@/lib/utils';

/**
 * Two tab shapes under the "Ledger" redesign, named by the plan (§4 #32):
 *
 * - `pill` — a segmented control on a filled track, the selected tab a raised
 *   pill. Agent detail, filters, the create-agent modal. The default.
 * - `underline` — flat tabs with a bar under the current one, for a surface
 *   that already sits inside a bordered header (autopilot detail, reviews).
 *   The page draws the header's own `border-b`; the trigger draws only the
 *   active bar, so the two do not double up.
 *
 * The variant is set once on `Tabs` and read by `TabsList`/`TabsTrigger`
 * through context, so a caller cannot put a pill trigger in an underline list.
 */
type TabsVariant = 'pill' | 'underline';

const TabsVariantContext = React.createContext<TabsVariant>('pill');

function Tabs({
   className,
   variant = 'pill',
   ...props
}: React.ComponentProps<typeof TabsPrimitive.Root> & { variant?: TabsVariant }) {
   return (
      <TabsVariantContext.Provider value={variant}>
         <TabsPrimitive.Root
            data-slot="tabs"
            className={cn('flex flex-col gap-2', className)}
            {...props}
         />
      </TabsVariantContext.Provider>
   );
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
   const variant = React.useContext(TabsVariantContext);
   return (
      <TabsPrimitive.List
         data-slot="tabs-list"
         data-variant={variant}
         className={cn(
            'inline-flex w-fit items-center text-muted-foreground',
            variant === 'pill'
               ? 'h-7 justify-center rounded-[7px] bg-segment-track p-0.5'
               : 'h-10 gap-1 bg-transparent p-0',
            className
         )}
         {...props}
      />
   );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
   const variant = React.useContext(TabsVariantContext);
   return (
      <TabsPrimitive.Trigger
         data-slot="tabs-trigger"
         className={cn(
            "inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:ring-primary/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
            variant === 'pill'
               ? 'h-6 rounded-[5px] px-3 data-[state=active]:bg-segment-selected data-[state=active]:text-foreground'
               : 'h-10 rounded-none border-b-2 border-transparent px-3 py-2 data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none',
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
