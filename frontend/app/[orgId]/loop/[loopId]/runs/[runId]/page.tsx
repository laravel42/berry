import LoopRun from '@/components/common/loops/loop-run';

interface Props {
   params: Promise<{ orgId: string; loopId: string; runId: string }>;
}

export default async function LoopRunPage({ params }: Props) {
   const { loopId, runId } = await params;
   return <LoopRun loopId={loopId} runId={runId} />;
}
