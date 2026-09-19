'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { ConfirmAction } from '@/components/common/confirm-action';
import {
   EmptyState,
   EmptyStateLoading,
   EmptyStateMark,
   EmptyStateText,
   EmptyStateTitle,
} from '@/components/common/empty-state';
import { Checkbox } from '@/components/ui/checkbox';
import { BerryApiError } from '@/lib/api';
import type { Agent } from '@/lib/agents';
import { deleteSkill, type Skill } from '@/lib/skills';
import { cn } from '@/lib/utils';
import { useSkillsCatalogueStore } from '@/store/skills-catalogue-store';

import SkillBulkBar from './skill-bulk-bar';
import SkillLine, { COLUMN_BREAKPOINT, COLUMN_WIDTH } from './skill-line';
import type { SkillColumn, SkillCriteria } from './skills-filters';

interface Props {
   skills: Skill[] | null;
   error: string | null;
   criteria: SkillCriteria;
   agents: Agent[];
   /** False for a role that may read the catalogue but not change it. */
   canEdit: boolean;
   openId: string | null;
   onOpen: (id: string) => void;
   onChanged: () => void;
   /** True while any filter or the search box is narrowing the list. */
   narrowed: boolean;
   /** Updates sort when a sortable column heading is clicked. */
   onCriteriaChange?: (criteria: SkillCriteria) => void;
}

function sortSkills(skills: Skill[], sort: SkillCriteria['sort']): Skill[] {
   const sorted = [...skills];
   if (sort === 'updated') {
      sorted.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
   } else if (sort === 'usage') {
      const carried = (skill: Skill) => skill.agents.filter((agent) => agent.enabled).length;
      sorted.sort(
         (left, right) => carried(right) - carried(left) || left.name.localeCompare(right.name)
      );
   } else {
      sorted.sort((left, right) => left.name.localeCompare(right.name));
   }
   return sorted;
}

/** Which column heading sorts by what; the rest are labels only. */
const SORT_FOR_COLUMN: Partial<Record<SkillColumn | 'skill', SkillCriteria['sort']>> = {
   skill: 'name',
   updated: 'updated',
   agents: 'usage',
};

/**
 * The workspace's skills.
 *
 * Same table shape as Agents: sticky header, checkbox, name, optional cells,
 * hover menu. Rows are acted on one at a time through the menu, or several at
 * once through the bar that appears with a selection.
 */
export default function SkillsList({
   skills,
   error,
   criteria,
   agents,
   canEdit,
   openId,
   onOpen,
   onChanged,
   narrowed,
   onCriteriaChange,
}: Props) {
   const t = useTranslations('areas.skills');
   const setOrderedIds = useSkillsCatalogueStore((state) => state.setOrderedIds);
   const [selection, setSelection] = useState<string[]>([]);
   const [confirming, setConfirming] = useState<Skill | null>(null);
   const [refreshingId, setRefreshingId] = useState<string | null>(null);

   const rows = useMemo(() => sortSkills(skills ?? [], criteria.sort), [skills, criteria.sort]);
   const selected = rows.filter((skill) => selection.includes(skill.id));
   const allSelected = rows.length > 0 && selection.length === rows.length;

   useEffect(() => {
      setOrderedIds(rows.map((skill) => skill.id));
   }, [rows, setOrderedIds]);

   if (error) return <p className="px-6 py-8 text-muted-foreground">{error}</p>;
   if (skills === null) return <EmptyStateLoading label={t('loading')} />;

   if (rows.length === 0) {
      return (
         <EmptyState icon={<EmptyStateMark label={narrowed ? t('noMatch') : t('empty.mark')} />}>
            {narrowed ? (
               <EmptyStateText>{t('noMatch')}</EmptyStateText>
            ) : (
               <>
                  <EmptyStateTitle>{t('empty.title')}</EmptyStateTitle>
                  <EmptyStateText>{t('empty.body')}</EmptyStateText>
               </>
            )}
         </EmptyState>
      );
   }

   const toggle = (id: string) =>
      setSelection((current) =>
         current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
      );

   const fail = (failure: unknown, fallback: string) =>
      toast.error(failure instanceof BerryApiError ? failure.message : fallback);

   const remove = async (skill: Skill) => {
      try {
         await deleteSkill(skill.id);
         toast.success(t('row.deleted', { name: skill.name }));
         setSelection((current) => current.filter((entry) => entry !== skill.id));
         onChanged();
      } catch (failure) {
         fail(failure, t('row.deleteFailed'));
      }
   };

   const sortBy = (sort: SkillCriteria['sort']) => {
      onCriteriaChange?.({ ...criteria, sort });
   };

   const header = (column: SkillColumn, label: string, align?: string) => {
      if (!criteria.columns.includes(column)) return null;
      const key = SORT_FOR_COLUMN[column];
      const classes = cn(
         'shrink-0 items-center gap-1',
         COLUMN_WIDTH[column],
         COLUMN_BREAKPOINT[column] ?? 'flex',
         align
      );
      if (!key || !onCriteriaChange) {
         return (
            <div className={classes} title={label}>
               {label}
            </div>
         );
      }
      return (
         <div className={classes}>
            <button
               type="button"
               onClick={() => sortBy(key)}
               aria-label={label}
               className={cn(
                  'truncate hover:text-foreground',
                  criteria.sort === key && 'text-foreground'
               )}
            >
               {label}
               {criteria.sort === key ? <span aria-hidden> ↓</span> : null}
            </button>
         </div>
      );
   };

   return (
      <div className="flex h-full min-h-0 w-full flex-col">
         <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="sticky top-0 z-10 flex items-center gap-3 border-b bg-container px-4 py-[6px] text-muted-foreground">
               {canEdit ? (
                  <Checkbox
                     className="shrink-0"
                     aria-label={t('bulk.selectAll')}
                     checked={allSelected}
                     onCheckedChange={() =>
                        setSelection(allSelected ? [] : rows.map((skill) => skill.id))
                     }
                  />
               ) : null}
               {onCriteriaChange ? (
                  <button
                     type="button"
                     onClick={() => sortBy('name')}
                     className={cn(
                        'min-w-0 flex-1 text-left hover:text-foreground',
                        criteria.sort === 'name' && 'text-foreground'
                     )}
                  >
                     {t('columns.skill')}
                     {criteria.sort === 'name' ? <span aria-hidden> ↓</span> : null}
                  </button>
               ) : (
                  <div className="min-w-0 flex-1">{t('columns.skill')}</div>
               )}
               {header('labels', t('columns.labels'))}
               {header('agents', t('columns.agents'))}
               {header('creator', t('columns.creator'))}
               {header('updated', t('columns.updated'))}
               {header('files', t('columns.files'), 'justify-end')}
               <span className="size-6 shrink-0" aria-hidden />
            </div>

            {rows.map((skill) => (
               <SkillLine
                  key={skill.id}
                  skill={skill}
                  columns={criteria.columns}
                  agents={agents}
                  canEdit={canEdit}
                  selected={selection.includes(skill.id)}
                  open={openId === skill.id}
                  onToggleSelected={toggle}
                  onOpen={onOpen}
                  onChanged={onChanged}
                  refreshing={refreshingId === skill.id}
                  onRefreshing={setRefreshingId}
                  onConfirmDelete={setConfirming}
               />
            ))}
         </div>

         {canEdit ? (
            <SkillBulkBar
               selected={selected}
               agents={agents}
               onClear={() => setSelection([])}
               onChanged={onChanged}
            />
         ) : null}

         <ConfirmAction
            open={confirming !== null}
            onOpenChange={(open) => !open && setConfirming(null)}
            title={t('row.confirmDeleteTitle', { name: confirming?.name ?? '' })}
            description={t('row.confirmDeleteBody')}
            cancelLabel={t('cancel')}
            confirmLabel={t('row.delete')}
            destructive
            onConfirm={() => {
               // Closes at once: the row reports its own progress and failure.
               if (confirming) void remove(confirming);
            }}
         />
      </div>
   );
}
