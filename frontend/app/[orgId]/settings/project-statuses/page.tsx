import { redirect } from 'next/navigation';

/** Task statuses are not a workspace setting. */
export default async function ProjectStatusesRedirect({
   params,
}: {
   params: Promise<{ orgId: string }>;
}) {
   const { orgId } = await params;
   redirect(`/${orgId}/settings/preferences`);
}
