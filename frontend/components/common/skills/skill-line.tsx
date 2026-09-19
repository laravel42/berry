'use client';

import { colorForSkillLabel } from '@/lib/skill-labels';
import { Lock, MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Checkbox } from '@/components/ui/checkbox';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuLabel,
   DropdownMenuSeparator,
   DropdownMenuSub,
   DropdownMenuSubContent,
   DropdownMenuSubTrigger,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BerryApiError } from '@/lib/api';
import type { Agent } from '@/lib/agents';
import { isSkillInUse, refreshSkill, setSkillForAgent, type Skill } from '@/lib/skills';
import { cn } from '@/lib/utils';

import type { SkillColumn } from './skills-filters';

/** The widths every cell shares with its header, so the two line up. */
export const COLUMN_WIDTH: Record<SkillColumn, string> = {
   labels: 'w-52',
   agents: 'w-20',
   creator: 'w-28',
   updated: 'w-24',
   files: 'w-12',
};

/** Columns that drop out before the row starts crowding the name. */
export const COLUMN_BREAKPOINT: Partial<Record<SkillColumn, string>> = {
   labels: 'hidden md:flex',
   agents: 'hidden sm:flex',
   creator: 'hidden lg:flex',
   updated: 'hidden lg:flex',
};

interface SkillLineProps {
   skill: Skill;
   columns: SkillColumn[];
   agents: Agent[];
   canEdit: boolean;
   selected: boolean;
   open: boolean;
   onToggleSelected: (id: string) => void;
   onOpen: (id: string) => void;
   onChanged: () => void;
   refreshing: boolean;
   onRefreshing: (id: string | null) => void;
   onConfirmDelete: (skill: Skill) => void;
}

function Cell({
   column,
   columns,
   className,
   children,
}: {
   column: SkillColumn;
   columns: SkillColumn[];
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

/**
 * One skill in the catalogue table — same row shape as an agent line:
 * checkbox, name, optional cells, hover menu.
 */
export default function SkillLine({
   skill,
   columns,
   agents,
   canEdit,
   selected,
   open,
   onToggleSelected,
   onOpen,
   onChanged,
   refreshing,
   onRefreshing,
   onConfirmDelete,
}: SkillLineProps) {
   const t = useTranslations('areas.skills');
   const carried = skill.agents.filter((agent) => agent.enabled).length;

   const fail = (failure: unknown, fallback: string) =>
      toast.error(failure instanceof BerryApiError ? failure.message : fallback);

   const addTo = async (agent: Agent) => {
      try {
         await setSkillForAgent(skill.id, agent.id, true);
         toast.success(t('row.added', { skill: skill.name, agent: agent.name }));
         onChanged();
      } catch (failure) {
         fail(failure, t('row.addFailed'));
      }
   };

   const update = async () => {
      onRefreshing(skill.id);
      try {
         await refreshSkill(skill.id);
         toast.success(t('refresh.done'));
         onChanged();
      } catch (failure) {
         fail(failure, t('refresh.failed'));
      } finally {
         onRefreshing(null);
      }
   };

   return (
      <div
         className={cn(
            'group flex w-full items-center gap-3 border-b border-muted-foreground/5 px-6 py-3',
            'last:border-b-0 hover:bg-sidebar/50',
            (selected || open) && 'bg-sidebar/60'
         )}
      >
         {canEdit ? (
            <Checkbox
               checked={selected}
               onCheckedChange={() => onToggleSelected(skill.id)}
               aria-label={t('bulk.select', { name: skill.name })}
               className="shrink-0"
            />
         ) : null}

         <button
            type="button"
            className="flex min-w-0 flex-1 cursor-pointer items-center text-left"
            onClick={() => onOpen(skill.id)}
         >
            <div className="min-w-0 flex-1 overflow-hidden">
               <span className="block truncate font-medium leading-none">{skill.name}</span>
               {skill.description ? (
                  <p className="mt-0.5 truncate text-muted-foreground" title={skill.description}>
                     {skill.description}
                  </p>
               ) : null}
            </div>
         </button>

         <Cell column="labels" columns={columns} className="min-w-0 flex-wrap overflow-hidden">
            {skill.labels.map((label) => {
               const color = colorForSkillLabel(label);
               return (
                  <span
                     key={label}
                     title={label}
                     className="inline-flex min-w-0 items-center gap-1 rounded-full border px-2 py-0.5"
                     style={{
                        backgroundColor: `${color}26`,
                        borderColor: color,
                        color,
                     }}
                  >
                     <span className="max-w-[140px] truncate">{label}</span>
                  </span>
               );
            })}
         </Cell>

         <Cell column="agents" columns={columns}>
            <span className="truncate">
               {isSkillInUse(skill) ? t('row.usedBy', { count: carried }) : t('row.unused')}
            </span>
         </Cell>

         <Cell column="creator" columns={columns}>
            <span className="truncate">{skill.creatorName ?? t('row.unknownCreator')}</span>
         </Cell>

         <Cell column="updated" columns={columns}>
            <span className="truncate">{new Date(skill.updatedAt).toLocaleDateString()}</span>
         </Cell>

         <Cell column="files" columns={columns} className="justify-end">
            {skill.files.length}
         </Cell>

         {canEdit ? (
            <DropdownMenu>
               <DropdownMenuTrigger asChild>
                  <button
                     type="button"
                     aria-label={t('row.menu')}
                     className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-colors hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:opacity-100 data-[state=open]:opacity-100"
                  >
                     <MoreHorizontal className="size-4" />
                  </button>
               </DropdownMenuTrigger>
               <DropdownMenuContent align="end" className="min-w-52">
                  <DropdownMenuSub>
                     <DropdownMenuSubTrigger>{t('row.addToAgent')}</DropdownMenuSubTrigger>
                     <DropdownMenuSubContent className="max-h-80 w-56 overflow-y-auto">
                        {agents.length === 0 ? (
                           <DropdownMenuItem disabled>{t('row.noAgents')}</DropdownMenuItem>
                        ) : (
                           <>
                              <DropdownMenuLabel>{t('row.notCarrying')}</DropdownMenuLabel>
                              {agents
                                 .filter(
                                    (agent) =>
                                       !skill.agents.some(
                                          (bound) => bound.id === agent.id && bound.enabled
                                       )
                                 )
                                 .map((agent) => (
                                    <DropdownMenuItem
                                       key={agent.id}
                                       onClick={() => void addTo(agent)}
                                    >
                                       {agent.name}
                                    </DropdownMenuItem>
                                 ))}
                              <DropdownMenuSeparator />
                              <DropdownMenuLabel>{t('row.carrying')}</DropdownMenuLabel>
                              {skill.agents
                                 .filter((bound) => bound.enabled)
                                 .map((bound) => (
                                    <DropdownMenuItem key={bound.id} disabled>
                                       {bound.name}
                                    </DropdownMenuItem>
                                 ))}
                           </>
                        )}
                     </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuItem
                     disabled={skill.source.kind !== 'github' || refreshing}
                     onClick={() => void update()}
                  >
                     {t('refresh.action')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                     variant="destructive"
                     className="text-destructive focus:text-destructive data-[variant=destructive]:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive"
                     onClick={() => onConfirmDelete(skill)}
                  >
                     {t('row.delete')}
                  </DropdownMenuItem>
               </DropdownMenuContent>
            </DropdownMenu>
         ) : (
            <Lock className="size-4 shrink-0 text-muted-foreground" aria-label={t('row.locked')} />
         )}
      </div>
   );
}
