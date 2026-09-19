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
            <div className="flex items-center gap-2">
               <Button
                  type="button"
                  size="xxs"
                  variant="outline"
                  disabled={saving}
                  aria-pressed={enabled}
                  onClick={() => change(!enabled)}
                  className={cn(
                     'flex min-w-0 items-center gap-1 px-2',
                     enabled
                        ? 'border-status-warning/40 bg-status-warning/10 text-status-warning hover:bg-status-warning/15 hover:text-status-warning'
                        : 'border-status-neutral/40 bg-status-neutral/10 text-status-neutral hover:bg-status-neutral/15 hover:text-status-neutral'
                  )}
               >
                  <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{t('autoGate')}</span>
               </Button>
            </div>
         </TooltipTrigger>
         <TooltipContent side="left" className="max-w-72">
            {enabled ? t('autoGateOn') : t('autoGateOff')}
         </TooltipContent>
      </Tooltip>
   );
}
