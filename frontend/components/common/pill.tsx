import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

type PillTone = 'neutral' | 'attention' | 'danger' | 'complete' | 'review';

const PILL_TONE: Record<PillTone, string> = {
   neutral: 'text-muted-foreground',
   attention: 'text-status-warning',
   danger: 'text-status-danger',
   complete: 'text-status-success',
   review: 'text-review-pending',
};

/** A small inline label; the tone colours the text only. */
export function Pill({
   tone = 'neutral',
   className,
   children,
}: {
   tone?: PillTone;
   className?: string;
   children: ReactNode;
}) {
   return (
      <span
         className={cn(
            'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded border border-border/60 bg-muted/40 px-1.5 leading-5',
            PILL_TONE[tone],
            className
         )}
      >
         {children}
      </span>
   );
}

/** A section's title, with its count after it when there is one. */
export function SectionHeading({ title, count }: { title: string; count?: number }) {
   return (
      <p>
         {title}
         {count !== undefined && <span className="ml-1.5 text-muted-foreground">· {count}</span>}
      </p>
   );
}
