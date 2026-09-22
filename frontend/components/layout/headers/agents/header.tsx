'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { PageStatement } from '@/components/common/page/page-parts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAgentsListStore } from '@/store/agents-list-store';
import { useAgentsStore } from '@/store/agents-store';

import HeaderOptions from './header-options';

export default function Header() {
   const t = useTranslations('agents.header');
   const { orgId } = useParams<{ orgId: string }>();
   const agents = useAgentsStore((state) => state.agents);
   const roster = useAgentsStore((state) => state.roster);
   const query = useAgentsListStore((state) => state.query);
   const setQuery = useAgentsListStore((state) => state.setQuery);

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
            <div className="flex items-center gap-2">
               <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('search')}
                  aria-label={t('search')}
                  className="h-[34px] w-48"
               />
               <Button size="xs" className="h-[34px] shrink-0" asChild>
                  <Link href={`/${orgId}/agents/new`}>
                     <Plus className="size-4" aria-hidden />
                     {t('newAgent')}
                  </Link>
               </Button>
            </div>
         </PageStatement>
         <HeaderOptions />
      </div>
   );
}
