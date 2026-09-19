import Goals from '@/components/common/goals/goals';
import Header from '@/components/layout/headers/goals/header';
import MainLayout from '@/components/layout/main-layout';

export default function GoalsPage() {
   return (
      <MainLayout header={<Header />} headersNumber={2}>
         <Goals />
      </MainLayout>
   );
}
