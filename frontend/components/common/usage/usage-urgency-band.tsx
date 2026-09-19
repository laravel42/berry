'use client';

import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

export type UrgencyTone = 'warning' | 'danger' | 'info' | 'success' | 'neutral';

const TONE_BG: Record<UrgencyTone, string> = {
   warning: 'bg-column-tint-warning',
   danger: 'bg-column-tint-danger',
   info: 'bg-column-tint-info',
   success: 'bg-column-tint-success',
   neutral: 'bg-column-tint-neutral',
};

const TONE_VALUE: Record<UrgencyTone, string> = {
   warning: 'text-status-warning',
   danger: 'text-status-danger',
   info: 'text-status-info',
   success: 'text-status-success',
   neutral: 'text-foreground',
};

/** Secondary copy on a tinted band — hue-tinted, not flat muted gray. */
const TONE_META: Record<UrgencyTone, string> = {
   warning: 'text-status-warning/80',
   danger: 'text-status-danger/80',
   info: 'text-status-info/80',
   success: 'text-status-success/80',
   neutral: 'text-muted-foreground',
};

/**
 * One full-width urgency band: label, a large tabular figure, optional body.
 * Reading order on Usage is stack of these — awaiting, risk, spend — not a
 * grid of equal metric tiles.
 */
export function UrgencyBand({
   tone,
   label,
   value,
   hint,
   children,
   pulse = false,
   className,
}: {
   tone: UrgencyTone;
   label: string;
   value: string | number;
   hint?: string;
   children?: ReactNode;
   /** Soft attention when this band still needs a person (Overview awaiting). */
   pulse?: boolean;
   className?: string;
}) {
   return (
      <section
         className={cn(
            'flex flex-col gap-3 border border-border/70 px-4 py-3',
            TONE_BG[tone],
            className
         )}
      >
         <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="flex items-center gap-2 font-medium text-foreground">
               {pulse ? (
                  <span
                     aria-hidden
                     className="size-1.5 shrink-0 rounded-full bg-status-warning [animation:berrypulse_1.4s_ease-in-out_infinite] motion-reduce:animate-none"
                  />
               ) : null}
               {label}
            </h2>
            <p className={cn('font-medium tabular-nums tracking-tight', TONE_VALUE[tone])}>
               {value}
            </p>
         </div>
         {hint ? <p className={TONE_META[tone]}>{hint}</p> : null}
         {children ? (
            <div className={cn(TONE_META[tone], '[&_a]:text-foreground')}>{children}</div>
         ) : null}
      </section>
   );
}

/** Slim figure strip under a band: secondary numbers without card chrome. */
export function UrgencyFigures({
   items,
}: {
   items: Array<{ label: string; value: string | number }>;
}) {
   return (
      <ul className="flex flex-wrap gap-x-6 gap-y-2 border-t border-border/50 pt-3">
         {items.map((item) => (
            <li key={item.label} className="flex min-w-[6rem] flex-col gap-0.5">
               <span className="opacity-80">{item.label}</span>
               <span className="tabular-nums text-foreground">{item.value}</span>
            </li>
         ))}
      </ul>
   );
}
