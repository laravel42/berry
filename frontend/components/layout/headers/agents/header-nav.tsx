'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { canEditProduct } from '@/lib/workspace-role';
import { useSessionStore } from '@/store/session-store';
import { PageTitleBar } from '../page-title-bar';

/** The agents page title and the one way to add an agent from the list. */
export default function HeaderNav() {
   const t = useTranslations('agents.header');
   const { orgId } = useParams<{ orgId: string }>();
   const canEdit = canEditProduct(useSessionStore((state) => state.workspace?.role));

   return (
      <PageTitleBar title={t('title')}>
         {canEdit ? (
            <Button size="xs" asChild>
               <Link href={`/${orgId}/agents/new`}>
                  <Plus className="size-4" />
                  {t('newAgent')}
               </Link>
            </Button>
         ) : null}
      </PageTitleBar>
   );
}
