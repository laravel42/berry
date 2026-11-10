import { redirect } from 'next/navigation';

/** Legacy Goals list URL. */
export default async function GoalsRedirect({ params }: { params: Promise<{ orgId: string }> }) {
   const { orgId } = await params;
   redirect(`/${orgId}/projects`);
}
