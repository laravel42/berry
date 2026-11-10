import { redirect } from 'next/navigation';

/**
 * The Dashboard merged into Usage. Old links and pinned tabs land there
 * instead of on a 404.
 */
export default async function DashboardPage({ params }: { params: Promise<{ orgId: string }> }) {
   const { orgId } = await params;
   redirect(`/${orgId}/usage`);
}
