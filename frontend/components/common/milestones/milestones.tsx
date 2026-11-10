'use client';

import {
   EmptyState,
   EmptyStateLoading,
   EmptyStateMark,
   EmptyStateText,
   EmptyStateTitle,
} from '@/components/common/empty-state';
import type { Milestone } from '@/lib/milestones';
import { useMilestonesListStore } from '@/store/milestones-list-store';
import { useMilestonesStore } from '@/store/milestones-store';
import { useProjectsStore } from '@/store/projects-store';
import { ChevronLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useQueryState } from 'nuqs';
import { useCallback, useMemo } from 'react';
import { SplitIndex, useSelectFirst } from '@/components/common/page/split-index';
import Header from '@/components/layout/headers/milestones/header';
import GoalLine from './milestone-line';
import GoalOverview from './milestone-overview';

function EmptyGoals() {
   const t = useTranslations('milestones.empty');
   return (
      <EmptyState icon={<EmptyStateMark label={t('mark')} />}>
         <EmptyStateTitle>{t('title')}</EmptyStateTitle>
         <EmptyStateText>{t('body')}</EmptyStateText>
      </EmptyState>
   );
}

function applySearch(
   list: Milestone[],
   query: string,
   projectNameById: Map<string, string>
): Milestone[] {
   const term = query.trim().toLowerCase();
   if (!term) return list;
   return list.filter((goal) => {
      if (goal.title.toLowerCase().includes(term)) return true;
      if ((goal.description ?? '').toLowerCase().includes(term)) return true;
      const projectName = goal.projectId ? projectNameById.get(goal.projectId) : undefined;
      return (projectName ?? '').toLowerCase().includes(term);
   });
}

export default function Milestones() {
   const t = useTranslations('milestones.list');
   const milestones = useMilestonesStore((state) => state.milestones);
   const loaded = useMilestonesStore((state) => state.loaded);
   const error = useMilestonesStore((state) => state.error);
   const projects = useProjectsStore((state) => state.projects);
   const query = useMilestonesListStore((state) => state.query);

   const projectNameById = useMemo(() => {
      const map = new Map<string, string>();
      for (const project of projects) map.set(project.id, project.name);
      return map;
   }, [projects]);

   const displayed = useMemo(
      () => applySearch(milestones, query, projectNameById),
      [milestones, query, projectNameById]
   );

   const [selectedId, setSelectedId] = useQueryState('milestone');
   const select = useCallback((id: string | null) => void setSelectedId(id), [setSelectedId]);
   const ids = useMemo(() => displayed.map((goal) => goal.id), [displayed]);
   useSelectFirst(selectedId, ids, select);
   const selected = selectedId !== null && ids.includes(selectedId) ? selectedId : null;

   const rail = (
      <>
         <Header />
         <div className="min-h-0 flex-1 overflow-y-auto">
            {!loaded && !error ? (
               <EmptyStateLoading label={t('loading')} />
            ) : error ? (
               <div className="px-4 py-10 text-muted-foreground" role="alert">
                  {error}
               </div>
            ) : milestones.length === 0 ? (
               <EmptyGoals />
            ) : displayed.length === 0 ? (
               <div className="flex h-40 items-center justify-center px-4 text-center text-muted-foreground">
                  {t('noneMatch')}
               </div>
            ) : (
               displayed.map((goal) => (
                  <GoalLine
                     key={goal.id}
                     goal={goal}
                     selected={goal.id === selected}
                     onSelect={select}
                  />
               ))
            )}
         </div>
      </>
   );

   return (
      <SplitIndex
         selected={selected !== null}
         rail={rail}
         detail={
            selected ? (
               <>
                  <button
                     type="button"
                     onClick={() => select(null)}
                     className="flex min-h-11 shrink-0 items-center gap-2 border-b px-4 text-muted-foreground lg:hidden"
                  >
                     <ChevronLeft className="size-4" aria-hidden="true" />
                     {t('back')}
                  </button>
                  <div className="min-h-0 flex-1">
                     <GoalOverview key={selected} milestoneId={selected} />
                  </div>
               </>
            ) : null
         }
      />
   );
}
