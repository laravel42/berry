'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import NewAgentManual from '@/components/common/agents/new-agent-manual';
import { PageTitleBar } from '@/components/layout/headers/page-title-bar';
import MainLayout from '@/components/layout/main-layout';

/**
 * A new agent starts on the same fields as editing one, left blank.
 * Describing one is still `/agents/new/ai`, a session that can be left and resumed.
 */
export function NewAgentForm() {
   const searchParams = useSearchParams();
   const duplicateId = searchParams?.get('duplicate') ?? null;
   return <NewAgentManual duplicateId={duplicateId} />;
}

export default function NewAgentPage() {
   const t = useTranslations('agentsChat.create');

   const header = <PageTitleBar title={t('title')} />;

   return (
      <MainLayout header={header}>
         <div className="mx-auto w-full max-w-5xl px-6 py-6">
            {/* `?duplicate=` is a query parameter, which Next requires to sit
                under a Suspense boundary. */}
            <Suspense fallback={null}>
               <NewAgentForm />
            </Suspense>
         </div>
      </MainLayout>
   );
}
