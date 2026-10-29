import { redirect } from 'next/navigation';

/** Integrations moved onto the rail; old Settings links land there. */
export default async function PluginsSettingsRedirect({
   params,
}: {
   params: Promise<{ orgId: string }>;
}) {
   const { orgId } = await params;
   redirect(`/${orgId}/integrations`);
}
