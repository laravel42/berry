import { redirect } from 'next/navigation';

/** Runtimes moved into Settings; kept so old links and bookmarks still land. */
export default async function RuntimesPage({ params }: { params: Promise<{ orgId: string }> }) {
   const { orgId } = await params;
   redirect(`/${orgId}/settings/runtimes`);
}
