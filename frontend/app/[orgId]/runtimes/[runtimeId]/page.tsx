import { redirect } from 'next/navigation';

/** Runtimes moved into Settings; kept so old links and bookmarks still land. */
export default async function RuntimePage({
   params,
}: {
   params: Promise<{ orgId: string; runtimeId: string }>;
}) {
   const { orgId, runtimeId } = await params;
   redirect(`/${orgId}/settings/runtimes/${encodeURIComponent(runtimeId)}`);
}
