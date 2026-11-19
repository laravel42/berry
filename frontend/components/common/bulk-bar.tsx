'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { useFloatingFloor } from '@/store/floating-stack-store';

/**
 * The bar a list pins to its bottom edge while rows are selected: how many,
 * and what can be done to them. It is the floating stack's floor, so the
 * Agents launcher and any corner control stand above it instead of covering
 * its actions.
 */
export function BulkBar({ children, className }: { children: ReactNode; className?: string }) {
   const ref = useFloatingFloor();
   return (
      <div
         ref={ref}
         className={cn(
            'sticky bottom-0 z-20 flex flex-wrap items-center gap-3 border-t bg-container px-6 py-2',
            className
         )}
      >
         {children}
      </div>
   );
}
