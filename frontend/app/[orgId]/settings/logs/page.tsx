import PromptLogs from '@/components/common/logs/prompt-logs';
import Header from '@/components/layout/headers/settings/header';
import MainLayout from '@/components/layout/main-layout';

export default function LogsPage() {
   return (
      <MainLayout header={<Header />} headersNumber={1}>
         <PromptLogs />
      </MainLayout>
   );
}
