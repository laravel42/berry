'use client';

import { RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import LoopRunStateBadge from '@/components/common/loops/run-state-badge';
import { Button } from '@/components/ui/button';
import { describeAutopilotFailure, retryLoopRun, type WorkspaceLoopRun } from '@/lib/autopilots';
import { WORKSPACE_SLUG } from '@/lib/config';

interface Props {
   recent: WorkspaceLoopRun[];
   attention: WorkspaceLoopRun[];
   canRetry: boolean;
   onChanged: () => void;
}

/**
 * What the workspace's Loops have been doing, above the list: failures that
 * still need someone, and the latest runs. Absent when there is neither, so
 * a quiet workspace is not handed two empty boxes.
 */
export default function LoopActivity({ recent, attention, canRetry, onChanged }: Props) {
   const t = useTranslations('loops.activity');
   if (recent.length === 0 && attention.length === 0) return null;
   return (
      <div className="grid grid-cols-1 gap-3 border-b px-6 py-4 lg:grid-cols-2">
         {attention.length > 0 ? (
            <section
               aria-labelledby="loops-attention"
               className="min-w-0 rounded-[10px] bg-settings-group"
            >
               <h2
                  id="loops-attention"
                  data-heading="label"
                  className="flex items-center gap-2 px-4 pt-3 text-status-danger"
               >
                  {t('attention', { count: attention.length })}
               </h2>
               <ul className="py-1">
                  {attention.slice(0, 5).map((run) => (
                     <ActivityRow
                        key={run.id}
                        run={run}
                        canRetry={canRetry}
                        onChanged={onChanged}
                     />
                  ))}
               </ul>
            </section>
         ) : null}
         <section
            aria-labelledby="loops-recent"
            className={`min-w-0 rounded-[10px] bg-settings-group ${attention.length === 0 ? 'lg:col-span-2' : ''}`}
         >
            <h2 id="loops-recent" data-heading="label" className="px-4 pt-3 text-subtle-foreground">
               {t('recent')}
            </h2>
            <ul className="py-1">
               {recent.slice(0, attention.length > 0 ? 5 : 6).map((run) => (
                  <ActivityRow key={run.id} run={run} canRetry={false} onChanged={onChanged} />
               ))}
            </ul>
         </section>
      </div>
   );
}

function ActivityRow({
   run,
   canRetry,
   onChanged,
}: {
   run: WorkspaceLoopRun;
   canRetry: boolean;
   onChanged: () => void;
}) {
   const t = useTranslations('loops.activity');
   const format = useFormatter();
   const params = useParams<{ orgId?: string }>();
   const orgId = params?.orgId || WORKSPACE_SLUG;
   const [busy, setBusy] = useState(false);

   const retry = async () => {
      setBusy(true);
      try {
         await retryLoopRun(run.autopilotId, run.id);
         toast.success(t('retried'));
         onChanged();
      } catch (failure) {
         toast.error(describeAutopilotFailure(failure));
      } finally {
         setBusy(false);
      }
   };

   return (
      <li className="group flex min-w-0 items-center gap-2 px-4 py-1.5 hover:bg-settings-row-hover">
         <LoopRunStateBadge state={run.state} compact />
         <Link
            href={`/${orgId}/loop/${run.autopilotId}/runs/${run.id}`}
            className="flex min-w-0 flex-1 items-center gap-2 focus-visible:outline-none focus-visible:underline"
         >
            <span className="truncate font-medium">{run.autopilotName}</span>
            {run.issueIdentifier ? (
               <span className="shrink-0 text-muted-foreground">{run.issueIdentifier}</span>
            ) : null}
            {run.reasonCode ? (
               <span className="hidden truncate text-muted-foreground sm:inline">
                  {run.reasonMessage}
               </span>
            ) : null}
         </Link>
         <time className="shrink-0 text-muted-foreground" dateTime={run.createdAt}>
            {format.relativeTime(new Date(run.createdAt))}
         </time>
         {canRetry ? (
            <Button
               size="xs"
               variant="ghost"
               disabled={busy}
               onClick={() => void retry()}
               aria-label={t('retryNamed', { name: run.autopilotName })}
            >
               <RotateCcw className="size-3.5" aria-hidden />
               {t('retry')}
            </Button>
         ) : null}
      </li>
   );
}
