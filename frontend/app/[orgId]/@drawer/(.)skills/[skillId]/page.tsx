'use client';

import { useParams } from 'next/navigation';

import SkillDetail from '@/components/common/skills/skill-detail';
import DetailDrawerShell from '@/components/layout/detail-drawer-shell';
import SkillDetailHeader from '@/components/layout/headers/skills/detail-header';
import { canEditProduct } from '@/lib/workspace-role';
import { useSessionStore } from '@/store/session-store';

export default function SkillDrawerPage() {
   const { skillId } = useParams<{ orgId: string; skillId: string }>();
   const role = useSessionStore((state) => state.workspace?.role);

   return (
      <DetailDrawerShell header={<SkillDetailHeader skillId={skillId} />}>
         <SkillDetail skillId={skillId} canEdit={canEditProduct(role)} />
      </DetailDrawerShell>
   );
}
