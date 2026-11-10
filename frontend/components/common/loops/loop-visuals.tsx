'use client';

import { Clock, Hand, Layers, Webhook, Zap, type LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';

import type { Autopilot } from '@/lib/autopilots';
import { colorForAgent } from '@/lib/agent-color';
import { cn } from '@/lib/utils';

export type TriggerSummary = 'cron' | 'event' | 'webhook' | 'manual' | 'several';

/** What makes a Loop run, in a word: its one trigger kind, several, or by hand. */
export function triggerSummaryKey(loop: Pick<Autopilot, 'triggerKinds'>): TriggerSummary {
   const kinds = loop.triggerKinds;
   if (kinds.length === 0) return 'manual';
   if (kinds.length > 1) return 'several';
   return kinds[0] ?? 'manual';
}

export const TRIGGER_ICON: Record<TriggerSummary, LucideIcon> = {
   cron: Clock,
   event: Zap,
   webhook: Webhook,
   manual: Hand,
   several: Layers,
};

/** A stable hue per Loop, from the same palette agents use. */
export function loopTint(loopId: string): string {
   return colorForAgent(loopId);
}

/** The faded wash a Loop's header sits on: its hue, from the top-left corner. */
export function loopWash(tint: string, strength = 16): CSSProperties {
   return {
      backgroundImage: `radial-gradient(120% 140% at 0% 0%, color-mix(in oklab, ${tint} ${strength}%, transparent), transparent 60%)`,
   };
}

/**
 * The Loop's mark: its trigger's glyph on a tile in its own hue. A paused Loop
 * keeps its shape but loses its colour, so "off" reads before any label does.
 */
export function LoopGlyph({
   loop,
   size = 'md',
   className,
}: {
   loop: Pick<Autopilot, 'id' | 'triggerKinds' | 'status'>;
   size?: 'md' | 'lg';
   className?: string;
}) {
   const tint = loopTint(loop.id);
   const off = loop.status !== 'active';
   const Icon = TRIGGER_ICON[triggerSummaryKey(loop)];
   return (
      <span
         className={cn(
            'flex shrink-0 items-center justify-center bg-card',
            size === 'lg' ? 'size-14 rounded-2xl' : 'size-9 rounded-[10px]',
            off && 'text-subtle-foreground',
            className
         )}
         style={
            off
               ? { boxShadow: '0 0 0 1px var(--border)' }
               : {
                    color: tint,
                    boxShadow: `0 0 0 1px color-mix(in oklab, ${tint} 45%, transparent), 0 8px 24px -14px ${tint}`,
                 }
         }
         aria-hidden
      >
         <Icon className={size === 'lg' ? 'size-6' : 'size-4'} />
      </span>
   );
}

/**
 * The last week in one bar: the share of runs that worked, and the share that
 * failed. Empty when nothing ran, so a quiet Loop is not drawn as a healthy one.
 */
export function HealthBar({
   runs,
   failed,
   className,
}: {
   runs: number;
   failed: number;
   className?: string;
}) {
   const failedShare = runs > 0 ? Math.min(100, (failed / runs) * 100) : 0;
   return (
      <span
         className={cn('flex h-1.5 w-full overflow-hidden rounded-full bg-accent', className)}
         aria-hidden
      >
         {runs > 0 ? (
            <>
               <span
                  className="h-full bg-status-success"
                  style={{ width: `${100 - failedShare}%` }}
               />
               <span className="h-full bg-status-danger" style={{ width: `${failedShare}%` }} />
            </>
         ) : null}
      </span>
   );
}
