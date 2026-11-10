'use client';

import { RotateCcw, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import LoopRunStateBadge from '@/components/common/loops/run-state-badge';
import { Button } from '@/components/ui/button';
import { describeAutopilotFailure, retryLoopRun, type WorkspaceLoopRun } from '@/lib/autopilots';
import { WORKSPACE_SLUG } from '@/lib/config';

function useRunHref() {
   const params = useParams<{ orgId?: string }>();
   const orgId = params?.orgId || WORKSPACE_SLUG;
   return (run: WorkspaceLoopRun) => `/${orgId}/loop/${run.autopilotId}/runs/${run.id}`;
}

/**
 * Failed runs that still need someone, above the Loops. Absent when there are
 * none: a strip that says "all good" is a strip people learn to skip.
 */
export function LoopAttention({
   runs,
   canRetry,
   onChanged,
}: {
   runs: WorkspaceLoopRun[];
   canRetry: boolean;
   onChanged: () => void;
}) {
   const t = useTranslations('loops.activity');
   const format = useFormatter();
   const href = useRunHref();
   if (runs.length === 0) return null;

   return (
      <section
         aria-labelledby="loops-attention"
         className="overflow-hidden rounded-xl border border-status-danger/30 bg-status-danger/[0.06]"
      >
         <h2
            id="loops-attention"
            className="flex items-center gap-2 px-4 pt-3 pb-1 font-medium text-status-danger"
         >
            <TriangleAlert className="size-4" aria-hidden />
            {t('attention', { count: runs.length })}
         </h2>
         <ul className="pb-1.5">
            {runs.slice(0, 5).map((run) => (
               <li
                  key={run.id}
                  className="flex min-w-0 items-center gap-2.5 px-4 py-1.5 hover:bg-status-danger/[0.06]"
               >
                  <LoopRunStateBadge state={run.state} compact />
                  <Link
                     href={href(run)}
                     className="flex min-w-0 flex-1 items-baseline gap-2 focus-visible:underline focus-visible:outline-none"
                  >
                     <span className="max-w-[45%] shrink-0 truncate font-medium">
                        {run.autopilotName}
                     </span>
                     {run.reasonMessage ? (
                        <span className="min-w-0 truncate text-muted-foreground">
                           {run.reasonMessage}
                        </span>
                     ) : null}
                  </Link>
                  <time className="shrink-0 text-subtle-foreground" dateTime={run.createdAt}>
                     {format.relativeTime(new Date(run.createdAt))}
                  </time>
                  {canRetry ? <RetryButton run={run} onChanged={onChanged} /> : null}
               </li>
            ))}
         </ul>
      </section>
   );
}

function RetryButton({ run, onChanged }: { run: WorkspaceLoopRun; onChanged: () => void }) {
   const t = useTranslations('loops.activity');
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
      <Button
         size="xs"
         variant="secondary"
         disabled={busy}
         onClick={() => void retry()}
         aria-label={t('retryNamed', { name: run.autopilotName })}
      >
         <RotateCcw className="size-3.5" aria-hidden />
         {t('retry')}
      </Button>
   );
}

/** The latest runs across every Loop, newest first, as a short timeline. */
export function RecentLoopRuns({ runs }: { runs: WorkspaceLoopRun[] }) {
   const t = useTranslations('loops.activity');
   const format = useFormatter();
   const href = useRunHref();

   return (
      <section aria-labelledby="loops-recent" className="flex min-w-0 flex-col">
         <h2 id="loops-recent" data-heading="label" className="mb-3 text-subtle-foreground">
            {t('recent')}
         </h2>
         {runs.length === 0 ? (
            <p className="text-subtle-foreground">{t('noneYet')}</p>
         ) : (
            <ol className="relative flex flex-col">
               {runs.slice(0, 12).map((run, index, shown) => (
                  <li key={run.id} className="relative flex min-w-0 gap-3 pb-4 last:pb-0">
                     {index < shown.length - 1 ? (
                        <span
                           className="absolute top-5 bottom-0 left-[7px] w-px bg-border"
                           aria-hidden
                        />
                     ) : null}
                     <LoopRunStateBadge state={run.state} compact className="relative mt-0.5" />
                     <Link
                        href={href(run)}
                        className="flex min-w-0 flex-1 flex-col gap-0.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                     >
                        <span className="truncate font-medium hover:underline">
                           {run.autopilotName}
                        </span>
                        <span className="flex min-w-0 items-center gap-1.5 text-subtle-foreground">
                           <time dateTime={run.createdAt}>
                              {format.relativeTime(new Date(run.createdAt))}
                           </time>
                           {run.issueIdentifier ? (
                              <>
                                 <span aria-hidden>·</span>
                                 <span className="truncate">{run.issueIdentifier}</span>
                              </>
                           ) : null}
                        </span>
                     </Link>
                  </li>
               ))}
            </ol>
         )}
      </section>
   );
}
