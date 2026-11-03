'use client';

import { BerryMark } from '@/components/brand/berry-mark';
import { CHIP_GEOMETRY } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { StatusLook } from '@/lib/catalog';

/** A mark and a word in a pill: the shape every status in this area shares. */
export function StatusBadge({ look, className }: { look: StatusLook; className?: string }) {
   return (
      <span
         className={cn(
            CHIP_GEOMETRY,
            'border border-border/60 bg-background text-muted-foreground',
            className
         )}
      >
         <BerryMark size="sm" tone={look.tone} state={look.state} pulse={look.pulse} />
         {look.label}
      </span>
   );
}
