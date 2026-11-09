'use client';

import { LibraryBig, Plus } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { PageKpiHeader } from '@/components/common/page/page-parts';
import { Button } from '@/components/ui/button';

import HeaderOptions from './header-options';

export default function Header() {
   const t = useTranslations('agents.header');
   const { orgId } = useParams<{ orgId: string }>();

   return (
      <div className="flex w-full flex-col">
         <PageKpiHeader label={t('title')}>
            <Button
               variant="soft"
               className="shrink-0 border-0 !bg-status-warning/15 !text-status-warning shadow-xs hover:!bg-status-warning/25 hover:!text-status-warning"
               asChild
            >
               <Link href={`/${orgId}/agent-catalog`}>
                  <LibraryBig className="size-4" aria-hidden />
                  {t('catalog')}
               </Link>
            </Button>
            <Button
               variant="secondary"
               className="shrink-0 border-0 !bg-actor-agent/15 !text-actor-agent shadow-xs hover:!bg-actor-agent/25 hover:!text-actor-agent"
               asChild
            >
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
