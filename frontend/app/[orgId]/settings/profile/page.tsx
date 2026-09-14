import { redirect } from 'next/navigation';

/** Profile settings were removed; the name field lives on Preferences. */
export default async function ProfileSettingsRedirect({
   params,
}: {
   params: Promise<{ orgId: string }>;
}) {
   const { orgId } = await params;
   redirect(`/${orgId}/settings/preferences`);
}
