'use client';

import { Button } from '@/components/ui/button';
import { reviewGateRunFor, type AutoReview } from '@/lib/runs';
import { useIssueRuns } from '@/store/issue-runs-store';
import { useRunConsoleStore } from '@/store/run-console-store';
import { SquareTerminal } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * Opens the task console on the AutoGate review completion that produced
 * this verdict. Older reviews have no run on the task and stay without a
 * button — the console only lists completions queued after they started
 * sitting on the issue.
 */
export function ReviewTranscriptButton({
   issueId,
   review,
   compact = false,
}: {
   issueId: string;
   review: Pick<AutoReview, 'startedAt' | 'decidedAt'>;
   compact?: boolean;
}) {
   const t = useTranslations('issueDetail.reviews');
   const { runs } = useIssueRuns(issueId);
   const show = useRunConsoleStore((state) => state.show);
   const run = reviewGateRunFor(runs, review);
   if (!run) return null;
   const label = t('openTranscript');
   return (
      <Button
         type="button"
         variant="ghost"
         size="xxs"
         className="ml-auto h-6 shrink-0 px-1.5 text-muted-foreground hover:text-foreground"
         title={label}
         aria-label={label}
         onClick={() => show(issueId, run.id)}
      >
         <SquareTerminal className="size-3.5" aria-hidden />
         {compact ? null : label}
      </Button>
   );
}
