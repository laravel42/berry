import { redirect } from 'next/navigation';

/** Members lives in Settings so the rail stays in settings mode. */
export default async function MembersRedirect({
   params,
}: {
   params: Promise<{ orgId: string }>;
}) {
   const { orgId } = await params;
   redirect(`/${orgId}/settings/members`);
}
