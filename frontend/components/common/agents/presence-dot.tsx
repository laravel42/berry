'use client';

import { cn } from '@/lib/utils';
import type { AgentStatusDisplay } from '@/lib/agents';

/**
 * An agent's availability as a dot with a name a screen reader can say.
 *
 * The word beside it is the caller's decision: a roster of twenty online
 * agents does not need "Online" twenty times, but a busy or offline one does
 * need saying.
 */
export function PresenceDot({
   tone,
   label,
   className,
}: {
   tone: AgentStatusDisplay['tone'];
   label: string;
   className?: string;
}) {
   return (
      <span
         role="img"
         aria-label={label}
         title={label}
         className={cn(
            'size-1.5 shrink-0 rounded-full',
            tone === 'online' && 'bg-status-success',
            tone === 'busy' && 'bg-status-warning',
            (tone === 'offline' || tone === 'unknown') && 'bg-muted-foreground/40',
            className
         )}
      />
   );
}
