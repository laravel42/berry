import { CHIP_GEOMETRY } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

/** Shared chrome for compact identity chips (runtime, agent, why a run started). */
export const META_BADGE = cn(CHIP_GEOMETRY, 'max-w-full border bg-background text-foreground');

export function MetaBadge({
   icon,
   children,
   title,
   className,
   truncate = true,
}: {
   icon?: ReactNode;
   children: ReactNode;
   title?: string;
   className?: string;
   truncate?: boolean;
}) {
   return (
      <span className={cn(META_BADGE, !truncate && 'max-w-none shrink-0', className)} title={title}>
         {icon}
         <span className={truncate ? 'min-w-0 truncate' : 'whitespace-nowrap'}>{children}</span>
      </span>
   );
}
