import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

/** Shared chrome for compact identity chips (runtime, agent, why a run started). */
export const META_BADGE =
   'inline-flex max-w-full items-center gap-1.5 rounded-md border bg-background px-1.5 py-0.5 text-foreground';

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
