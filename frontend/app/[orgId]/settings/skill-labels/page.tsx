import MainLayout from '@/components/layout/main-layout';
import SkillLabelsSettings from '@/components/common/settings/skill-labels-settings';
import Header from '@/components/layout/headers/settings/header';

export default function Page() {
   return (
      <MainLayout header={<Header />} headersNumber={1}>
         <SkillLabelsSettings />
      </MainLayout>
   );
}
