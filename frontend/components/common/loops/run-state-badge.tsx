'use client';

import { useTranslations } from 'next-intl';

import { BerryMark } from '@/components/brand/berry-mark';
import { StatusBadge } from '@/components/common/status-badge';
import type { StatusLook } from '@/lib/catalog';
import type { LoopRunState } from '@/lib/autopilots';

/**
 * Tone and shape per state, so a state never rests on colour alone: a
 * crossed mark is a run that did not finish its work, a hollow one has not
 * started (or never will), a solid one is working or done.
 */
const LOOK: Record<LoopRunState, Omit<StatusLook, 'label'>> = {
   queued: { tone: 'neutral', state: 'hollow' },
   running: { tone: 'working', state: 'solid', pulse: true },
   waiting_for_approval: { tone: 'attention', state: 'solid' },
   succeeded: { tone: 'complete', state: 'solid' },
   failed: { tone: 'danger', state: 'crossed' },
   canceled: { tone: 'neutral', state: 'crossed' },
   timed_out: { tone: 'danger', state: 'hollow' },
   skipped: { tone: 'neutral', state: 'hollow' },
};

/** A Loop run's state as a pill, or as the mark alone where a row is tight. */
export default function LoopRunStateBadge({
   state,
   compact = false,
   className,
}: {
   state: LoopRunState;
   compact?: boolean;
   className?: string;
}) {
   const t = useTranslations('loops.runState');
   const look = LOOK[state];
   if (compact) {
      return (
         <span className={className} title={t(state)}>
            <BerryMark
               size="sm"
               tone={look.tone}
               state={look.state}
               pulse={look.pulse}
               label={t(state)}
            />
         </span>
      );
   }
   return <StatusBadge look={{ ...look, label: t(state) }} className={className} />;
}
