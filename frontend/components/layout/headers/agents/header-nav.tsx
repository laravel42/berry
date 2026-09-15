'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { canEditProduct } from '@/lib/workspace-role';
import { useSessionStore } from '@/store/session-store';

/** The agents page title and the one way to add an agent from the list. */
export default function HeaderNav() {
   const t = useTranslations('agents.header');
   const { orgId } = useParams<{ orgId: string }>();
   const canEdit = canEditProduct(useSessionStore((state) => state.workspace?.role));

   return (
      <div className="flex w-full items-center justify-between gap-4 border-b px-6 py-3">
         <h1 className="min-w-0 truncate">{t('title')}</h1>
         {canEdit ? (
            <Button size="xs" variant="secondary" asChild>
               <Link href={`/${orgId}/agents/new`}>
                  <Plus className="size-4" />
                  {t('newAgent')}
               </Link>
            </Button>
         ) : null}
      </div>
   );
}
