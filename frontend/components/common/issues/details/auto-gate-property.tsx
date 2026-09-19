'use client';

import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Issue } from '@/data/issues';
import { describePatchFailure, setIssueAutoGate } from '@/lib/issues';
import { cn } from '@/lib/utils';
import { useIssuesStore } from '@/store/issues-store';
import { ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { toast } from 'sonner';

/**
 * AutoGate for this one task, beside status and assignee.
 *
 * A plan sets it for every task it creates; this is where it is changed for
 * one of them afterwards — on for work you have stopped wanting to check, off
 * for the task you want to see before it counts. Saved at once and reverted if
 * the server refuses, so the switch never shows a state the task is not in.
 */
export function AutoGateProperty({ issue }: { issue: Issue }) {
   const t = useTranslations('issueDetail.properties');
   const updateIssue = useIssuesStore((state) => state.updateIssue);
   const [saving, setSaving] = useState(false);
   const id = useId();
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
               <div className="flex size-7 shrink-0 items-center justify-center">
                  <ShieldCheck
                     className={cn(
                        'size-4',
                        enabled ? 'text-status-warning' : 'text-muted-foreground'
                     )}
                     aria-hidden
                  />
               </div>
               <label htmlFor={id} className="min-w-0 flex-1 truncate">
                  {t('autoGate')}
               </label>
               <Switch
                  id={id}
                  checked={enabled}
                  disabled={saving}
                  onCheckedChange={change}
                  className="mr-1"
               />
            </div>
         </TooltipTrigger>
         <TooltipContent side="left" className="max-w-72">
            {enabled ? t('autoGateOn') : t('autoGateOff')}
         </TooltipContent>
      </Tooltip>
   );
}
