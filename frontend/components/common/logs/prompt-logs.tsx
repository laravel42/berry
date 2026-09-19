'use client';

import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { EmptyState, EmptyStateMark, EmptyStateText } from '@/components/common/empty-state';
import { readableModelName } from '@/components/common/agents/model-name';
import { Button } from '@/components/ui/button';
import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
} from '@/components/ui/select';
import {
   formatMs,
   LOG_STATUSES,
   listPromptLogPurposes,
   listPromptLogs,
   LOG_KINDS,
   type LogKind,
   type LogStatus,
   type PromptLogFilter,
   type PromptLogSummary,
} from '@/lib/logs';
import { timeAgo } from '@/lib/time-ago';
import { formatCost, formatTokens } from '@/lib/usage';
import { useSessionStore } from '@/store/session-store';

import { LogStatusBadge, PromptLogSheet } from './prompt-log-sheet';

const ANY = 'any';

/**
 * The Logs page: every model call Berry made and every agent run, newest
 * first, filterable by kind, outcome, purpose and whether the call asked for
 * structured output. A row opens the whole exchange in a sheet: for a model
 * call its system prompt, earlier turns, prompt, response schema and answer;
 * for an agent run what its loop started from, and its events.
 */
export default function PromptLogs() {
   const t = useTranslations('areas.logs');
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? null);
   const [filter, setFilter] = useState<PromptLogFilter>({
      kind: null,
      status: null,
      purpose: null,
      structured: null,
   });
   const [purposes, setPurposes] = useState<string[]>([]);
   const [rows, setRows] = useState<PromptLogSummary[]>([]);
   const [cursor, setCursor] = useState<string | null>(null);
   const [loading, setLoading] = useState(false);
   const [error, setError] = useState(false);
   const [tick, setTick] = useState(0);
   const [openId, setOpenId] = useState<string | null>(null);

   useEffect(() => {
      if (!workspaceId) return;
      listPromptLogPurposes(workspaceId)
         .then(setPurposes)
         .catch(() => setPurposes([]));
   }, [workspaceId, tick]);

   useEffect(() => {
      if (!workspaceId) return;
      let cancelled = false;
      setLoading(true);
      listPromptLogs(workspaceId, filter)
         .then((page) => {
            if (cancelled) return;
            setRows(page.nodes);
            setCursor(page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null);
            setError(false);
         })
         .catch(() => !cancelled && setError(true))
         .finally(() => !cancelled && setLoading(false));
      return () => {
         cancelled = true;
      };
   }, [workspaceId, filter, tick]);

   const loadMore = useCallback(() => {
      if (!workspaceId || !cursor) return;
      setLoading(true);
      listPromptLogs(workspaceId, filter, cursor)
         .then((page) => {
            setRows((current) => [...current, ...page.nodes]);
            setCursor(page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null);
         })
         .catch(() => setError(true))
         .finally(() => setLoading(false));
   }, [workspaceId, filter, cursor]);

   const filtered =
      filter.kind !== null ||
      filter.status !== null ||
      filter.purpose !== null ||
      filter.structured !== null;

   return (
      <div className="flex min-h-0 flex-1 flex-col">
         <div className="flex flex-wrap items-center gap-2 border-b px-6 py-2">
            <Select
               value={filter.kind ?? ANY}
               onValueChange={(value) =>
                  setFilter((f) => ({ ...f, kind: value === ANY ? null : (value as LogKind) }))
               }
            >
               <SelectTrigger className="h-8 w-36" aria-label={t('filters.kind')}>
                  <SelectValue />
               </SelectTrigger>
               <SelectContent>
                  <SelectItem value={ANY}>{t('filters.anyKind')}</SelectItem>
                  {LOG_KINDS.map((kind) => (
                     <SelectItem key={kind} value={kind}>
                        {t(`kind.${kind}`)}
                     </SelectItem>
                  ))}
               </SelectContent>
            </Select>
            <Select
               value={filter.status ?? ANY}
               onValueChange={(value) =>
                  setFilter((f) => ({ ...f, status: value === ANY ? null : (value as LogStatus) }))
               }
            >
               <SelectTrigger className="h-8 w-40" aria-label={t('filters.status')}>
                  <SelectValue />
               </SelectTrigger>
               <SelectContent>
                  <SelectItem value={ANY}>{t('filters.anyStatus')}</SelectItem>
                  {LOG_STATUSES.map((status) => (
                     <SelectItem key={status} value={status}>
                        {t(`status.${status}`)}
                     </SelectItem>
                  ))}
               </SelectContent>
            </Select>
            <Select
               value={filter.purpose ?? ANY}
               onValueChange={(value) =>
                  setFilter((f) => ({ ...f, purpose: value === ANY ? null : value }))
               }
            >
               <SelectTrigger className="h-8 w-48" aria-label={t('filters.purpose')}>
                  <SelectValue />
               </SelectTrigger>
               <SelectContent>
                  <SelectItem value={ANY}>{t('filters.anyPurpose')}</SelectItem>
                  {purposes.map((purpose) => (
                     <SelectItem key={purpose} value={purpose}>
                        {purpose}
                     </SelectItem>
                  ))}
               </SelectContent>
            </Select>
            <Select
               value={filter.structured === null ? ANY : filter.structured ? 'structured' : 'text'}
               onValueChange={(value) =>
                  setFilter((f) => ({
                     ...f,
                     structured: value === ANY ? null : value === 'structured',
                  }))
               }
            >
               <SelectTrigger className="h-8 w-40" aria-label={t('filters.output')}>
                  <SelectValue />
               </SelectTrigger>
               <SelectContent>
                  <SelectItem value={ANY}>{t('filters.anyOutput')}</SelectItem>
                  <SelectItem value="structured">{t('filters.structured')}</SelectItem>
                  <SelectItem value="text">{t('filters.text')}</SelectItem>
               </SelectContent>
            </Select>
            <Button
               variant="ghost"
               size="sm"
               className="ml-auto"
               onClick={() => setTick((value) => value + 1)}
               disabled={loading}
            >
               <RefreshCw className={loading ? 'animate-spin' : undefined} />
               {t('refresh')}
            </Button>
         </div>

         <div className="min-h-0 flex-1 overflow-auto">
            {error && rows.length === 0 ? (
               <EmptyState icon={<EmptyStateMark label={t('loadFailed')} state="crossed" />}>
                  <EmptyStateText>{t('loadFailed')}</EmptyStateText>
               </EmptyState>
            ) : rows.length === 0 ? (
               <EmptyState icon={<EmptyStateMark label={t('title')} />}>
                  <EmptyStateText>
                     {loading ? t('loading') : filtered ? t('noMatch') : t('empty')}
                  </EmptyStateText>
               </EmptyState>
            ) : (
               <table className="w-full">
                  <thead className="sticky top-0 z-10 bg-background text-left text-muted-foreground">
                     <tr className="border-b">
                        <th className="px-6 py-2 font-normal">{t('columns.when')}</th>
                        <th className="px-3 py-2 font-normal">{t('columns.purpose')}</th>
                        <th className="w-full px-3 py-2 font-normal">{t('columns.prompt')}</th>
                        <th className="px-3 py-2 font-normal">{t('columns.model')}</th>
                        <th className="px-3 py-2 text-right font-normal">{t('columns.tokens')}</th>
                        <th className="px-3 py-2 text-right font-normal">{t('columns.cost')}</th>
                        <th className="px-3 py-2 text-right font-normal">
                           {t('columns.duration')}
                        </th>
                        <th className="px-6 py-2 font-normal">{t('columns.status')}</th>
                     </tr>
                  </thead>
                  <tbody>
                     {rows.map((row) => (
                        <tr
                           key={row.id}
                           tabIndex={0}
                           onClick={() => setOpenId(row.id)}
                           onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                 event.preventDefault();
                                 setOpenId(row.id);
                              }
                           }}
                           className="cursor-pointer border-b hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
                        >
                           <td
                              className="whitespace-nowrap px-6 py-2 text-muted-foreground"
                              title={row.createdAt}
                           >
                              {timeAgo(row.createdAt)}
                           </td>
                           <td className="whitespace-nowrap px-3 py-2">
                              <span className="inline-flex items-center gap-1.5">
                                 {row.purpose}
                                 {row.structured && (
                                    <span className="rounded border px-1 font-mono text-muted-foreground">
                                       {t('structuredBadge')}
                                    </span>
                                 )}
                              </span>
                              {row.kind === 'agent' && (row.agentName || row.issueIdentifier) ? (
                                 <span className="block text-muted-foreground">
                                    {[row.agentName, row.issueIdentifier]
                                       .filter(Boolean)
                                       .join(' · ')}
                                 </span>
                              ) : null}
                           </td>
                           <td className="max-w-0 px-3 py-2">
                              <span className="block truncate text-muted-foreground">
                                 {row.promptPreview}
                              </span>
                           </td>
                           <td
                              className="max-w-[16rem] truncate whitespace-nowrap px-3 py-2 text-muted-foreground"
                              title={row.model ?? undefined}
                           >
                              {row.model ? readableModelName(row.model) : '—'}
                           </td>
                           <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                              {formatTokens(row.inputTokens + row.outputTokens)}
                           </td>
                           <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                              {row.costMicros === null ? '—' : formatCost(row.costMicros)}
                           </td>
                           <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                              {row.durationMs === null ? '—' : formatMs(row.durationMs)}
                           </td>
                           <td className="whitespace-nowrap px-6 py-2">
                              <LogStatusBadge status={row.status} />
                           </td>
                        </tr>
                     ))}
                  </tbody>
               </table>
            )}
            {cursor && (
               <div className="flex justify-center py-4">
                  <Button variant="outline" size="sm" onClick={loadMore} disabled={loading}>
                     {t('loadMore')}
                  </Button>
               </div>
            )}
         </div>

         <PromptLogSheet workspaceId={workspaceId} runId={openId} onClose={() => setOpenId(null)} />
      </div>
   );
}
