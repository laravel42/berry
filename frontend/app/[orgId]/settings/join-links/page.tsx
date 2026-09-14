import { redirect } from 'next/navigation';

/** Join links live on Members so there is one place to manage who can join. */
export default async function JoinLinksRedirect({
   params,
}: {
   params: Promise<{ orgId: string }>;
}) {
   const { orgId } = await params;
   redirect(`/${orgId}/settings/members`);
}
