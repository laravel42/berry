import { TIER_NAMES, TIER_STYLE, type Tier } from '@/lib/agents';
import { cn } from '@/lib/utils';

/** A Berry tier's name as a coloured chip, styled like the autonomy level chip. */
export function TierChip({ tier, className }: { tier: Tier; className?: string }) {
   return (
      <span
         className={cn(
            // No text-* size: the base layer sizes a span, as for every other chip.
            'inline-flex shrink-0 items-center rounded border px-1.5 py-px leading-none',
            TIER_STYLE[tier],
            className
         )}
      >
         {TIER_NAMES[tier]}
      </span>
   );
}
