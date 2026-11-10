'use client';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Issue } from '@/data/issues';
import { describePatchFailure, setIssueAutoGate } from '@/lib/issues';
import { cn } from '@/lib/utils';
import { useIssuesStore } from '@/store/issues-store';
import { ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

/**
 * AutoGate for this one task, beside status and assignee.
 *
 * A plan sets it for every task it creates; this is where it is changed for
 * one of them afterwards — on for work you have stopped wanting to check, off
 * for the task you want to see before it counts. Saved at once and reverted if
 * the server refuses, so the control never shows a state the task is not in.
 *
 * The label itself is the control: pressed yellow when on, quiet neutral when
 * off — same idea as the plan chip, without a separate On/Off switch.
 */
export function AutoGateProperty({ issue }: { issue: Issue }) {
   const t = useTranslations('issueDetail.properties');
   const updateIssue = useIssuesStore((state) => state.updateIssue);
   const [saving, setSaving] = useState(false);
   const enabled = issue.autoGate ?? false;

   const change = (next: boolean) => {
      setSaving(true);
      updateIssue(issue.id, { autoGate: next });
      setIssueAutoGate(issue.identifier, next)
         .then(() => {
            if (next && issue.status.id === 'in-review') toast.success(t('autoGateReviewing'));
         })
         .catch((cause: unknown) => {
            updateIssue(issue.id, { autoGate: !next });
            toast.error(describePatchFailure(cause) || t('saveFailed'));
         })
         .finally(() => setSaving(false));
   };

   return (
      <Tooltip>
         <TooltipTrigger asChild>
            <Button
               type="button"
               size="sm"
               variant="ghost"
               disabled={saving}
               aria-pressed={enabled}
               onClick={() => change(!enabled)}
               className={cn(
                  'w-full min-w-0 justify-start gap-2 px-0',
                  enabled && 'text-status-warning hover:text-status-warning'
               )}
            >
               <span className="flex size-5 shrink-0 items-center justify-center p-0.5">
                  <ShieldCheck className="size-4" aria-hidden />
               </span>
               <span className="truncate">{t('autoGate')}</span>
            </Button>
         </TooltipTrigger>
         <TooltipContent side="left" className="max-w-72">
            {enabled ? t('autoGateOn') : t('autoGateOff')}
         </TooltipContent>
      </Tooltip>
   );
}
