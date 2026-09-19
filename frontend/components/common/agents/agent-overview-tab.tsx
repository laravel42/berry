'use client';

import { AlertTriangle } from 'lucide-react';
import { useAgentCoverage } from '@/hooks/use-agent-coverage';
import { agentHasRuntime } from '@/lib/runtimes';
import { useTranslations } from 'next-intl';

import { AgentActivityChart } from '@/components/common/agents/agent-activity-chart';
import AgentActivityTab from '@/components/common/agents/agent-activity-tab';
import AgentWorkTab from '@/components/common/agents/agent-work-tab';
import { Button } from '@/components/ui/button';
import { type Agent, type AgentRoster, type AgentTask } from '@/lib/agents';

interface AgentOverviewTabProps {
   agent: Agent;
   /** Owner, runtime, load and a 30-day history; absent while it loads. */
   roster: AgentRoster | undefined;
   /** The newest page of this agent's tasks, for durations and activity. */
   tasks: AgentTask[] | null;
   /** Null when there is no further activity page. */
   cursor: string | null;
   loadingMore: boolean;
   onLoadMore: () => void;
   /** Re-read activity after a cancellation. */
   onActivityChanged: () => void;
   onOpenSettings: () => void;
}

/**
 * How this agent has been doing, what it is assigned, and what it is running.
 *
 * Daily counts come from the roster (up to 30 days). Assignments and run lists
 * used to be their own tabs; they live here so one glance covers the agent.
 */
export default function AgentOverviewTab({
   agent,
   roster,
   tasks,
   cursor,
   loadingMore,
   onLoadMore,
   onActivityChanged,
   onOpenSettings,
}: AgentOverviewTabProps) {
   const t = useTranslations('agentsChat.detail');
   const coverage = useAgentCoverage();

   // Work is waiting and nothing can pick it up. Said here rather than left to
   // settings, because a queue that cannot drain is the one fact on this page
   // somebody has to act on.
   // Only a bound runtime's status is known here; an agent on the workspace
   // default is stalled only when there is no runtime for it at all.
   const stalled =
      (roster?.queued ?? 0) > 0 &&
      (!agentHasRuntime(coverage, agent.id) ||
         (roster?.runtimeId !== null && roster?.runtimeStatus !== 'active'));

   return (
      <div className="flex flex-col gap-8 px-8 py-6">
         {stalled ? (
            <div className="flex items-start gap-2 rounded-lg border border-status-warning/40 bg-status-warning/5 px-4 py-3">
               <AlertTriangle className="mt-0.5 size-4 shrink-0 text-status-warning" aria-hidden />
               <div className="min-w-0">
                  <p>{t('queuedNoRuntime', { count: roster?.queued ?? 0 })}</p>
                  <Button size="xs" variant="secondary" className="mt-2" onClick={onOpenSettings}>
                     {t('bannerNoRuntimeLink')}
                  </Button>
               </div>
            </div>
         ) : null}

         <AgentActivityChart activity={roster?.activity} />

         <AgentWorkTab agentId={agent.id} embedded />
         <AgentActivityTab
            embedded
            agentName={agent.name}
            tasks={tasks}
            cursor={cursor}
            loadingMore={loadingMore}
            onLoadMore={onLoadMore}
            onChanged={onActivityChanged}
         />
      </div>
   );
}
