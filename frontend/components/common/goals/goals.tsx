'use client';

import {
   EmptyState,
   EmptyStateActions,
   EmptyStateMark,
   EmptyStateText,
   EmptyStateTitle,
} from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { WORKSPACE_SLUG } from '@/lib/config';
import { useGoalsStore } from '@/store/goals-store';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import GoalLine from './goal-line';

function EmptyGoals() {
   const t = useTranslations('goals.empty');
   const params = useParams<{ orgId?: string }>();
   const orgId = params?.orgId || WORKSPACE_SLUG;
   return (
      <EmptyState icon={<EmptyStateMark label={t('mark')} />}>
         <EmptyStateTitle>{t('title')}</EmptyStateTitle>
         <EmptyStateText>{t('body')}</EmptyStateText>
         <EmptyStateActions>
            <Button asChild className="h-10 px-5">
               <Link href={`/${orgId}/projects`}>{t('cta')}</Link>
            </Button>
         </EmptyStateActions>
      </EmptyState>
   );
}

export default function Goals() {
   const t = useTranslations('goals.list');
   const goals = useGoalsStore((state) => state.goals);
   const loaded = useGoalsStore((state) => state.loaded);
   const error = useGoalsStore((state) => state.error);

   return (
      <div className="w-full">
         <div className="sticky top-0 z-10 flex items-center border-b bg-container px-6 py-1.5 text-muted-foreground">
            <div className="min-w-0 flex-1">{t('goal')}</div>
            <div className="w-27.5 shrink-0">{t('status')}</div>
            <div className="hidden w-40 shrink-0 sm:block">{t('progress')}</div>
            <div className="hidden w-36 shrink-0 md:block">{t('updated')}</div>
         </div>
         {!loaded && !error ? (
            <div className="px-6 py-10 text-muted-foreground">{t('loading')}</div>
         ) : error ? (
            <div className="px-6 py-10 text-muted-foreground" role="alert">
               {error}
            </div>
         ) : goals.length === 0 ? (
            <EmptyGoals />
         ) : (
            goals.map((goal) => <GoalLine key={goal.id} goal={goal} />)
         )}
      </div>
   );
}
