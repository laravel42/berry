'use client';

import { Suspense } from 'react';
import { useTranslations } from 'next-intl';

import { NewAgentForm } from '@/app/[orgId]/agents/new/page';
import DetailDrawerShell from '@/components/layout/detail-drawer-shell';
import { PageTitleBar } from '@/components/layout/headers/page-title-bar';

/**
 * `/agents/new` is not an agent. A static segment beats `[agentId]`, so this
 * file keeps "new" from being fetched as one. The list stays where it is and
 * the create form opens in the drawer over it.
 */
export default function NewAgentDrawerPage() {
   const t = useTranslations('agentsChat.create');

   return (
      <DetailDrawerShell header={<PageTitleBar title={t('title')} />}>
         <div className="flex min-h-0 flex-1 flex-col">
            <Suspense fallback={null}>
               <NewAgentForm />
            </Suspense>
         </div>
      </DetailDrawerShell>
   );
}
