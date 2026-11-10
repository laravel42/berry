'use client';

import { useTranslations } from 'next-intl';

import { Checkbox } from '@/components/ui/checkbox';
import { isSkillInUse, type Skill } from '@/lib/skills';
import { cn } from '@/lib/utils';

import type { SkillColumn } from './skills-filters';

/** The widths every cell shares with its header, so the two line up. */
export const COLUMN_WIDTH: Record<SkillColumn, string> = {
   agents: 'w-20',
   creator: 'w-28',
   updated: 'w-24',
};

/** Columns that drop out before the row starts crowding the name. */
export const COLUMN_BREAKPOINT: Partial<Record<SkillColumn, string>> = {
   agents: 'hidden sm:flex',
   creator: 'hidden lg:flex',
   updated: 'hidden lg:flex',
};

interface SkillLineProps {
   skill: Skill;
   columns: SkillColumn[];
   canEdit: boolean;
   selected: boolean;
   open: boolean;
   onToggleSelected: (id: string) => void;
   onOpen: (id: string) => void;
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
 * One skill in the catalogue table — checkbox, name, optional cells.
 * Row actions live on the detail drawer and the bulk bar.
 */
export default function SkillLine({
   skill,
   columns,
   canEdit,
   selected,
   open,
   onToggleSelected,
   onOpen,
}: SkillLineProps) {
   const t = useTranslations('areas.skills');
   const carried = skill.agents.filter((agent) => agent.enabled).length;

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
      </div>
   );
}
