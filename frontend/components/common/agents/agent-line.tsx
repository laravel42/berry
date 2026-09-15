'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertTriangle, MoreHorizontal } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { BerryMark } from '@/components/brand/berry-mark';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuSeparator,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
   agentModelDisplay,
   agentStatusDisplay,
   useAgentAvatarSrc,
   type Agent,
   type AgentRoster,
} from '@/lib/agents';
import { agentHasRuntime, type AgentCoverage } from '@/lib/runtimes';
import type { AgentColumn } from '@/store/agents-list-store';
import { AgentSparkline } from './agent-sparkline';
import { agentModelName } from './model-name';
import { PresenceDot } from './presence-dot';

export interface AgentRowActions {
   onDuplicate: (agent: Agent) => void;
   onCancelRuns: (agent: Agent) => void;
   onArchive: (agent: Agent) => void;
   onRestore: (agent: Agent) => void;
}

interface AgentLineProps {
   agent: Agent;
   /** Load, runtime and recent activity; absent while the roster is loading. */
   roster: AgentRoster | undefined;
   /** Which runtime is the workspace default; null while it loads. */
   coverage: AgentCoverage | null;
   columns: AgentColumn[];
   selected: boolean;
   onToggleSelected: (id: string) => void;
   actions: AgentRowActions;
}

/** The widths every cell shares with its header, so the two line up. */
export const COLUMN_WIDTH: Record<AgentColumn, string> = {
   presence: 'w-20',
   workload: 'w-24',
   runtime: 'w-32',
   activity: 'w-24',
   runs: 'w-14',
   lastActive: 'w-28',
   model: 'w-40',
   owner: 'w-28',
   access: 'w-28',
};

/** Columns that drop out before the row starts crowding the name. */
export const COLUMN_BREAKPOINT: Partial<Record<AgentColumn, string>> = {
   presence: 'hidden sm:flex',
   workload: 'hidden md:flex',
   runtime: 'hidden lg:flex',
   activity: 'hidden md:flex',
   lastActive: 'hidden lg:flex',
   model: 'hidden xl:flex',
   owner: 'hidden xl:flex',
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
   coverage,
   columns,
   selected,
   onToggleSelected,
   actions,
}: AgentLineProps) {
   const { orgId } = useParams<{ orgId: string }>();
   const t = useTranslations('agentsChat.list');
   const rosterCopy = useTranslations('agents.roster');
   const org = useTranslations('organization');
   const format = useFormatter();
   const status = agentStatusDisplay(agent.status);
   const model = agentModelDisplay(agent);
   const level = agent.contract?.autonomy_level ?? agent.autonomyLevel ?? null;
   const levelKey = level === null ? null : (String(level) as '1' | '2' | '3' | '4' | '5');
   const avatarSrc = useAgentAvatarSrc(agent.avatarUrl);
   const href = `/${orgId}/agents/${agent.id}`;
   const archived = Boolean(agent.archivedAt);
   // The orchestrator is the one agent a workspace cannot do without, and the
   // server refuses to archive it. Saying so here beats a 409 after the click.
   const isProtected = agent.capabilities.includes('orchestrate');

   const workload = roster
      ? roster.running > 0
         ? t('workloadWorking')
         : roster.queued > 0
           ? t('workloadQueued', { count: roster.queued })
           : t('workloadIdle')
      : '';

   const runtimeStatusLabel =
      roster?.runtimeStatus === 'active'
         ? t('runtimeHealthy')
         : roster?.runtimeStatus === 'unreachable'
           ? t('runtimeUnreachable')
           : roster?.runtimeStatus === 'disabled'
             ? t('runtimeDisabled')
             : '';

   const accessLabel =
      agent.access?.assign === 'admins'
         ? t('accessAdmins')
         : agent.access?.assign === 'listed'
           ? t('accessListed')
           : t('accessEveryone');

   // A presence dot is a claim about activity, and an agent that has never
   // run has none to claim. The dot is earned by a run in flight or in the
   // record; until then the cell says so in words.
   const hasPresence = roster !== undefined && (roster.running > 0 || roster.totalRuns > 0);

   const presenceLabel =
      status.tone === 'online'
         ? t('availabilityAvailable')
         : status.tone === 'busy'
           ? t('availabilityBusy')
           : status.tone === 'offline'
             ? t('availabilityOffline')
             : t('availabilityUnknown');

   // The runtime cell earns a pill only when it says something: a binding to a
   // runtime other than the workspace default, a bound runtime that is not
   // healthy, or no runtime at all. Twenty rows on the default would otherwise
   // repeat the same green pill twenty times.
   const onDefault =
      coverage !== null &&
      roster?.runtimeId !== null &&
      roster?.runtimeId === coverage.defaultRuntimeId;
   const runtimeHealthy = roster?.runtimeStatus === 'active';
   const noRuntime =
      roster !== undefined && !roster.runtimeId && !agentHasRuntime(coverage, agent.id);

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
                  <BerryMark size="sm" tone="working" label={agent.name} />
               )}
            </span>
            <div className="min-w-0 flex-1 overflow-hidden">
               {/* Wrapping, not shrinking: on a phone the chip drops under the
                   name rather than squeezing the name to nothing. */}
               <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="min-w-0 max-w-full truncate font-medium leading-none">
                     {agent.name}
                  </span>
                  {levelKey ? (
                     <span
                        title={org('levelHint')}
                        className="shrink-0 rounded border border-border/70 px-1.5 py-px text-muted-foreground"
                     >
                        {org('levelChip', {
                           level: levelKey,
                           name: org(`levelNames.${levelKey}`),
                        })}
                     </span>
                  ) : null}
               </span>
               {agent.description ? (
                  // Its own line, the full width of the name column: beside
                  // the level chip it was ten characters and an ellipsis.
                  <p className="mt-0.5 truncate text-muted-foreground" title={agent.description}>
                     {agent.description}
                  </p>
               ) : null}
            </div>
         </Link>

         <Cell column="presence" columns={columns}>
            {hasPresence ? (
               <>
                  <PresenceDot tone={status.tone} label={presenceLabel} />
                  {status.tone === 'online' ? null : (
                     <span className="truncate">{presenceLabel}</span>
                  )}
               </>
            ) : roster ? (
               <span className="truncate text-muted-foreground/70">{rosterCopy('neverRan')}</span>
            ) : null}
         </Cell>

         <Cell column="workload" columns={columns}>
            <span className="truncate">{workload}</span>
         </Cell>

         <Cell column="runtime" columns={columns}>
            {roster?.runtimeId && (!onDefault || !runtimeHealthy) ? (
               <Badge
                  variant="outline"
                  title={runtimeStatusLabel}
                  className={cn(
                     'max-w-full overflow-hidden px-2 py-0.5 font-normal',
                     roster.runtimeStatus === 'active' &&
                        'border-status-success/50 text-status-success',
                     roster.runtimeStatus === 'unreachable' &&
                        'border-status-warning/50 text-status-warning',
                     roster.runtimeStatus === 'disabled' && 'border-border text-muted-foreground'
                  )}
               >
                  {roster.runtimeName}
               </Badge>
            ) : noRuntime ? (
               <Badge
                  variant="outline"
                  className="max-w-full overflow-hidden border-status-warning/50 px-2 py-0.5 font-normal text-status-warning"
               >
                  <AlertTriangle className="size-3 shrink-0" aria-hidden />
                  {t('runtimeNone')}
               </Badge>
            ) : roster && coverage ? (
               <span className="truncate" title={roster.runtimeName ?? undefined}>
                  {t('runtimeDefault')}
               </span>
            ) : null}
         </Cell>

         <Cell column="activity" columns={columns}>
            {roster ? (
               <AgentSparkline
                  activity={roster.activity}
                  emptyLabel={t('sparkEmptyShort')}
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

         <Cell column="runs" columns={columns} className="justify-end tabular-nums">
            {roster ? roster.totalRuns : null}
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
            <span className="truncate" title={model.title}>
               {agentModelName(agent)}
            </span>
         </Cell>

         <Cell column="owner" columns={columns}>
            <span className="truncate">{roster?.ownerName ?? t('ownerWorkspace')}</span>
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
