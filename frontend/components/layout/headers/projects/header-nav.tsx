'use client';

import { CreateProjectButton } from '@/components/common/projects/create-project-button';
import { useTranslations } from 'next-intl';
import { PageTitleBar } from '../page-title-bar';

export default function HeaderNav() {
   const t = useTranslations('projects.header');
   return (
      <PageTitleBar title={t('title')}>
         <CreateProjectButton />
      </PageTitleBar>
   );
}
