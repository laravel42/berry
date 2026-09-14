'use client';

import { useParams } from 'next/navigation';

import SkillDetail from '@/components/common/skills/skill-detail';
import MainLayout from '@/components/layout/main-layout';
import SkillDetailHeader from '@/components/layout/headers/skills/detail-header';
import { canEditProduct } from '@/lib/workspace-role';
import { useSessionStore } from '@/store/session-store';

/**
 * One skill on its own page.
 *
 * Client navigation from the catalogue intercepts this address into a right
 * drawer. A reload or a link from elsewhere still lands here, so a bookmark
 * or a mention stays sensible.
 */
export default function SkillPage() {
   const { skillId } = useParams<{ orgId: string; skillId: string }>();
   const role = useSessionStore((state) => state.workspace?.role);

   return (
      <MainLayout header={<SkillDetailHeader skillId={skillId} />} headersNumber={1}>
         <SkillDetail skillId={skillId} canEdit={canEditProduct(role)} />
      </MainLayout>
   );
}
