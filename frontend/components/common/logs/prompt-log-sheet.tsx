'use client';

import { Check, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { readableModelName } from '@/components/common/agents/model-name';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
   type LogStatus,
   type PromptLogDetail,
} from '@/lib/logs';
import { formatCost, formatTokens } from '@/lib/usage';

import {
   EventStreamView,
   RequestHeadersView,
   RequestPayloadView,
   ResponseView,
} from './prompt-log-exchange';

/**
 * One model call or agent run opened whole, and the status badge the lists
 * share. Its own module so other features (a plan's transcript) can open a
 * call without importing the Logs page.
 */

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

export function LogStatusBadge({ status }: { status: string }) {
   const t = useTranslations('areas.logs.status');
   const tone = STATUS_TONE[status] ?? { tone: 'neutral', state: 'hollow' };
   const label = (LOG_STATUSES as readonly string[]).includes(status)
      ? t(status as LogStatus)
      : status;
   return <StatusBadge look={{ label, ...tone }} />;
}

/** One model call or agent run, whole: its prompt, then the call as it crossed the wire. */
export function PromptLogSheet({
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
