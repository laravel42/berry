import { redirect } from 'next/navigation';

/** Logs lives in Settings. Old links and pinned tabs land there. */
export default async function LogsRedirect({ params }: { params: Promise<{ orgId: string }> }) {
   const { orgId } = await params;
   redirect(`/${orgId}/settings/logs`);
}
