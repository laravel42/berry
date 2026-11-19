'use client';

import { CHIP_GEOMETRY } from '@/components/ui/badge';
import { TIER_OPTION_STYLE, TIER_STYLE, type Tier } from '@/lib/agents';
import { useTierNames } from '@/lib/tier-names';
import { cn } from '@/lib/utils';

/**
 * A Berry tier's name as a coloured chip.
 *
 * `compact` (the default) is the dense one for lists and tables, styled like
 * the autonomy level chip. `chip` stands among the other chips under an
 * agent's name: the shared chip geometry, painted as the tier picker paints
 * its chosen option, so the header shows the tier the way the picker does.
 */
export function TierChip({
   tier,
   variant = 'compact',
   className,
}: {
   tier: Tier;
   variant?: 'compact' | 'chip';
   className?: string;
}) {
   const names = useTierNames();
   return (
      <span
         className={cn(
            variant === 'chip'
               ? cn(CHIP_GEOMETRY, 'border text-foreground', TIER_OPTION_STYLE[tier].chosen)
               : // No text-* size: the base layer sizes a span, as for every other chip.
                 cn(
                    'inline-flex shrink-0 items-center rounded border px-1.5 py-px leading-none',
                    TIER_STYLE[tier]
                 ),
            className
         )}
      >
         {names[tier]}
      </span>
   );
}
