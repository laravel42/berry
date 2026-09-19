'use client';

import {
   Dialog,
   DialogContent,
   DialogDescription,
   DialogHeader,
   DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CodeEditor } from '@/components/ui/code-editor';
import { Input } from '@/components/ui/input';
import { BerryApiError } from '@/lib/api';
import {
   deliveryFromRunEvent,
   getRun,
   isTerminalRunEvent,
   streamRunEvents,
   type RunDelivery,
   type RunEvent,
   type RunRecord,
} from '@/lib/runs';
import { formatCost, formatTokens } from '@/lib/usage';
import { cn } from '@/lib/utils';
import { Check, Copy, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * One run, read back.
 *
 * Shared rather than page-local: the task page opens it from a live agent
 * chip and from every row of the execution log, and the runs surface opens the
 * same thing for a run picked from a list. A second copy of this would be a
 * second answer to "what did the agent actually do", which is the one question
 * the product cannot afford to answer twice.
 *
 * The stream is turned into *steps* rather than one blob of text. A blob can
 * only be scrolled; steps can be filtered, searched, and copied one at a time,
 * which is what someone reviewing an agent's work actually does.
 */

export type StepKind = 'command' | 'edit' | 'read' | 'tool' | 'thinking' | 'error';

export interface TranscriptStep {
   id: string;
   kind: StepKind;
   /** The one-line heading: a command, a tool name, or a section label. */
   title: string;
   /** What went in, when the ledger records it. Commands do; tools do not. */
   input: string | null;
   /** What came back, accumulated as the run produces it. */
   result: string;
   at: string;
   /** Set once the step finishes; null while it is still open. */
   ok: boolean | null;
   /** How long the step took, once it finished. */
   durationMs: number | null;
   /** What a file tool touched: its path and size, or how many files it listed. */
   detail: StepDetail | null;
}

export interface StepDetail {
   path?: string;
   bytes?: number;
   count?: number;
}

/** Milliseconds from one ISO instant to another; null when either is unreadable. */
function elapsed(from: string, to: string): number | null {
   const ms = Date.parse(to) - Date.parse(from);
   return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

function detailOf(value: unknown): StepDetail | null {
   if (!value || typeof value !== 'object') return null;
   const raw = value as Record<string, unknown>;
   const detail: StepDetail = {};
   if (typeof raw.path === 'string' && raw.path) detail.path = raw.path;
   if (typeof raw.bytes === 'number') detail.bytes = raw.bytes;
   if (typeof raw.count === 'number') detail.count = raw.count;
   return Object.keys(detail).length > 0 ? detail : null;
}

/** A thinking passage ends when the next step begins: that is its duration. */
function closeThinking(step: TranscriptStep, at: string): TranscriptStep {
   return { ...step, ok: true, durationMs: elapsed(step.at, at) };
}

const FILTERS: StepKind[] = ['tool', 'thinking', 'error', 'command', 'edit', 'read'];

/** Which kind of step a tool name is. Names vary by runtime; the verbs do not. */
function toolKind(name: string): StepKind {
   const lower = name.toLowerCase();
   if (/(edit|write|patch|apply|create|replace)/.test(lower)) return 'edit';
   if (/(read|cat|grep|search|list|glob|find|fetch)/.test(lower)) return 'read';
   return 'tool';
}

function payloadOf(event: RunEvent): Record<string, unknown> {
   return typeof event.payload === 'object' &&
      event.payload !== null &&
      !Array.isArray(event.payload)
      ? (event.payload as Record<string, unknown>)
      : {};
}

/**
 * Fold one event into the step list.
 *
 * Exported because it is the part worth testing and the part another surface
 * may want without the dialog: given the same events, it always produces the
 * same steps.
 */
export function foldRunEvent(steps: TranscriptStep[], event: RunEvent): TranscriptStep[] {
   const payload = payloadOf(event);
   const next = [...steps];
   const last = next[next.length - 1];

   const openCommand = (commandId: string) =>
      next.findLast((step) => step.kind === 'command' && step.id === `command:${commandId}`);

   switch (event.type) {
      case 'run.output.delta': {
         const text = typeof payload.text === 'string' ? payload.text : '';
         if (!text) return steps;
         // Consecutive deltas are one passage of thought, not one step each.
         if (last && last.kind === 'thinking' && last.ok === null) {
            next[next.length - 1] = { ...last, result: last.result + text };
            return next;
         }
         next.push({
            id: `thinking:${event.id}`,
            kind: 'thinking',
            title: 'thinking',
            input: null,
            result: text,
            at: event.occurredAt,
            ok: null,
            durationMs: null,
            detail: null,
         });
         return next;
      }
      case 'run.command.started': {
         const command = typeof payload.command === 'string' ? payload.command : '';
         const cwd = typeof payload.cwd === 'string' ? payload.cwd : '';
         const commandId = typeof payload.commandId === 'string' ? payload.commandId : event.id;
         if (last && last.kind === 'thinking' && last.ok === null) {
            next[next.length - 1] = closeThinking(last, event.occurredAt);
         }
         next.push({
            id: `command:${commandId}`,
            kind: 'command',
            title: command,
            input: cwd ? `${command}\n(in ${cwd})` : command,
            result: '',
            at: event.occurredAt,
            ok: null,
            durationMs: null,
            detail: null,
         });
         return next;
      }
      case 'run.command.output': {
         const commandId = typeof payload.commandId === 'string' ? payload.commandId : '';
         const text = typeof payload.text === 'string' ? payload.text : '';
         const target = commandId
            ? openCommand(commandId)
            : next.findLast((step) => step.kind === 'command');
         if (!target || !text) return steps;
         next[next.indexOf(target)] = { ...target, result: target.result + text };
         return next;
      }
      case 'run.command.completed': {
         const commandId = typeof payload.commandId === 'string' ? payload.commandId : '';
         const target = commandId
            ? openCommand(commandId)
            : next.findLast((step) => step.kind === 'command');
         if (!target) return steps;
         const code = typeof payload.exitCode === 'number' ? payload.exitCode : null;
         const truncated = payload.truncated === true ? '\n[output truncated]' : '';
         next[next.indexOf(target)] = {
            ...target,
            durationMs:
               typeof payload.durationMs === 'number'
                  ? payload.durationMs
                  : elapsed(target.at, event.occurredAt),
            ok: code === 0,
            result: `${target.result}${truncated}\n[${code === null ? 'did not finish' : `exit ${code}`}]`,
         };
         return next;
      }
      case 'run.tool.started': {
         const name = typeof payload.name === 'string' ? payload.name : 'tool';
         const callId = typeof payload.toolCallId === 'string' ? payload.toolCallId : event.id;
         if (last && last.kind === 'thinking' && last.ok === null) {
            next[next.length - 1] = closeThinking(last, event.occurredAt);
         }
         next.push({
            id: `tool:${callId}`,
            kind: toolKind(name),
            title: name,
            // The ledger deliberately never records a tool's arguments, so
            // there is nothing to show here and saying so beats an empty box.
            input: null,
            result: '',
            at: event.occurredAt,
            ok: null,
            durationMs: null,
            detail: null,
         });
         return next;
      }
      case 'run.tool.completed': {
         const callId = typeof payload.toolCallId === 'string' ? payload.toolCallId : '';
         const target =
            next.findLast((step) => step.id === `tool:${callId}`) ??
            next.findLast((step) => step.ok === null);
         if (!target) return steps;
         next[next.indexOf(target)] = {
            ...target,
            ok: payload.status === 'succeeded',
            // Measured in the runtime when it says; the two timestamps otherwise.
            durationMs:
               typeof payload.durationMs === 'number'
                  ? payload.durationMs
                  : elapsed(target.at, event.occurredAt),
            detail: detailOf(payload.detail),
         };
         return next;
      }
      case 'run.completed': {
         if (!last || last.kind !== 'thinking' || last.ok !== null) return steps;
         next[next.length - 1] = closeThinking(last, event.occurredAt);
         return next;
      }
      case 'run.failed': {
         const message = typeof payload.message === 'string' ? payload.message : '';
         if (last && last.kind === 'thinking' && last.ok === null) {
            next[next.length - 1] = closeThinking(last, event.occurredAt);
         }
         next.push({
            id: `error:${event.id}`,
            kind: 'error',
            title: 'error',
            input: null,
            result: message,
            at: event.occurredAt,
            ok: false,
            durationMs: null,
            detail: null,
         });
         return next;
      }
      default:
         return steps;
   }
}

/** "2.4 KB" — binary units, one decimal under ten. */
export function formatBytes(bytes: number): string {
   if (bytes < 1024) return `${bytes} B`;
   const units = ['KB', 'MB', 'GB'];
   let value = bytes / 1024;
   let unit = 0;
   while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
   }
   return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** Seconds with one decimal, the unit the row reads in: "0.3 s", "12.4 s". */
export function formatSeconds(ms: number): string {
   return `${(ms / 1000).toFixed(1)} s`;
}

function CopyButton({ text, label }: { text: string; label: string }) {
   const t = useTranslations('issueDetail.transcript');
   const [done, setDone] = useState(false);
   return (
      <Button
         variant="ghost"
         size="icon"
         className="size-6 shrink-0"
         aria-label={`${label} — ${t('copy')}`}
         onClick={() => {
            void navigator.clipboard
               .writeText(text)
               .then(() => {
                  setDone(true);
                  setTimeout(() => setDone(false), 1200);
               })
               .catch(() => undefined);
         }}
      >
         {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </Button>
   );
}

function StepCard({
   step,
   highlight,
   current,
}: {
   step: TranscriptStep;
   highlight: string;
   current: boolean;
}) {
   const t = useTranslations('issueDetail.transcript');
   return (
      <li
         data-step-id={step.id}
         className={cn(
            'rounded-sm border border-border/60 bg-container p-2.5',
            current && 'border-status-info'
         )}
      >
         <div className="flex items-center gap-2">
            <span className="shrink-0 rounded bg-accent px-1.5 uppercase tracking-[0.12em] text-muted-foreground">
               {t(step.kind)}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono">
               <Highlighted text={step.title} query={highlight} />
               {step.detail ? (
                  <span className="text-muted-foreground">
                     {[
                        step.detail.path,
                        step.detail.bytes === undefined ? null : formatBytes(step.detail.bytes),
                        step.detail.count === undefined
                           ? null
                           : t('fileCount', { count: step.detail.count }),
                     ]
                        .filter(Boolean)
                        .map((part) => ` · ${part}`)
                        .join('')}
                  </span>
               ) : null}
            </span>
            {step.durationMs !== null ? (
               <span className="shrink-0 tabular-nums text-muted-foreground" title={t('duration')}>
                  {formatSeconds(step.durationMs)}
               </span>
            ) : null}
            {step.ok === false ? (
               <span className="shrink-0 text-muted-foreground">✕</span>
            ) : step.ok === true ? (
               <span className="shrink-0 text-status-success">✓</span>
            ) : null}
         </div>

         {step.input ? (
            <div className="mt-2">
               <div className="flex items-center gap-1.5 text-muted-foreground">
                  <span>{t('input')}</span>
                  <CopyButton text={step.input} label={t('input')} />
               </div>
               <StepBody text={step.input} query={highlight} maxHeight="10rem" className="mt-1" />
            </div>
         ) : null}

         {step.result.trim() ? (
            <div className="mt-2">
               <div className="flex items-center gap-1.5 text-muted-foreground">
                  <span>{t('result')}</span>
                  <CopyButton text={step.result} label={t('result')} />
               </div>
               <StepBody text={step.result} query={highlight} maxHeight="18rem" className="mt-1" />
            </div>
         ) : null}
      </li>
   );
}

/**
 * Shell-coloured code when the search is idle; a marked `<pre>` while searching
 * so the match still lights up inside long output (CodeMirror does not carry
 * the transcript's own highlight marks).
 */
function StepBody({
   text,
   query,
   maxHeight,
   className,
}: {
   text: string;
   query: string;
   maxHeight: string;
   className?: string;
}) {
   if (query.trim()) {
      return (
         <pre
            className={cn(
               'overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--brand-void)] p-2 font-mono leading-6 text-[var(--brand-chalk)]',
               className
            )}
            style={{ maxHeight }}
         >
            <Highlighted text={text} query={query} />
         </pre>
      );
   }
   return <CodeEditor value={text} language="bash" maxHeight={maxHeight} className={className} />;
}

/** The search term, marked wherever it appears. */
function Highlighted({ text, query }: { text: string; query: string }) {
   if (!query.trim()) return <>{text}</>;
   const parts: ReactNode[] = [];
   const needle = query.toLowerCase();
   let index = 0;
   let found = text.toLowerCase().indexOf(needle);
   while (found !== -1) {
      if (found > index) parts.push(text.slice(index, found));
      parts.push(
         <mark key={`${found}`} className="bg-status-warning/50 text-[var(--brand-chalk)]">
            {text.slice(found, found + needle.length)}
         </mark>
      );
      index = found + needle.length;
      found = text.toLowerCase().indexOf(needle, index);
   }
   parts.push(text.slice(index));
   return <>{parts}</>;
}

export interface TranscriptDialogProps {
   runId: string | null;
   open: boolean;
   onOpenChange: (open: boolean) => void;
   /** Shown in the subtitle; the dialog does not look agents up itself. */
   agentName?: string;
}

export function RunTranscriptDialog({
   runId,
   open,
   onOpenChange,
   agentName,
}: TranscriptDialogProps) {
   const t = useTranslations('issueDetail.transcript');
   const [steps, setSteps] = useState<TranscriptStep[]>([]);
   const [run, setRun] = useState<RunRecord | null>(null);
   const [delivery, setDelivery] = useState<RunDelivery | null>(null);
   const [status, setStatus] = useState('');
   const [query, setQuery] = useState('');
   const [kinds, setKinds] = useState<StepKind[]>([]);
   const [following, setFollowing] = useState(true);
   const [matchIndex, setMatchIndex] = useState(0);
   const scroller = useRef<HTMLDivElement>(null);

   useEffect(() => {
      if (!open || !runId) return;
      let cancelled = false;
      setSteps([]);
      setDelivery(null);
      setRun(null);
      setStatus('');
      setFollowing(true);
      void getRun(runId).then(
         (loaded) => {
            if (!cancelled) {
               setRun(loaded);
               setStatus(loaded.status);
            }
         },
         () => undefined
      );

      const controller = new AbortController();
      void (async () => {
         try {
            for await (const event of streamRunEvents(runId, controller.signal)) {
               if (cancelled) return;
               setSteps((current) => foldRunEvent(current, event));
               const delivered = deliveryFromRunEvent(event);
               if (delivered) setDelivery(delivered);
               if (event.type === 'run.started') setStatus('running');
               if (isTerminalRunEvent(event.type)) {
                  // In the run's own words: the stream ends on `run.completed`
                  // but the run reads `succeeded`, and showing whichever
                  // arrived last made the header flip between the two.
                  const ended = event.type.replace('run.', '');
                  setStatus(ended === 'completed' ? 'succeeded' : ended);
                  // The totals only settle at the end, so the run is re-read
                  // rather than left showing the usage it had when opened.
                  void getRun(runId).then(
                     (loaded) => {
                        if (!cancelled) setRun(loaded);
                     },
                     () => undefined
                  );
                  return;
               }
            }
         } catch (error) {
            if (controller.signal.aborted || cancelled) return;
            setStatus(error instanceof BerryApiError ? error.message : 'stream interrupted');
         }
      })();

      return () => {
         cancelled = true;
         controller.abort();
      };
   }, [open, runId]);

   const visible = useMemo(() => {
      const byKind = kinds.length === 0 ? steps : steps.filter((step) => kinds.includes(step.kind));
      const needle = query.trim().toLowerCase();
      const matched = !needle
         ? byKind
         : byKind.filter((step) =>
              `${step.title}\n${step.input ?? ''}\n${step.result}`.toLowerCase().includes(needle)
           );
      // Newest first: the last thing an agent did is the thing being waited on.
      return [...matched].reverse();
   }, [steps, kinds, query]);

   const matches = query.trim() ? visible.length : 0;

   // Following means staying on the newest step, which — newest first — is the
   // top of the list. Scrolling anywhere else means the reader is reading
   // something, so following stops rather than yanking them away from it.
   useEffect(() => {
      if (!following) return;
      scroller.current?.scrollTo({ top: 0 });
   }, [visible, following]);

   const onScroll = useCallback(() => {
      const element = scroller.current;
      if (!element) return;
      if (element.scrollTop > 8 && following) setFollowing(false);
   }, [following]);

   const step = (delta: number) => {
      if (matches === 0) return;
      const next = (matchIndex + delta + matches) % matches;
      setMatchIndex(next);
      setFollowing(false);
      const target = scroller.current?.querySelectorAll('[data-step-id]')[next];
      target?.scrollIntoView({ block: 'center' });
   };

   const totalTokens = run ? run.usage.totalTokens : 0;
   const cost = run?.usage.costMicros ?? null;

   return (
      <Dialog open={open} onOpenChange={onOpenChange}>
         <DialogContent className="flex h-[80vh] w-full flex-col gap-0 p-0 sm:max-w-[900px]">
            <DialogHeader className="border-b px-4 py-3">
               <DialogTitle>{t('title')}</DialogTitle>
               <DialogDescription>
                  {t('subtitle', { agent: agentName ?? '—', status: status || run?.status || '—' })}
               </DialogDescription>
               {run?.failure ? (
                  <p className="mt-2 whitespace-pre-wrap break-words font-mono text-muted-foreground">
                     {run.failure.code}: {run.failure.message}
                  </p>
               ) : null}
            </DialogHeader>

            <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
               <div className="flex min-w-[200px] flex-1 items-center gap-1.5">
                  <Search className="size-3.5 shrink-0 text-muted-foreground" />
                  <Input
                     value={query}
                     aria-label={t('search')}
                     placeholder={t('searchPlaceholder')}
                     className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                     onChange={(event) => {
                        setQuery(event.target.value);
                        setMatchIndex(0);
                     }}
                     onKeyDown={(event) => {
                        if (event.key !== 'Enter') return;
                        event.preventDefault();
                        step(event.shiftKey ? -1 : 1);
                     }}
                  />
                  {query.trim() ? (
                     <span className="shrink-0 text-muted-foreground">
                        {matches === 0
                           ? t('noMatches')
                           : t('matches', { index: matchIndex + 1, total: matches })}
                     </span>
                  ) : null}
               </div>

               <div className="flex flex-wrap items-center gap-1">
                  <Button
                     variant={kinds.length === 0 ? 'secondary' : 'ghost'}
                     size="xs"
                     onClick={() => setKinds([])}
                  >
                     {t('all')}
                  </Button>
                  {FILTERS.map((kind) => (
                     <Button
                        key={kind}
                        variant={kinds.includes(kind) ? 'secondary' : 'ghost'}
                        size="xs"
                        aria-pressed={kinds.includes(kind)}
                        onClick={() =>
                           setKinds((current) =>
                              current.includes(kind)
                                 ? current.filter((entry) => entry !== kind)
                                 : [...current, kind]
                           )
                        }
                     >
                        {t(kind)}
                     </Button>
                  ))}
               </div>
            </div>

            {/* tabIndex so the arrows, PageUp/PageDown and Home/End reach the
                list itself rather than the dialog; End re-engages following,
                which is where the newest step is. */}
            <div
               ref={scroller}
               tabIndex={0}
               onScroll={onScroll}
               onKeyDown={(event) => {
                  if (event.key === 'End') {
                     event.preventDefault();
                     setFollowing(true);
                     scroller.current?.scrollTo({ top: 0 });
                  }
                  if (event.key === 'Home') setFollowing(false);
               }}
               className="min-h-0 flex-1 overflow-y-auto px-4 py-3 outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
               aria-label={t('newestFirst')}
            >
               {visible.length === 0 ? (
                  <p className="py-8 text-center text-muted-foreground">{t('empty')}</p>
               ) : (
                  <ul className="flex flex-col gap-2">
                     {visible.map((entry, index) => (
                        <StepCard
                           key={entry.id}
                           step={entry}
                           highlight={query}
                           current={Boolean(query.trim()) && index === matchIndex}
                        />
                     ))}
                  </ul>
               )}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2.5 text-muted-foreground">
               <span>
                  {t('tokens')}{' '}
                  <span className="tabular-nums text-foreground">{formatTokens(totalTokens)}</span>
               </span>
               <span>
                  {t('cost')}{' '}
                  <span className="tabular-nums text-foreground">{formatCost(cost ?? 0)}</span>
               </span>
               <span className="ml-auto flex flex-wrap items-center gap-x-3">
                  <span>
                     {delivery
                        ? delivery.committed
                           ? t('filesChanged', { count: delivery.filesChanged })
                           : t('noFiles')
                        : t('noFiles')}
                  </span>
                  <span>
                     {t('commandsRun', {
                        count: steps.filter((entry) => entry.kind === 'command').length,
                     })}
                  </span>
               </span>
            </div>
         </DialogContent>
      </Dialog>
   );
}

export default RunTranscriptDialog;
