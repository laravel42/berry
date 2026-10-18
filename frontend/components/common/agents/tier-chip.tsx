'use client';

import { TIER_STYLE, type Tier } from '@/lib/agents';
import { useTierNames } from '@/lib/tier-names';
import { cn } from '@/lib/utils';

/** A Berry tier's name as a coloured chip, styled like the autonomy level chip. */
export function TierChip({ tier, className }: { tier: Tier; className?: string }) {
   const names = useTierNames();
   return (
      <span
         className={cn(
            // No text-* size: the base layer sizes a span, as for every other chip.
            'inline-flex shrink-0 items-center rounded border px-1.5 py-px leading-none',
            TIER_STYLE[tier],
            className
         )}
      >
         {names[tier]}
      </span>
   );
}
