'use client';

import { getMilestone } from '@/lib/milestones';
import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Soft-nav into a milestone opens the project filtered to that stage. */
export default function MilestoneOverviewDrawerRedirect() {
   const { orgId, milestoneId } = useParams<{ orgId: string; milestoneId: string }>();
   const router = useRouter();

   useEffect(() => {
      let cancelled = false;
      void getMilestone(milestoneId)
         .then((milestone) => {
            if (cancelled) return;
            if (milestone.projectId) {
               router.replace(
                  `/${orgId}/project/${milestone.projectId}/overview?milestone=${milestone.id}`
               );
               return;
            }
            router.replace(`/${orgId}/projects`);
         })
         .catch(() => {
            if (!cancelled) router.replace(`/${orgId}/projects`);
         });
      return () => {
         cancelled = true;
      };
   }, [orgId, milestoneId, router]);

   return <p className="p-6 text-muted-foreground">Opening project…</p>;
}
