'use client';

import { BerryMark } from '@/components/brand/berry-mark';
import { Button } from '@/components/ui/button';
import { useCreateProjectStore } from '@/store/create-project-store';
import { useTranslations } from 'next-intl';

/** Full-page empty state when the workspace has no projects yet. */
export function EmptyProjects() {
   const t = useTranslations('projects.empty');
   const { openModal } = useCreateProjectStore();

   return (
      <div className="flex min-h-64 w-full items-center justify-center px-6 py-12">
         <div className="flex max-w-sm flex-col items-center text-center">
            <BerryMark size="lg" tone="neutral" state="hollow" label={t('mark')} />
            <h2 className="mt-5 font-display tracking-[-0.025em]">{t('title')}</h2>
            <p className="mt-2 leading-relaxed text-muted-foreground">{t('body')}</p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
               <Button className="h-10 px-5" onClick={() => openModal()}>
                  {t('cta')}
               </Button>
            </div>
         </div>
      </div>
   );
}
