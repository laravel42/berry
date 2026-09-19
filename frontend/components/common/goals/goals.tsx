'use client';

import {
   EmptyState,
   EmptyStateLoading,
   EmptyStateMark,
   EmptyStateText,
   EmptyStateTitle,
} from '@/components/common/empty-state';
import type { Goal } from '@/lib/goals';
import { useGoalsListStore } from '@/store/goals-list-store';
import { useGoalsStore } from '@/store/goals-store';
import { useProjectsStore } from '@/store/projects-store';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import GoalLine from './goal-line';

function isOpenGoal(status: string): boolean {
   return status !== 'completed';
}

function EmptyGoals() {
   const t = useTranslations('goals.empty');
   return (
      <EmptyState icon={<EmptyStateMark label={t('mark')} />}>
         <EmptyStateTitle>{t('title')}</EmptyStateTitle>
         <EmptyStateText>{t('body')}</EmptyStateText>
      </EmptyState>
   );
}

function applySearch(list: Goal[], query: string, projectNameById: Map<string, string>): Goal[] {
   const term = query.trim().toLowerCase();
   if (!term) return list;
   return list.filter((goal) => {
      if (goal.title.toLowerCase().includes(term)) return true;
      if ((goal.description ?? '').toLowerCase().includes(term)) return true;
      const projectName = goal.projectId ? projectNameById.get(goal.projectId) : undefined;
      return (projectName ?? '').toLowerCase().includes(term);
   });
}

export default function Goals() {
   const t = useTranslations('goals.list');
   const goals = useGoalsStore((state) => state.goals);
   const loaded = useGoalsStore((state) => state.loaded);
   const error = useGoalsStore((state) => state.error);
   const projects = useProjectsStore((state) => state.projects);
   const scope = useGoalsListStore((state) => state.scope);
   const query = useGoalsListStore((state) => state.query);

   const projectNameById = useMemo(() => {
      const map = new Map<string, string>();
      for (const project of projects) map.set(project.id, project.name);
      return map;
   }, [projects]);

   const scoped = useMemo(
      () => (scope === 'open' ? goals.filter((goal) => isOpenGoal(goal.status)) : goals),
      [goals, scope]
   );

   const displayed = useMemo(
      () => applySearch(scoped, query, projectNameById),
      [scoped, query, projectNameById]
   );

   return (
      <div className="flex h-full min-h-0 w-full flex-col">
         {!loaded && !error ? (
            <EmptyStateLoading label={t('loading')} />
         ) : error ? (
            <div className="px-6 py-10 text-muted-foreground" role="alert">
               {error}
            </div>
         ) : goals.length === 0 ? (
            <EmptyGoals />
         ) : (
            <>
               <div className="sticky top-0 z-10 flex items-center border-b bg-container px-4 py-[6px] text-muted-foreground">
                  <div className="min-w-0 flex-1">{t('goal')}</div>
                  <div className="w-27.5 shrink-0">{t('status')}</div>
                  <div className="hidden w-40 shrink-0 sm:block">{t('progress')}</div>
                  <div className="hidden w-36 shrink-0 md:block">{t('updated')}</div>
               </div>
               {scoped.length === 0 ? (
                  <div className="flex h-40 items-center justify-center text-muted-foreground">
                     {scope === 'open' ? t('noneOpen') : t('noneMatch')}
                  </div>
               ) : displayed.length === 0 ? (
                  <div className="flex h-40 items-center justify-center text-muted-foreground">
                     {t('noneMatch')}
                  </div>
               ) : (
                  displayed.map((goal) => <GoalLine key={goal.id} goal={goal} />)
               )}
            </>
         )}
      </div>
   );
}
