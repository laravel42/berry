import PlansList from '@/components/common/plans/plans-list';
import Header from '@/components/layout/headers/plans/header';
import MainLayout from '@/components/layout/main-layout';

export default function PlansPage() {
   return (
      <MainLayout header={<Header />} headersNumber={2}>
         <PlansList />
      </MainLayout>
   );
}
