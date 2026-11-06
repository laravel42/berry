import { redirect } from 'next/navigation';

/** Legacy Goals overview URL. */
export default async function GoalOverviewRedirect({
   params,
}: {
   params: Promise<{ orgId: string; goalId: string }>;
}) {
   const { orgId, goalId } = await params;
   redirect(`/${orgId}/milestone/${goalId}`);
}
