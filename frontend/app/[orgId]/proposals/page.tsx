import { redirect } from 'next/navigation';

/** Proposals are work-proposal approvals; they surface in Inbox. */
export default async function ProposalsPage({ params }: { params: Promise<{ orgId: string }> }) {
   const { orgId } = await params;
   redirect(`/${orgId}/inbox`);
}
