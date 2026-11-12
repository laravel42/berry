'use client';

import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';

import { cn } from '@/lib/utils';
import { SegmentIndicator, useSegmentGroupId } from './segment-indicator';

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
 *
 * On `pill` the raised fill is one `SegmentIndicator` that slides to the tab
 * chosen. `Tabs` keeps the current value (controlled or not) in context so
 * each trigger knows whether the fill is its own to draw.
 */
type TabsVariant = 'pill' | 'underline';

const TabsVariantContext = React.createContext<TabsVariant>('pill');
const TabsValueContext = React.createContext<{ value: string | undefined; groupId: string }>({
   value: undefined,
   groupId: '',
});

function Tabs({
   className,
   variant = 'pill',
   value: valueProp,
   defaultValue,
   onValueChange,
   ...props
}: React.ComponentProps<typeof TabsPrimitive.Root> & { variant?: TabsVariant }) {
   const groupId = useSegmentGroupId();
   const [uncontrolled, setUncontrolled] = React.useState(defaultValue);
   const value = valueProp ?? uncontrolled;
   const handleChange = React.useCallback(
      (next: string) => {
         setUncontrolled(next);
         onValueChange?.(next);
      },
      [onValueChange]
   );
   const current = React.useMemo(() => ({ value, groupId }), [value, groupId]);
   return (
      <TabsVariantContext.Provider value={variant}>
         <TabsValueContext.Provider value={current}>
            <TabsPrimitive.Root
               data-slot="tabs"
               className={cn('flex flex-col gap-2', className)}
               value={value}
               onValueChange={handleChange}
               {...props}
            />
         </TabsValueContext.Provider>
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
               ? 'h-8 justify-center rounded-[8px] bg-segment-track p-[3px]'
               : 'h-10 gap-1 bg-transparent p-0',
            className
         )}
         {...props}
      />
   );
}

function TabsTrigger({
   className,
   children,
   ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
   const variant = React.useContext(TabsVariantContext);
   const { value, groupId } = React.useContext(TabsValueContext);
   const selected = variant === 'pill' && value === props.value;
   return (
      <TabsPrimitive.Trigger
         data-slot="tabs-trigger"
         className={cn(
            "inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-[color,box-shadow] focus-visible:ring-2 focus-visible:ring-foreground/20 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
            variant === 'pill'
               ? 'relative isolate h-[26px] rounded-[5px] px-3 transition-colors data-[slot=tabs-trigger]:!h-[26px] hover:text-foreground data-[state=active]:text-foreground'
               : 'h-10 rounded-none border-b-2 border-transparent px-3 py-2 data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none',
            className
         )}
         {...props}
      >
         {withIndicator(
            children,
            props.asChild,
            selected ? <SegmentIndicator layoutId={groupId} /> : null
         )}
      </TabsPrimitive.Trigger>
   );
}

/**
 * Puts the indicator beside the label. With `asChild` the trigger must keep a
 * single child for Radix's `Slot`, so the indicator goes inside that child
 * (a `Link`, say) instead of next to it.
 */
function withIndicator(
   children: React.ReactNode,
   asChild: boolean | undefined,
   indicator: React.ReactNode
): React.ReactNode {
   if (!indicator) return children;
   if (asChild && React.isValidElement<{ children?: React.ReactNode }>(children)) {
      return React.cloneElement(children, undefined, indicator, children.props.children);
   }
   return (
      <>
         {indicator}
         {children}
      </>
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
