'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { MoreHorizontal } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { BerryMark } from '@/components/brand/berry-mark';
import { Checkbox } from '@/components/ui/checkbox';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuSeparator,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { colorForAgent } from '@/lib/agent-color';
import { cn } from '@/lib/utils';
import { useAgentAvatarSrc, type Agent, type AgentRoster } from '@/lib/agents';
import type { AgentColumn } from '@/store/agents-list-store';
import { AgentModelChip } from './agent-model-chip';
import { AgentSparkline } from './agent-sparkline';
import { AgentWorkloadChip } from './agent-workload-chip';

export interface AgentRowActions {
   onDuplicate: (agent: Agent) => void;
   onCancelRuns: (agent: Agent) => void;
   onArchive: (agent: Agent) => void;
   onRestore: (agent: Agent) => void;
}

interface AgentLineProps {
   agent: Agent;
   /** Load and recent activity; absent while the roster is loading. */
   roster: AgentRoster | undefined;
   columns: AgentColumn[];
   selected: boolean;
   onToggleSelected: (id: string) => void;
   actions: AgentRowActions;
}

/** The widths every cell shares with its header, so the two line up. */
export const COLUMN_WIDTH: Record<AgentColumn, string> = {
   activity: 'w-24',
   lastActive: 'w-28',
   model: 'w-40',
   access: 'w-28',
};

/** Columns that drop out before the row starts crowding the name. */
export const COLUMN_BREAKPOINT: Partial<Record<AgentColumn, string>> = {
   activity: 'hidden md:flex',
   lastActive: 'hidden lg:flex',
   model: 'hidden xl:flex',
   access: 'hidden 2xl:flex',
};

function Cell({
   column,
   columns,
   className,
   children,
}: {
   column: AgentColumn;
   columns: AgentColumn[];
   className?: string;
   children: React.ReactNode;
}) {
   if (!columns.includes(column)) return null;
   return (
      <div
         className={cn(
            'shrink-0 items-center gap-1.5 text-muted-foreground',
            COLUMN_WIDTH[column],
            COLUMN_BREAKPOINT[column] ?? 'flex',
            className
         )}
      >
         {children}
      </div>
   );
}

export default function AgentLine({
   agent,
   roster,
   columns,
   selected,
   onToggleSelected,
   actions,
}: AgentLineProps) {
   const { orgId } = useParams<{ orgId: string }>();
   const t = useTranslations('agentsChat.list');
   const format = useFormatter();
   const avatarSrc = useAgentAvatarSrc(agent.avatarUrl);
   const href = `/${orgId}/agents/${agent.id}`;
   const archived = Boolean(agent.archivedAt);
   // The orchestrator is the one agent a workspace cannot do without, and the
   // server refuses to archive it. Saying so here beats a 409 after the click.
   const isProtected = agent.capabilities.includes('orchestrate');

   const accessLabel =
      agent.access?.assign === 'admins'
         ? t('accessAdmins')
         : agent.access?.assign === 'listed'
           ? t('accessListed')
           : t('accessEveryone');

   const weekRuns = roster?.activity.reduce((sum, point) => sum + point.runs, 0) ?? 0;
   const weekFailed = roster?.activity.reduce((sum, point) => sum + point.failed, 0) ?? 0;
   const weekFailRate = weekRuns === 0 ? 0 : Math.round((weekFailed / weekRuns) * 100);

   return (
      <div
         className={cn(
            'group flex w-full items-center gap-3 border-b border-muted-foreground/5 px-6 py-3',
            'last:border-b-0 hover:bg-sidebar/50',
            selected && 'bg-sidebar/60'
         )}
      >
         <Checkbox
            checked={selected}
            onCheckedChange={() => onToggleSelected(agent.id)}
            aria-label={t('select', { name: agent.name })}
            className="shrink-0"
         />

         <Link href={href} className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/40">
               {avatarSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a blob or external URL, not an optimisable asset
                  <img src={avatarSrc} alt="" className="size-full object-cover" />
               ) : (
                  <BerryMark
                     size="sm"
                     tone="working"
                     dotColor={colorForAgent(agent.id)}
                     label={agent.name}
                  />
               )}
            </span>
            <div className="min-w-0 flex-1 overflow-hidden">
               <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="min-w-0 max-w-full truncate font-medium leading-none">
                     {agent.name}
                  </span>
                  <AgentWorkloadChip roster={roster} className="px-1.5 py-px" />
               </span>
               {agent.description ? (
                  <p className="mt-0.5 truncate text-muted-foreground" title={agent.description}>
                     {agent.description}
                  </p>
               ) : null}
            </div>
         </Link>

         <Cell column="activity" columns={columns}>
            {roster ? (
               <AgentSparkline
                  activity={roster.activity}
                  emptyLabel={t('sparkEmptyShort')}
                  weekTitle={t('sparkWeekTitle')}
                  weekSummary={t('sparkWeekSummary', {
                     runs: weekRuns,
                     failed: weekFailed,
                     percent: weekFailRate,
                  })}
                  describe={(point) =>
                     t('sparkTooltip', {
                        day: point.day,
                        runs: point.runs,
                        failed: point.failed,
                        percent: point.percent,
                     })
                  }
               />
            ) : null}
         </Cell>

         <Cell column="lastActive" columns={columns}>
            <span className="truncate">
               {roster?.lastActiveAt
                  ? format.relativeTime(new Date(roster.lastActiveAt))
                  : roster
                    ? t('lastActiveNever')
                    : ''}
            </span>
         </Cell>

         <Cell column="model" columns={columns}>
            <AgentModelChip agent={agent} className="max-w-full truncate" />
         </Cell>

         <Cell column="access" columns={columns}>
            <span className="truncate">{accessLabel}</span>
         </Cell>

         <DropdownMenu>
            <DropdownMenuTrigger asChild>
               <button
                  type="button"
                  aria-label={t('menuActions', { name: agent.name })}
                  className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-colors hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:opacity-100 data-[state=open]:opacity-100"
               >
                  <MoreHorizontal className="size-4" />
               </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
               <DropdownMenuItem onSelect={() => window.open(href, '_blank', 'noopener')}>
                  {t('menuOpenNewTab')}
               </DropdownMenuItem>
               <DropdownMenuItem onSelect={() => actions.onDuplicate(agent)}>
                  {t('menuDuplicate')}
               </DropdownMenuItem>
               <DropdownMenuSeparator />
               {archived ? (
                  <DropdownMenuItem onSelect={() => actions.onRestore(agent)}>
                     {t('menuRestore')}
                  </DropdownMenuItem>
               ) : (
                  <>
                     <DropdownMenuItem onSelect={() => actions.onCancelRuns(agent)}>
                        {t('menuCancelRuns')}
                     </DropdownMenuItem>
                     <DropdownMenuItem
                        disabled={isProtected}
                        title={isProtected ? t('protectedAgent') : undefined}
                        onSelect={() => actions.onArchive(agent)}
                     >
                        {t('menuArchive')}
                     </DropdownMenuItem>
                  </>
               )}
            </DropdownMenuContent>
         </DropdownMenu>
      </div>
   );
}
