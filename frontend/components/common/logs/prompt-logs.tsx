'use client';

import { Check, Copy, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { EmptyState, EmptyStateMark, EmptyStateText } from '@/components/common/empty-state';
import { readableModelName } from '@/components/common/agents/model-name';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
} from '@/components/ui/select';
import {
   Sheet,
   SheetContent,
   SheetDescription,
   SheetHeader,
   SheetTitle,
} from '@/components/ui/sheet';
import type { StatusLook } from '@/lib/catalog';
import {
   formatMs,
   getPromptLog,
   LOG_STATUSES,
   listPromptLogPurposes,
   listPromptLogs,
   LOG_KINDS,
   type LogKind,
   type LogStatus,
   type PromptLogDetail,
   type PromptLogFilter,
   type PromptLogSummary,
} from '@/lib/logs';
import { timeAgo } from '@/lib/time-ago';
import { formatCost, formatTokens } from '@/lib/usage';
import { useSessionStore } from '@/store/session-store';

import {
   EventStreamView,
   RequestHeadersView,
   RequestPayloadView,
   ResponseView,
} from './prompt-log-exchange';

const ANY = 'any';

/** The sheet's tabs: the prompt as Berry reads it, then the call as it crossed the wire. */
const DETAIL_TABS = ['prompt', 'headers', 'payload', 'events', 'response'] as const;
type DetailTab = (typeof DETAIL_TABS)[number];

const STATUS_TONE: Record<string, Pick<StatusLook, 'tone' | 'state' | 'pulse'>> = {
   queued: { tone: 'neutral', state: 'hollow' },
   running: { tone: 'working', state: 'solid', pulse: true },
   succeeded: { tone: 'complete', state: 'solid' },
   failed: { tone: 'danger', state: 'crossed' },
   cancelled: { tone: 'neutral', state: 'crossed' },
};

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

function LogStatusBadge({ status }: { status: string }) {
   const t = useTranslations('areas.logs.status');
   const tone = STATUS_TONE[status] ?? { tone: 'neutral', state: 'hollow' };
   const label = (LOG_STATUSES as readonly string[]).includes(status)
      ? t(status as LogStatus)
      : status;
   return <StatusBadge look={{ label, ...tone }} />;
}

function PromptLogSheet({
   workspaceId,
   runId,
   onClose,
}: {
   workspaceId: string | null;
   runId: string | null;
   onClose: () => void;
}) {
   const t = useTranslations('areas.logs.detail');
   const tCols = useTranslations('areas.logs.columns');
   const [detail, setDetail] = useState<PromptLogDetail | null>(null);
   const [error, setError] = useState(false);
   const [tab, setTab] = useState<DetailTab>('prompt');

   useEffect(() => {
      if (!workspaceId || !runId) return;
      let cancelled = false;
      setDetail(null);
      setError(false);
      getPromptLog(workspaceId, runId)
         .then((value) => !cancelled && setDetail(value))
         .catch(() => !cancelled && setError(true));
      return () => {
         cancelled = true;
      };
   }, [workspaceId, runId]);

   return (
      <Sheet open={runId !== null} onOpenChange={(open) => !open && onClose()}>
         <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-2xl">
            <SheetHeader className="border-b">
               <SheetTitle className="flex items-center gap-2">
                  {detail
                     ? detail.kind === 'agent'
                        ? [detail.agentName ?? t('agentTitle'), detail.issueIdentifier]
                             .filter(Boolean)
                             .join(' · ')
                        : detail.purpose
                     : t('title')}
                  {detail && <LogStatusBadge status={detail.status} />}
               </SheetTitle>
               <SheetDescription className={detail ? 'sr-only' : undefined}>
                  {detail ? t('title') : error ? t('loadFailed') : t('loading')}
               </SheetDescription>
            </SheetHeader>
            {detail && (
               <Tabs
                  value={tab}
                  onValueChange={(value) => setTab(value as DetailTab)}
                  className="gap-0"
               >
                  <TabsList aria-label={t('tabs.label')} className="mx-auto mt-3">
                     {DETAIL_TABS.map((name) => (
                        <TabsTrigger key={name} value={name}>
                           {t(`tabs.${name}`)}
                        </TabsTrigger>
                     ))}
                  </TabsList>
                  <div className="mx-4 mt-3 grid grid-cols-[minmax(0,3fr)_minmax(0,7fr)] gap-3">
                     <MetaTable
                        rows={[
                           {
                              label: tCols('model'),
                              value: detail.model ? readableModelName(detail.model) : '—',
                              title: detail.model ?? undefined,
                           },
                           {
                              label: t('tokensIn'),
                              value: formatTokens(detail.inputTokens),
                           },
                           {
                              label: t('tokensOut'),
                              value: formatTokens(detail.outputTokens),
                           },
                        ]}
                     />
                     <MetaTable
                        rows={[
                           {
                              label: tCols('duration'),
                              value: detail.durationMs === null ? '—' : formatMs(detail.durationMs),
                           },
                           {
                              label: tCols('cost'),
                              value:
                                 detail.costMicros === null ? '—' : formatCost(detail.costMicros),
                           },
                           {
                              label: tCols('when'),
                              value: new Date(detail.createdAt).toLocaleString(),
                           },
                        ]}
                     />
                  </div>
                  <TabsContent value="headers" className="p-4">
                     <RequestHeadersView exchange={detail.exchange} />
                  </TabsContent>
                  <TabsContent value="payload" className="p-4">
                     <RequestPayloadView exchange={detail.exchange} />
                  </TabsContent>
                  <TabsContent value="events" className="p-4">
                     <EventStreamView exchange={detail.exchange} />
                  </TabsContent>
                  <TabsContent value="response" className="p-4">
                     <ResponseView exchange={detail.exchange} kind={detail.kind} />
                  </TabsContent>
                  <TabsContent value="prompt" className="flex flex-col gap-5 p-4">
                     {detail.kind === 'agent' && (
                        <p className="text-muted-foreground">{t('agentNote')}</p>
                     )}
                     <Block label={t('system')} text={detail.system} emptyLabel={t('none')} />
                     {detail.transcript.length > 0 && (
                        <section className="flex flex-col gap-2">
                           <h3 className="font-medium text-muted-foreground">{t('transcript')}</h3>
                           {detail.transcript.map((message, index) => (
                              <Block
                                 key={index}
                                 label={t(`role_${message.role}`)}
                                 text={message.text}
                                 emptyLabel={t('none')}
                                 subtle
                              />
                           ))}
                        </section>
                     )}
                     <Block
                        label={detail.kind === 'agent' ? t('taskPrompt') : t('prompt')}
                        text={detail.prompt}
                        emptyLabel={t('none')}
                     />
                     {detail.reach && (
                        <Block
                           label={t('reach')}
                           text={[
                              `${t('reachTools')}: ${
                                 detail.reach.tools === null
                                    ? t('reachAllTools')
                                    : detail.reach.tools.join(', ') || '—'
                              }`,
                              `${t('reachMcp')}: ${detail.reach.mcpServers.join(', ') || '—'}`,
                              `${t('reachSkills')}: ${detail.reach.skills.join(', ') || '—'}`,
                           ].join('\n')}
                           emptyLabel={t('none')}
                           subtle
                        />
                     )}
                     {detail.jsonSchema && (
                        <Block
                           label={t('schema')}
                           text={JSON.stringify(detail.jsonSchema, null, 2)}
                           emptyLabel={t('none')}
                        />
                     )}
                     {detail.failureCode && (
                        <Block
                           label={t('failure')}
                           text={[detail.failureCode, detail.failureMessage]
                              .filter(Boolean)
                              .join('\n')}
                           emptyLabel={t('none')}
                           danger
                        />
                     )}
                     {detail.response ? (
                        detail.structured && detail.response.structured !== null ? (
                           <Block
                              label={t('structured')}
                              text={JSON.stringify(detail.response.structured, null, 2)}
                              emptyLabel={t('none')}
                           />
                        ) : (
                           <Block
                              label={t('response')}
                              text={detail.response.text}
                              emptyLabel={t('none')}
                           />
                        )
                     ) : (
                        !detail.failureCode && (
                           <p className="text-muted-foreground">{t('noResponse')}</p>
                        )
                     )}
                  </TabsContent>
               </Tabs>
            )}
         </SheetContent>
      </Sheet>
   );
}

/** Label/value pairs for the call meta strip above the detail tabs. */
function MetaTable({
   rows,
}: {
   rows: ReadonlyArray<{ label: string; value: string; title?: string }>;
}) {
   return (
      <table className="w-full table-fixed rounded-md border bg-muted/30">
         <tbody>
            {rows.map((row) => (
               <tr key={row.label}>
                  <th
                     className="w-[30%] px-3 py-1 text-left font-normal text-muted-foreground"
                     title={row.label}
                  >
                     {row.label}
                  </th>
                  <td className="w-[70%] truncate px-3 py-1" title={row.title}>
                     {row.value}
                  </td>
               </tr>
            ))}
         </tbody>
      </table>
   );
}

/** A labelled, copyable, byte-exact block of prompt or response text. */
function Block({
   label,
   text,
   emptyLabel,
   subtle = false,
   danger = false,
}: {
   label: string;
   text: string;
   emptyLabel: string;
   subtle?: boolean;
   danger?: boolean;
}) {
   const t = useTranslations('areas.logs.detail');
   const [copied, setCopied] = useState(false);
   const copy = () => {
      void navigator.clipboard.writeText(text).then(() => {
         setCopied(true);
         window.setTimeout(() => setCopied(false), 1500);
      });
   };
   return (
      <section className="flex flex-col gap-1.5">
         <div className="flex items-center justify-between">
            <h3 className="font-medium text-muted-foreground">{label}</h3>
            {text && (
               <Button variant="ghost" size="xxs" onClick={copy} aria-label={t('copy')}>
                  {copied ? <Check /> : <Copy />}
                  {copied ? t('copied') : t('copy')}
               </Button>
            )}
         </div>
         {text ? (
            <pre
               className={`max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border p-3 font-mono ${
                  danger
                     ? 'border-destructive/40 text-destructive'
                     : subtle
                       ? 'bg-muted/30'
                       : 'bg-muted/50'
               }`}
            >
               {text}
            </pre>
         ) : (
            <p className="italic text-muted-foreground">{emptyLabel}</p>
         )}
      </section>
   );
}
