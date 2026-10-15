'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { PageKpiHeader } from '@/components/common/page/page-parts';
import { Button } from '@/components/ui/button';
import { Input, searchFieldClass } from '@/components/ui/input';
import { useAgentsListStore } from '@/store/agents-list-store';

import HeaderOptions from './header-options';

export default function Header() {
   const t = useTranslations('agents.header');
   const { orgId } = useParams<{ orgId: string }>();
   const query = useAgentsListStore((state) => state.query);
   const setQuery = useAgentsListStore((state) => state.setQuery);

   return (
      <div className="flex w-full flex-col">
         <PageKpiHeader label={t('title')}>
            <Input
               className={`${searchFieldClass} w-64 max-sm:w-40`}
               value={query}
               onChange={(event) => setQuery(event.target.value)}
               placeholder={t('search')}
               aria-label={t('search')}
            />
            <Button className="shrink-0" asChild>
               <Link href={`/${orgId}/agents/new`}>
                  <Plus className="size-4" aria-hidden />
                  {t('newAgent')}
               </Link>
            </Button>
         </PageKpiHeader>
         <HeaderOptions />
      </div>
   );
}
