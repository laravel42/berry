'use client';

import { ChevronDown, CircleDashed } from 'lucide-react';
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { BerryApiError } from '@/lib/api';
import type { Agent } from '@/lib/agents';
import { colorForSkillLabel } from '@/lib/skill-labels';
import { deleteSkill, restoreSkill, type Skill } from '@/lib/skills';
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
   /** Catalogue colours, keyed by label name. A missing name keeps the hash colour. */
   labelColors?: Record<string, string>;
   archived?: boolean;
}

/** Each sort's natural order: names and labels A→Z, the newest and the most used first. */
function sortSkills(skills: Skill[], sort: SkillCriteria['sort'], descending = false): Skill[] {
   const carried = (skill: Skill) => skill.agents.filter((agent) => agent.enabled).length;
   // Compare labels in the order the row shows them. A skill with none sorts last.
   const byLabels = (left: Skill, right: Skill): number => {
      if (left.labels.length === 0 && right.labels.length === 0) return 0;
      if (left.labels.length === 0) return 1;
      if (right.labels.length === 0) return -1;
      const length = Math.max(left.labels.length, right.labels.length);
      for (let index = 0; index < length; index++) {
         const a = left.labels[index];
         const b = right.labels[index];
         if (a === undefined) return -1;
         if (b === undefined) return 1;
         const diff = a.localeCompare(b);
         if (diff !== 0) return diff;
      }
      return 0;
   };
   const compare = (left: Skill, right: Skill): number => {
      if (sort === 'updated') return right.updatedAt.localeCompare(left.updatedAt);
      if (sort === 'usage') return carried(right) - carried(left);
      if (sort === 'labels') return byLabels(left, right);
      return left.name.localeCompare(right.name);
   };
   const sign = descending ? -1 : 1;
   return [...skills].sort(
      (left, right) => sign * compare(left, right) || left.name.localeCompare(right.name)
   );
}

/** Which column heading sorts by what; the rest stay as text. */
const SORT_FOR_COLUMN: Partial<Record<SkillColumn | 'skill', SkillCriteria['sort']>> = {
   skill: 'name',
   updated: 'updated',
   agents: 'usage',
};

interface LabelGroup {
   id: string;
   /** Empty when the skills in the group carry no label. */
   label: string;
   skills: Skill[];
}

/**
 * One accordion per label, in name order, with unlabeled skills last.
 *
 * A skill with several labels is listed under each of them. The order inside
 * a group is the order the catalogue was already sorted into.
 */
function groupByLabel(skills: Skill[]): LabelGroup[] {
   const buckets = new Map<string, Skill[]>();
   for (const skill of skills) {
      const labels = skill.labels.length > 0 ? skill.labels : [''];
      for (const label of labels) {
         const current = buckets.get(label);
         if (current) current.push(skill);
         else buckets.set(label, [skill]);
      }
   }
   return [...buckets.entries()]
      .sort(([left], [right]) => {
         if (left === '') return 1;
         if (right === '') return -1;
         return left.localeCompare(right, undefined, { sensitivity: 'base' });
      })
      .map(([label, grouped]) => ({
         id: label === '' ? 'unlabeled' : `label:${label}`,
         label,
         skills: grouped,
      }));
}

/** First time each skill appears, top to bottom, so the detail drawer steps through the groups. */
function firstSeenIds(groups: LabelGroup[]): string[] {
   const ids: string[] = [];
   const seen = new Set<string>();
   for (const group of groups) {
      for (const skill of group.skills) {
         if (seen.has(skill.id)) continue;
         seen.add(skill.id);
         ids.push(skill.id);
      }
   }
   return ids;
}

interface SkillLabelGroupProps {
   group: LabelGroup;
   columns: SkillColumn[];
   agents: Agent[];
   canEdit: boolean;
   openId: string | null;
   selection: string[];
   refreshingId: string | null;
   onToggleSelected: (id: string) => void;
   onOpen: (id: string) => void;
   onChanged: () => void;
   onRefreshing: (id: string | null) => void;
   onConfirmDelete: (skill: Skill) => void;
   onRestore: (skill: Skill) => void;
   labelColors?: Record<string, string>;
}

/** One label, opened and closed the same way a task-list group is. */
function SkillLabelGroup({
   group,
   columns,
   agents,
   canEdit,
   openId,
   selection,
   refreshingId,
   onToggleSelected,
   onOpen,
   onChanged,
   onRefreshing,
   onConfirmDelete,
   onRestore,
   labelColors,
}: SkillLabelGroupProps) {
   const t = useTranslations('areas.skills');
   const unlabeled = group.label === '';
   const name = unlabeled ? t('groups.unlabeled') : group.label;

   return (
      <Collapsible defaultOpen className="group/skill-group bg-container">
         <div className="sticky top-0 z-10 h-10 w-full bg-container">
            <div
               data-column-tint="neutral"
               className="flex h-full w-full items-center bg-group-tint-neutral px-6"
            >
               <CollapsibleTrigger asChild>
                  <button
                     type="button"
                     className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                     <ChevronDown
                        aria-hidden
                        className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=closed]/skill-group:-rotate-90"
                     />
                     {unlabeled ? (
                        <CircleDashed
                           aria-hidden
                           className="size-4 shrink-0 text-muted-foreground"
                        />
                     ) : (
                        <span
                           aria-hidden
                           className="size-2.5 shrink-0 rounded-full"
                           style={{
                              backgroundColor:
                                 labelColors?.[group.label] ?? colorForSkillLabel(group.label),
                           }}
                        />
                     )}
                     <span className="truncate font-medium">{name}</span>
                     <span className="text-muted-foreground">{group.skills.length}</span>
                  </button>
               </CollapsibleTrigger>
            </div>
         </div>
         <CollapsibleContent>
            {group.skills.map((skill) => (
               <SkillLine
                  key={skill.id}
                  skill={skill}
                  columns={columns}
                  agents={agents}
                  canEdit={canEdit}
                  selected={selection.includes(skill.id)}
                  open={openId === skill.id}
                  onToggleSelected={onToggleSelected}
                  onOpen={onOpen}
                  onChanged={onChanged}
                  refreshing={refreshingId === skill.id}
                  onRefreshing={onRefreshing}
                  onConfirmDelete={onConfirmDelete}
                  onRestore={onRestore}
               />
            ))}
         </CollapsibleContent>
      </Collapsible>
   );
}

/**
 * The workspace's skills, grouped by label.
 *
 * The groups use the same accordion as the task list: a tinted header with a
 * chevron and a count, and a gap between groups. Rows are acted on one at a
 * time through the menu, or several at once through the bar that appears with
 * a selection.
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
   labelColors,
   archived = false,
}: Props) {
   const t = useTranslations('areas.skills');
   const setOrderedIds = useSkillsCatalogueStore((state) => state.setOrderedIds);
   const [selection, setSelection] = useState<string[]>([]);
   const [confirming, setConfirming] = useState<Skill | null>(null);
   const [refreshingId, setRefreshingId] = useState<string | null>(null);

   const rows = useMemo(
      () => sortSkills(skills ?? [], criteria.sort, criteria.descending),
      [skills, criteria.sort, criteria.descending]
   );
   const groups = useMemo(() => groupByLabel(rows), [rows]);
   const orderedIds = useMemo(() => firstSeenIds(groups), [groups]);
   const selected = rows.filter((skill) => selection.includes(skill.id));
   const allSelected = rows.length > 0 && selection.length === rows.length;

   useEffect(() => {
      setOrderedIds(orderedIds);
   }, [orderedIds, setOrderedIds]);

   if (error) return <p className="px-6 py-8 text-muted-foreground">{error}</p>;
   if (skills === null) return <EmptyStateLoading label={t('loading')} />;

   if (rows.length === 0) {
      return (
         <EmptyState
            icon={
               <EmptyStateMark
                  label={narrowed ? t('noMatch') : archived ? t('empty.archived') : t('empty.mark')}
               />
            }
         >
            {narrowed ? (
               <EmptyStateText>{t('noMatch')}</EmptyStateText>
            ) : archived ? (
               <EmptyStateText>{t('empty.archived')}</EmptyStateText>
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

   const restore = async (skill: Skill) => {
      try {
         await restoreSkill(skill.id);
         toast.success(t('row.restored', { name: skill.name }));
         setSelection((current) => current.filter((entry) => entry !== skill.id));
         onChanged();
      } catch (failure) {
         fail(failure, t('row.restoreFailed'));
      }
   };

   // The same heading again reverses the order; a new one starts in its natural order.
   const sortBy = (sort: SkillCriteria['sort']) => {
      onCriteriaChange?.({
         ...criteria,
         sort,
         descending: criteria.sort === sort ? !criteria.descending : false,
      });
   };
   const arrow = (sort: SkillCriteria['sort']) =>
      criteria.sort === sort ? <span aria-hidden>{criteria.descending ? ' ↑' : ' ↓'}</span> : null;

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
                  'truncate uppercase hover:text-foreground',
                  criteria.sort === key && 'text-foreground'
               )}
            >
               {label}
               {arrow(key)}
            </button>
         </div>
      );
   };

   return (
      <div className="flex h-full min-h-0 w-full flex-col">
         <div className="flex shrink-0 items-center gap-3 border-b bg-container px-6 py-[6px] font-medium tracking-wider text-muted-foreground uppercase">
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
                     'min-w-0 flex-1 text-left uppercase hover:text-foreground',
                     criteria.sort === 'name' && 'text-foreground'
                  )}
               >
                  {t('columns.skill')}
                  {arrow('name')}
               </button>
            ) : (
               <div className="min-w-0 flex-1">{t('columns.skill')}</div>
            )}
            {header('agents', t('columns.agents'))}
            {header('creator', t('columns.creator'))}
            {header('updated', t('columns.updated'))}
            {header('files', t('columns.files'), 'justify-end')}
            <span className="size-6 shrink-0" aria-hidden />
         </div>
         <div className="min-h-0 flex-1 overflow-y-auto divide-y-[3px] divide-background">
            {groups.map((group) => (
               <SkillLabelGroup
                  key={group.id}
                  group={group}
                  columns={criteria.columns}
                  agents={agents}
                  canEdit={canEdit}
                  openId={openId}
                  selection={selection}
                  refreshingId={refreshingId}
                  onToggleSelected={toggle}
                  onOpen={onOpen}
                  onChanged={onChanged}
                  onRefreshing={setRefreshingId}
                  onConfirmDelete={setConfirming}
                  onRestore={restore}
                  labelColors={labelColors}
               />
            ))}
         </div>

         {canEdit ? (
            <SkillBulkBar
               selected={selected}
               agents={agents}
               onClear={() => setSelection([])}
               onChanged={onChanged}
               archived={archived}
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
