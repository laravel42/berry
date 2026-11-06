import { redirect } from 'next/navigation';

/** Workspace milestones list retired; stages live on each project. */
export default async function MilestonesRedirect({
   params,
}: {
   params: Promise<{ orgId: string }>;
}) {
   const { orgId } = await params;
   redirect(`/${orgId}/projects`);
}
