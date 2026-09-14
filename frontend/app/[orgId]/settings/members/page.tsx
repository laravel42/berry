import Members from '@/components/common/members/members';
import Header from '@/components/layout/headers/settings/header';
import MainLayout from '@/components/layout/main-layout';

export default function Page() {
   return (
      <MainLayout header={<Header />} headersNumber={1}>
         <Members />
      </MainLayout>
   );
}
