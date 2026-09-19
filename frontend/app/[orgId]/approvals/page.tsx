import { redirect } from 'next/navigation';

/**
 * Approvals live in Inbox now. Old bookmarks and toasts that still say
 * `/approvals` land there, carrying any `?approval=` deep link through.
 */
export default async function ApprovalsPage({
   params,
   searchParams,
}: {
   params: Promise<{ orgId: string }>;
   searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
   const { orgId } = await params;
   const query = await searchParams;
   const approval = typeof query.approval === 'string' ? query.approval : undefined;
   const target = approval
      ? `/${orgId}/inbox?approval=${encodeURIComponent(approval)}`
      : `/${orgId}/inbox`;
   redirect(target);
}
