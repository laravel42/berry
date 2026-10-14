'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { PageStatement } from '@/components/common/page/page-parts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAgentsListStore } from '@/store/agents-list-store';

import HeaderOptions from './header-options';

export default function Header() {
   const t = useTranslations('agents.header');
   const { orgId } = useParams<{ orgId: string }>();
   const query = useAgentsListStore((state) => state.query);
   const setQuery = useAgentsListStore((state) => state.setQuery);

   return (
      <div className="flex w-full flex-col items-center">
         <PageStatement label={t('title')}>
            <div className="flex min-w-0 items-center gap-2">
               <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('search')}
                  aria-label={t('search')}
                  className="h-[34px] w-48 min-w-0"
               />
               <Button className="h-[34px] shrink-0 px-3" asChild>
                  <Link href={`/${orgId}/agents/new`}>{t('newAgent')}</Link>
               </Button>
            </div>
         </PageStatement>
         <HeaderOptions />
      </div>
   );
}
