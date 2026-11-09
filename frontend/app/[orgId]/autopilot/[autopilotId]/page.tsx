import { redirect } from 'next/navigation';

interface Props {
   params: Promise<{ orgId: string; autopilotId: string }>;
}

/** Autopilots are Loops now (ADR-0020); an old link lands on the same Loop. */
export default async function AutopilotRedirect({ params }: Props) {
   const { orgId, autopilotId } = await params;
   redirect(`/${orgId}/loop/${encodeURIComponent(autopilotId)}`);
}
