'use client';

import { CreateProjectButton } from '@/components/common/projects/create-project-button';
import { useTranslations } from 'next-intl';

export default function HeaderNav() {
   const t = useTranslations('projects.header');
   return (
      <div className="flex w-full items-center justify-between gap-4 border-b px-6 py-3">
         <h1 className="min-w-0 truncate">{t('title')}</h1>
         <CreateProjectButton />
      </div>
   );
}
