'use client';

import PromptLogs from '@/components/common/logs/prompt-logs';
import MainLayout from '@/components/layout/main-layout';

export default function LogsPage() {
   return (
      <MainLayout>
         <PromptLogs />
      </MainLayout>
   );
}
