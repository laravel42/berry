import type { AgentRoster } from '@/lib/agents';

/** Roster load as Idle / Working / N queued. */
export type AgentWorkload = {
   labelKey: 'workloadIdle' | 'workloadWorking' | 'workloadQueued';
   count?: number;
   tone: 'offline' | 'busy';
};

export function agentWorkload(roster: AgentRoster | undefined): AgentWorkload | null {
   if (roster === undefined) return null;
   if (roster.running > 0) return { labelKey: 'workloadWorking', tone: 'busy' };
   if (roster.queued > 0) {
      return { labelKey: 'workloadQueued', count: roster.queued, tone: 'busy' };
   }
   return { labelKey: 'workloadIdle', tone: 'offline' };
}
