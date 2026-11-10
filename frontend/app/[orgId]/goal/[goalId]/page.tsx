import { redirect } from 'next/navigation';

/** Legacy Goals URL; milestones now open via the project. */
export default async function GoalRedirect({
   params,
}: {
   params: Promise<{ orgId: string; goalId: string }>;
}) {
   const { orgId, goalId } = await params;
   redirect(`/${orgId}/milestone/${goalId}`);
}
