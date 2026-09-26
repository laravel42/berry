'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { NewWorkspaceForm } from '@/components/common/workspaces/new-workspace-form';

/**
 * Create a workspace, as a page: where a direct link to `/workspaces/new`
 * lands. The workspace menu opens the same form in a dialog.
 */
export default function NewWorkspacePage() {
   const t = useTranslations('workspaceAdmin.newWorkspace');
   return (
      <div className="flex min-h-svh justify-center bg-background px-6 py-16">
         <div className="w-full max-w-xl">
            <h1 className="font-display tracking-[-0.025em]">{t('title')}</h1>
            <p className="mt-1 text-muted-foreground">{t('subtitle')}</p>
            <div className="mt-8">
               <NewWorkspaceForm
                  cancel={
                     <Link href="/onboarding" className="text-muted-foreground hover:underline">
                        {t('cancel')}
                     </Link>
                  }
               />
            </div>
         </div>
      </div>
   );
}
