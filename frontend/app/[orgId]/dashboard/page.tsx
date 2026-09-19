import { redirect } from 'next/navigation';

/**
 * The Dashboard merged into Usage, whose Overview tab now shows what it did
 * (live runs, who is working, tasks by status). Old links and pinned tabs land
 * there instead of on a 404.
 */
export default async function DashboardPage({ params }: { params: Promise<{ orgId: string }> }) {
   const { orgId } = await params;
   redirect(`/${orgId}/usage`);
}
