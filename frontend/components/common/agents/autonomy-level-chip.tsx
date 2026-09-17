'use client';

import { useTranslations } from 'next-intl';

import { AUTONOMY_LEVEL_STYLE, asAutonomyLevel, type AutonomyLevel } from '@/lib/autonomy-level';
import { cn } from '@/lib/utils';

interface AutonomyLevelChipProps {
   level: number | null | undefined;
   className?: string;
   /** When set, the chip is focusable and the caller owns the tooltip. */
   tabIndex?: number;
}

/**
 * Coloured privilege badge for an organization role's autonomy ceiling.
 */
export function AutonomyLevelChip({ level, className, tabIndex }: AutonomyLevelChipProps) {
   const org = useTranslations('organization');
   const coded = asAutonomyLevel(level);
   if (coded === null) return null;
   const key = String(coded) as `${AutonomyLevel}`;

   return (
      <span
         title={tabIndex === undefined ? org('levelHint') : undefined}
         tabIndex={tabIndex}
         className={cn(
            // No text-* size here: the base layer in app/globals.css sizes a
            // span, and a chip that set its own would drift from every other one.
            'shrink-0 rounded border px-1.5 py-px leading-none',
            AUTONOMY_LEVEL_STYLE[coded],
            tabIndex !== undefined &&
               'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
            className
         )}
      >
         {org('levelChip', { level: key, name: org(`levelNames.${key}`) })}
      </span>
   );
}
