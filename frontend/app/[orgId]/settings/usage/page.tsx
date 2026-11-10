import { redirect } from 'next/navigation';

/** Usage moved onto the rail; old Settings links land there. */
export default async function UsageSettingsRedirect({
   params,
   searchParams,
}: {
   params: Promise<{ orgId: string }>;
   searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
   const { orgId } = await params;
   const search = await searchParams;
   const qs = new URLSearchParams();
   for (const [key, value] of Object.entries(search)) {
      if (typeof value === 'string') qs.set(key, value);
      else if (Array.isArray(value)) {
         for (const entry of value) qs.append(key, entry);
      }
   }
   const suffix = qs.size > 0 ? `?${qs.toString()}` : '';
   redirect(`/${orgId}/usage${suffix}`);
}
