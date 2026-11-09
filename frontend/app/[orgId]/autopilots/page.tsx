import { redirect } from 'next/navigation';

interface Props {
   params: Promise<{ orgId: string }>;
}

/** Autopilots are Loops now (ADR-0020). */
export default async function AutopilotsRedirect({ params }: Props) {
   const { orgId } = await params;
   redirect(`/${orgId}/loops`);
}
