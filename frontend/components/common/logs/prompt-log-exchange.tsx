'use client';

import { useTranslations } from 'next-intl';
import { Fragment, useState } from 'react';

import { cn } from '@/lib/utils';
import type { PromptLogExchange } from '@/lib/logs';

/**
 * The wire view of one model call, the way a browser's network panel shows a
 * request: its headers, its payload, the event stream the runtime answered
 * with and the response. Everything here was redacted by the server before it
 * was stored; nothing is hidden or rewritten on this side.
 */

type Headers = Record<string, string>;

function sortedEntries(headers: Headers): [string, string][] {
   return Object.entries(headers).sort(([a], [b]) => a.localeCompare(b));
}

/** Name/value rows under a heading: the General, request and response header blocks. */
function HeaderTable({ title, rows }: { title: string; rows: [string, string][] }) {
   return (
      <section className="flex flex-col gap-1.5">
         <h3 className="font-medium text-muted-foreground">{title}</h3>
         <dl className="grid grid-cols-[minmax(8rem,max-content)_1fr] gap-x-4 gap-y-1 rounded-md border bg-muted/30 p-3 font-mono">
            {rows.map(([name, value]) => (
               <Fragment key={name}>
                  <dt className="text-muted-foreground">{name}</dt>
                  <dd className="min-w-0 break-all">{value}</dd>
               </Fragment>
            ))}
         </dl>
      </section>
   );
}

function Json({ value }: { value: unknown }) {
   return (
      <pre className="overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/50 p-3 font-mono">
         {JSON.stringify(value, null, 2)}
      </pre>
   );
}

function NotRecorded() {
   const t = useTranslations('areas.logs.exchange');
   return <p className="text-muted-foreground">{t('notRecorded')}</p>;
}

function statusOf(response: PromptLogExchange['response']): number | null {
   return response && 'status' in response ? response.status : null;
}

export function RequestHeadersView({ exchange }: { exchange: PromptLogExchange | null }) {
   const t = useTranslations('areas.logs.exchange');
   if (!exchange?.request) return <NotRecorded />;
   const status = statusOf(exchange.response);
   const general: [string, string][] = [
      [t('requestUrl'), exchange.request.url],
      [t('requestMethod'), exchange.request.method],
      [t('statusCode'), status === null ? '—' : String(status)],
   ];
   return (
      <div className="flex flex-col gap-5">
         <HeaderTable title={t('general')} rows={general} />
         <HeaderTable title={t('requestHeaders')} rows={sortedEntries(exchange.request.headers)} />
      </div>
   );
}

export function RequestPayloadView({ exchange }: { exchange: PromptLogExchange | null }) {
   if (!exchange) return <NotRecorded />;
   return <Json value={exchange.payload} />;
}

export function EventStreamView({ exchange }: { exchange: PromptLogExchange | null }) {
   const t = useTranslations('areas.logs.exchange');
   const [open, setOpen] = useState<number | null>(null);
   if (!exchange) return <NotRecorded />;
   if (exchange.events.length === 0)
      return <p className="text-muted-foreground">{t('noEvents')}</p>;
   const first = Date.parse(exchange.events[0]?.at ?? '');
   return (
      <table className="w-full table-fixed border-collapse font-mono">
         <thead className="text-left text-muted-foreground">
            <tr className="border-b">
               <th className="w-36 py-1.5 pr-3 font-normal">{t('eventType')}</th>
               <th className="py-1.5 pr-3 font-normal">{t('eventData')}</th>
               <th className="w-32 py-1.5 text-right font-normal">{t('eventTime')}</th>
            </tr>
         </thead>
         <tbody>
            {exchange.events.map(({ at, event }, index) => {
               const { type, ...data } = event;
               const expanded = open === index;
               const offset = Date.parse(at) - first;
               return (
                  <tr
                     key={index}
                     onClick={() => setOpen(expanded ? null : index)}
                     className={cn(
                        'cursor-pointer border-b align-top hover:bg-accent/50',
                        type === 'task.failed' && 'text-destructive'
                     )}
                  >
                     <td className="py-1.5 pr-3">{type}</td>
                     <td className="min-w-0 py-1.5 pr-3">
                        {expanded ? (
                           <pre className="whitespace-pre-wrap break-words">
                              {JSON.stringify(data, null, 2)}
                           </pre>
                        ) : (
                           <span className="block truncate text-muted-foreground">
                              {JSON.stringify(data)}
                           </span>
                        )}
                     </td>
                     <td
                        className="whitespace-nowrap py-1.5 text-right tabular-nums text-muted-foreground"
                        title={at}
                     >
                        {new Date(at).toLocaleTimeString([], { hour12: false })}
                        {Number.isFinite(offset) && index > 0 ? ` +${offset}ms` : ''}
                     </td>
                  </tr>
               );
            })}
         </tbody>
      </table>
   );
}

export function ResponseView({
   exchange,
   kind = 'completion',
}: {
   exchange: PromptLogExchange | null;
   /**
    * An agent run's loop never reports the model's own words (its calls stay
    * inside the runtime), so saying they are missing would read as a fault.
    */
   kind?: 'completion' | 'agent';
}) {
   const t = useTranslations('areas.logs.exchange');
   if (!exchange) return <NotRecorded />;
   const response = exchange.response;
   // The stream is the body; what it settled on is its last terminal event.
   const terminal = [...exchange.events]
      .reverse()
      .find(({ event }) => event.type === 'task.completed' || event.type === 'task.failed');
   const model = modelReply(exchange);
   return (
      <div className="flex flex-col gap-5">
         {response && 'error' in response ? (
            <section className="flex flex-col gap-1.5">
               <h3 className="font-medium text-muted-foreground">{t('noAnswer')}</h3>
               <pre className="whitespace-pre-wrap break-words rounded-md border border-destructive/40 p-3 font-mono text-destructive">
                  {response.error}
               </pre>
            </section>
         ) : response ? (
            <HeaderTable
               title={t('responseHeaders')}
               rows={[
                  [t('statusCode'), String(response.status)],
                  ...sortedEntries(response.headers),
               ]}
            />
         ) : (
            <p className="text-muted-foreground">{t('noAnswer')}</p>
         )}
         {model ? (
            <section className="flex flex-col gap-1.5">
               <h3 className="font-medium text-muted-foreground">
                  {t('modelReply', { stopReason: model.stopReason })}
               </h3>
               <Json value={model.replies} />
               {model.truncated && <p className="text-muted-foreground">{t('modelTruncated')}</p>}
            </section>
         ) : kind === 'completion' ? (
            <p className="text-muted-foreground">{t('noModelReply')}</p>
         ) : null}
         {terminal && (
            <section className="flex flex-col gap-1.5">
               <h3 className="font-medium text-muted-foreground">
                  {t('body', { type: terminal.event.type })}
               </h3>
               <Json value={terminal.event} />
            </section>
         )}
      </div>
   );
}

/**
 * The model's own words from the runtime's `task.model` event: its assistant
 * messages, exactly as the provider shaped them. A structured answer is a
 * `toolUse` block here, so this is the only place its raw input shows.
 */
function modelReply(
   exchange: PromptLogExchange
): { stopReason: string; replies: unknown[]; truncated: boolean } | null {
   const found = exchange.events.find(({ event }) => event.type === 'task.model')?.event as
      | {
           response?: {
              stopReason?: string;
              truncated?: boolean;
              messages?: Array<{ role?: string; content?: unknown }>;
           };
        }
      | undefined;
   const response = found?.response;
   if (!response?.messages) return null;
   return {
      stopReason: response.stopReason ?? 'unknown',
      truncated: response.truncated === true,
      replies: response.messages
         .filter((message) => message.role === 'assistant')
         .map((message) => message.content),
   };
}
