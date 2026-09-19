'use client';

import { useTranslations } from 'next-intl';

import PromptLogs from '@/components/common/logs/prompt-logs';
import MainLayout from '@/components/layout/main-layout';

export default function LogsPage() {
   const t = useTranslations('areas.logs');
   const header = (
      <div className="flex w-full flex-col gap-0.5 border-b px-6 py-3">
         <h1 className="min-w-0 truncate">{t('title')}</h1>
         <p className="text-muted-foreground">{t('subtitle')}</p>
      </div>
   );
   return (
      <MainLayout header={header}>
         <PromptLogs />
      </MainLayout>
   );
}
