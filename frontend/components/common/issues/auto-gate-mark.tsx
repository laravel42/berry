'use client';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * AutoGate is on for this task. The same shield as the property control, without
 * the label: cards and rows only have room for the mark.
 */
export function AutoGateMark({ className }: { className?: string }) {
   const t = useTranslations('issueDetail.properties');

   return (
      <Tooltip>
         <TooltipTrigger asChild>
            <span
               className={cn('relative z-[1] inline-flex shrink-0 text-status-warning', className)}
               aria-label={t('autoGate')}
            >
               <ShieldCheck className="size-3.5" aria-hidden />
            </span>
         </TooltipTrigger>
         <TooltipContent side="top" className="max-w-72">
            {t('autoGateOn')}
         </TooltipContent>
      </Tooltip>
   );
}
