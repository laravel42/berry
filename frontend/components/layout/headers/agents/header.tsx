'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { PageStatement } from '@/components/common/page/page-parts';
import { Button } from '@/components/ui/button';
import { useAgentsStore } from '@/store/agents-store';

import HeaderOptions from './header-options';

export default function Header() {
   const t = useTranslations('agents.header');
   const { orgId } = useParams<{ orgId: string }>();
   const agents = useAgentsStore((state) => state.agents);
   const roster = useAgentsStore((state) => state.roster);

   // The roster says who is running something right now. It is best effort, so
   // without it the page falls back to how many agents there are; with neither
   // it says nothing rather than claim zero.
   const knowsWork = roster.size > 0;
   const working = agents.filter((agent) => (roster.get(agent.id)?.running ?? 0) > 0).length;
   const figure = knowsWork ? working : agents.length > 0 ? agents.length : undefined;

   return (
      <div className="flex w-full flex-col items-center">
         <PageStatement
            label={t('title')}
            figure={figure}
            line={
               knowsWork
                  ? t('statement.line', { count: working })
                  : t('statement.lineAll', { count: agents.length })
            }
            sub={t('statement.sub')}
         >
            <Button
               size="xs"
               className="ml-auto h-[34px] w-[42px] shrink-0 px-0"
               aria-label={t('newAgent')}
               title={t('newAgent')}
               asChild
            >
               <Link href={`/${orgId}/agents/new`}>
                  <Plus className="size-4" />
               </Link>
            </Button>
         </PageStatement>
         <HeaderOptions />
      </div>
   );
}
