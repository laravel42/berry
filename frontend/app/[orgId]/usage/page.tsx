import { redirect } from 'next/navigation';

/**
 * Usage lives in Settings. Old links and pinned tabs land there instead of
 * on a 404.
 */
export default async function UsageRedirect({
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
   redirect(`/${orgId}/settings/usage${suffix}`);
}
