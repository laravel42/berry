'use client';

import {
   Dialog,
   DialogContent,
   DialogDescription,
   DialogHeader,
   DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
   DropdownMenu,
   DropdownMenuCheckboxItem,
   DropdownMenuContent,
   DropdownMenuSeparator,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CodeEditor } from '@/components/ui/code-editor';
import { Input } from '@/components/ui/input';
import { BerryApiError } from '@/lib/api';
import {
   getRun,
   isTerminalRunEvent,
   streamRunEvents,
   type RunEvent,
   type RunRecord,
} from '@/lib/runs';
import { formatCost, formatTokens } from '@/lib/usage';
import { cn } from '@/lib/utils';
import { Check, ChevronDown, Copy, ListFilter, Search, X } from 'lucide-react';
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
/**
 * The run as its stream reports it, moved only forward: queued, then running,
 * then an ending. Opening a run replays its stream from the start, and an old
 * `run.started` must not make a finished run read as running again.
 */
function advanced(
   run: RunRecord | null,
   status: RunRecord['status'],
   at: string
): RunRecord | null {
   if (!run) return run;
   const rank = (value: RunRecord['status']) =>
      value === 'queued' ? 0 : value === 'running' ? 1 : 2;
   if (rank(status) <= rank(run.status)) return run;
   return {
      ...run,
      status,
      startedAt: run.startedAt ?? at,
      ...(rank(status) === 2 ? { completedAt: run.completedAt ?? at } : {}),
   };
}

function elapsed(from: string, to: string): number | null {
   const ms = Date.parse(to) - Date.parse(from);
   return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/**
 * The steps with the run's failure in the last error block, as `CODE: message`;
 * a transcript whose stream carried no error gets one at the end.
 */
export function attachFailure(
   steps: TranscriptStep[],
   failure: { code: string; message: string } | null
): TranscriptStep[] {
   if (!failure) return steps;
   const text = `${failure.code}: ${failure.message}`;
   const index = steps.findLastIndex((step) => step.kind === 'error');
   if (index === -1) {
      return [
         ...steps,
         {
            id: 'error:run',
            kind: 'error',
            title: 'error',
            input: null,
            result: text,
            at: steps.at(-1)?.at ?? '',
            ok: false,
            durationMs: null,
            detail: null,
         },
      ];
   }
   const next = [...steps];
   next[index] = { ...next[index]!, result: text };
   return next;
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
      // A row of a log, not a card: rows are ruled apart by the list, the kind
      // sits in a fixed column so titles line up, and the search's current
      // match is washed in the agent's tint.
      <li
         data-step-id={step.id}
         className={cn('px-4 py-2.5 transition-colors', current && 'bg-status-info/10')}
      >
         <div className="flex items-baseline gap-3">
            <span
               data-heading="label"
               className={cn(
                  'w-[5.5rem] shrink-0 uppercase',
                  step.kind === 'error' ? 'text-status-danger' : 'text-muted-foreground'
               )}
            >
               {t(`row.${step.kind}`)}
            </span>
            <span className="min-w-0 flex-1 truncate">
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
               <X
                  className="size-3.5 shrink-0 self-center text-status-danger"
                  aria-label={t('failed')}
               />
            ) : step.ok === true ? (
               <Check
                  className="size-3.5 shrink-0 self-center text-status-success"
                  aria-label={t('succeeded')}
               />
            ) : null}
         </div>

         {step.input ? (
            <div className="mt-2 sm:pl-[6.25rem]">
               <div className="flex items-center gap-1.5 text-muted-foreground">
                  <span>{t('input')}</span>
                  <CopyButton text={step.input} label={t('input')} />
               </div>
               <StepBody text={step.input} query={highlight} maxHeight="10rem" className="mt-1" />
            </div>
         ) : null}

         {step.result.trim() ? (
            <div className="mt-2 sm:pl-[6.25rem]">
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

/**
 * One run's transcript in a dialog: the runs surface and an agent's activity
 * open it from a list. The task drawer shows the same transcript in place, as
 * its console (`RunConsole`).
 */
export function RunTranscriptDialog({
   runId,
   open,
   onOpenChange,
   agentName,
}: TranscriptDialogProps) {
   const t = useTranslations('issueDetail.transcript');
   return (
      <Dialog open={open} onOpenChange={onOpenChange}>
         <DialogContent className="flex h-[80vh] w-full flex-col gap-0 p-0 sm:max-w-[900px]">
            {open && runId ? (
               <RunTranscript
                  runId={runId}
                  className="min-h-0 flex-1"
                  header={(status) => (
                     <DialogHeader className="border-b px-4 py-3">
                        <DialogTitle>{t('title')}</DialogTitle>
                        <DialogDescription>
                           {t('subtitle', { agent: agentName ?? '—', status: status || '—' })}
                        </DialogDescription>
                     </DialogHeader>
                  )}
               />
            ) : (
               <DialogTitle className="sr-only">{t('title')}</DialogTitle>
            )}
         </DialogContent>
      </Dialog>
   );
}

export interface RunTranscriptProps {
   runId: string;
   className?: string;
   /** Above the toolbar, given the run's status as the stream reports it. */
   header?: (status: string) => ReactNode;
   /** Where the steps scroll: the dialog fills its height; a console is given one. */
   listClassName?: string;
   /**
    * `newest-first` (the dialog): the latest step on top. `oldest-first` (the
    * console): read top to bottom like a terminal, the latest step at the
    * foot, and the list stays pinned there while it runs.
    */
   order?: 'newest-first' | 'oldest-first';
   /**
    * Whether search and filters show. Left out, always (the dialog). The
    * console passes it, from its own filter button, so the log has the room
    * until they are asked for; Esc in the search asks to close them.
    */
   filtersOpen?: boolean;
   onFiltersOpenChange?: (open: boolean) => void;
   /** Told whether a search or a kind filter is applied, so a closed bar can say so. */
   onFiltersActiveChange?: (active: boolean) => void;
   /**
    * Told each fresh read of the run: on open, every ten seconds while it
    * works, and once when its stream ends. The console keeps the task's run
    * list current with it, so a finished run stops reading as running.
    */
   onRunLoaded?: (run: RunRecord) => void;
   /** In the bottom bar after its controls, before what the run spent: what the console knows of the run. */
   footerInfo?: ReactNode;
}

/**
 * The transcript itself: the run's steps from its event stream, newest first,
 * with search, kind filters, and what it spent. Followed live while it runs.
 */
export function RunTranscript({
   runId,
   className,
   header,
   listClassName,
   order = 'newest-first',
   filtersOpen,
   onFiltersOpenChange,
   onFiltersActiveChange,
   onRunLoaded,
   footerInfo,
}: RunTranscriptProps) {
   const oldestFirst = order === 'oldest-first';
   const t = useTranslations('issueDetail.transcript');
   const [steps, setSteps] = useState<TranscriptStep[]>([]);
   const [lastEventAt, setLastEventAt] = useState<string | null>(null);
   const [run, setRun] = useState<RunRecord | null>(null);
   const [status, setStatus] = useState('');
   const [query, setQuery] = useState('');
   const searchInput = useRef<HTMLInputElement>(null);
   const reportRun = useRef(onRunLoaded);
   reportRun.current = onRunLoaded;
   useEffect(() => {
      if (run) reportRun.current?.(run);
   }, [run]);
   const showBar = filtersOpen ?? true;
   const [kinds, setKinds] = useState<StepKind[]>([]);
   const filtersActive = query.trim() !== '' || kinds.length > 0;
   useEffect(() => {
      onFiltersActiveChange?.(filtersActive);
   }, [filtersActive, onFiltersActiveChange]);
   // Opened from outside: the search is what the person came for.
   useEffect(() => {
      if (filtersOpen) searchInput.current?.focus();
   }, [filtersOpen]);
   const [following, setFollowing] = useState(true);
   const [matchIndex, setMatchIndex] = useState(0);
   const scroller = useRef<HTMLDivElement>(null);

   useEffect(() => {
      let cancelled = false;
      setSteps([]);
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
               setLastEventAt(event.occurredAt);
               if (event.type === 'run.started') {
                  setStatus('running');
                  setRun((current) => advanced(current, 'running', event.occurredAt));
               }
               if (isTerminalRunEvent(event.type)) {
                  // In the run's own words: the stream ends on `run.completed`
                  // but the run reads `succeeded`, and showing whichever
                  // arrived last made the header flip between the two.
                  const ended = event.type.replace('run.', '');
                  const final = ended === 'completed' ? 'succeeded' : ended;
                  setStatus(final);
                  // At once, not at the re-read below: the console's tabs,
                  // Stop and pulse move with the stream, as the task does.
                  if (final === 'succeeded' || final === 'failed' || final === 'cancelled') {
                     setRun((current) => advanced(current, final, event.occurredAt));
                  }
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
   }, [runId]);

   // The run's failure belongs to the transcript's last error block, not under
   // the title: it is what that error was, and the stored message is the full
   // one (a continued limit stop is rewritten to say so after the event).
   const failure = run?.failure ?? null;
   const withFailure = useMemo(() => attachFailure(steps, failure), [steps, failure]);

   const visible = useMemo(() => {
      const byKind =
         kinds.length === 0 ? withFailure : withFailure.filter((step) => kinds.includes(step.kind));
      const needle = query.trim().toLowerCase();
      const matched = !needle
         ? byKind
         : byKind.filter((step) =>
              `${step.title}\n${step.input ?? ''}\n${step.result}`.toLowerCase().includes(needle)
           );
      // Newest first: the last thing an agent did is the thing being waited on.
      // Oldest first reads as it happened, the latest at the foot.
      return oldestFirst ? matched : [...matched].reverse();
   }, [withFailure, kinds, query, oldestFirst]);

   const matches = query.trim() ? visible.length : 0;

   // Between one output and the next the agent is waiting on its model: no
   // tool or command is open and nothing has arrived yet. The log says so at
   // its newest end, and counts from the last thing that did arrive.
   const openStep = steps.some((entry) => entry.ok === null && entry.kind !== 'thinking');
   const waiting = status === 'running' && !openStep && !query.trim() && kinds.length === 0;

   // Following means staying on the newest step, which — newest first — is the
   // top of the list. Scrolling anywhere else means the reader is reading
   // something, so following stops rather than yanking them away from it.
   // Oldest first, the newest step is the foot instead; reaching it again
   // resumes following, as a terminal does.
   const toNewest = useCallback(() => {
      const element = scroller.current;
      if (!element) return;
      element.scrollTo({ top: oldestFirst ? element.scrollHeight : 0 });
   }, [oldestFirst]);

   useEffect(() => {
      if (!following) return;
      toNewest();
   }, [visible, waiting, following, toNewest]);

   // Steps grow after they land: a code block lays itself out a moment later,
   // and output keeps streaming into the open step. While following, every
   // growth re-pins the view to the newest end, so the last message stays in
   // sight rather than just below the fold.
   const content = useRef<HTMLDivElement>(null);
   const followingRef = useRef(following);
   followingRef.current = following;
   useEffect(() => {
      const element = content.current;
      if (!element || typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() => {
         if (followingRef.current) toNewest();
      });
      observer.observe(element);
      return () => observer.disconnect();
   }, [toNewest]);

   // Only a scroll the reader makes stops following: moving up, away from
   // the foot. Reading the distance from the foot alone raced the log's own
   // growth — a burst of steps (every open replays the run) grew the content
   // before the pin's scroll event arrived, which then read as "not at the
   // foot" and left the view stuck partway. Growth never moves scrollTop, so
   // it can no longer switch following off; reaching the foot turns it on.
   const lastTop = useRef(0);
   const onScroll = useCallback(() => {
      const element = scroller.current;
      if (!element) return;
      const top = element.scrollTop;
      const movedUp = top < lastTop.current - 2;
      lastTop.current = top;
      if (oldestFirst) {
         const atFoot = element.scrollHeight - top - element.clientHeight < 24;
         if (movedUp && !atFoot && following) setFollowing(false);
         else if (atFoot && !following) setFollowing(true);
         return;
      }
      if (top > 8 && !movedUp && following) setFollowing(false);
      else if (top <= 8 && !following) setFollowing(true);
   }, [following, oldestFirst]);

   const step = (delta: number) => {
      if (matches === 0) return;
      const next = (matchIndex + delta + matches) % matches;
      setMatchIndex(next);
      setFollowing(false);
      const target = scroller.current?.querySelectorAll('[data-step-id]')[next];
      target?.scrollIntoView({ block: 'center' });
   };

   // Usage is recorded per model call, so a running run's totals move. The
   // stream carries no usage, so the run is re-read while it works rather than
   // showing what it had spent when the dialog opened (often nothing).
   const live = status === 'running' || status === 'queued';

   const [now, setNow] = useState(() => Date.now());
   useEffect(() => {
      if (!waiting) return;
      const timer = window.setInterval(() => setNow(Date.now()), 1000);
      return () => window.clearInterval(timer);
   }, [waiting]);
   const waitedMs = lastEventAt ? Math.max(0, now - new Date(lastEventAt).getTime()) : 0;
   const thinkingRow = waiting ? (
      <li className="flex items-center gap-3 px-4 py-2.5" aria-live="polite">
         <span data-heading="label" className="w-[5.5rem] shrink-0 text-status-info uppercase">
            {t('row.thinking')}
         </span>
         <span className="flex items-center gap-1" aria-hidden>
            {[0, 1, 2].map((dot) => (
               <span
                  key={dot}
                  className="size-1.5 rounded-full bg-status-info [animation:berry-working_1.2s_ease-in-out_infinite]"
                  style={{ animationDelay: `${dot * 0.18}s` }}
               />
            ))}
         </span>
         <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
            {formatSeconds(waitedMs)}
         </span>
      </li>
   ) : null;
   useEffect(() => {
      if (!live) return;
      const timer = window.setInterval(() => {
         void getRun(runId).then(
            (loaded) => setRun(loaded),
            () => undefined
         );
      }, 10_000);
      return () => window.clearInterval(timer);
   }, [runId, live]);

   const totalTokens = run ? run.usage.totalTokens : 0;
   const cost = run?.usage.costMicros ?? null;

   return (
      <div className={cn('flex flex-col', className)}>
         {header?.(status || run?.status || '')}

         {showBar ? (
            <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
               <div className="flex min-w-[200px] flex-1 items-center gap-1.5">
                  <Search className="size-3.5 shrink-0 text-muted-foreground" />
                  <Input
                     ref={searchInput}
                     value={query}
                     aria-label={t('search')}
                     placeholder={t('searchPlaceholder')}
                     className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                     onChange={(event) => {
                        setQuery(event.target.value);
                        setMatchIndex(0);
                     }}
                     onKeyDown={(event) => {
                        if (event.key === 'Escape' && onFiltersOpenChange) {
                           event.preventDefault();
                           onFiltersOpenChange(false);
                           return;
                        }
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

               {/* Several kinds at once, or none for everything: a menu that stays
                open while ticking, so the list filters as each one is chosen. */}
               <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                     <Button variant="outline" size="xs" className="shrink-0">
                        <ListFilter className="size-3.5" aria-hidden />
                        {kinds.length === 0
                           ? t('all')
                           : kinds.length === 1
                             ? t(kinds[0]!)
                             : t('kindsChosen', { count: kinds.length })}
                        <ChevronDown className="size-3.5 opacity-60" aria-hidden />
                     </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                     <DropdownMenuCheckboxItem
                        checked={kinds.length === 0}
                        onSelect={(event) => event.preventDefault()}
                        onCheckedChange={() => setKinds([])}
                     >
                        {t('all')}
                     </DropdownMenuCheckboxItem>
                     <DropdownMenuSeparator />
                     {FILTERS.map((kind) => (
                        <DropdownMenuCheckboxItem
                           key={kind}
                           checked={kinds.includes(kind)}
                           onSelect={(event) => event.preventDefault()}
                           onCheckedChange={(checked) =>
                              setKinds((current) =>
                                 checked
                                    ? [...current, kind]
                                    : current.filter((entry) => entry !== kind)
                              )
                           }
                        >
                           {t(kind)}
                        </DropdownMenuCheckboxItem>
                     ))}
                  </DropdownMenuContent>
               </DropdownMenu>
            </div>
         ) : null}

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
                  toNewest();
               }
               if (event.key === 'Home') setFollowing(false);
            }}
            className={cn(
               'min-h-0 flex-1 overflow-y-auto py-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset',
               listClassName
            )}
            aria-label={oldestFirst ? t('oldestFirst') : t('newestFirst')}
         >
            <div ref={content}>
               {visible.length === 0 && !thinkingRow ? (
                  <p className="py-8 text-center text-muted-foreground">{t('empty')}</p>
               ) : (
                  <ul className="flex flex-col divide-y divide-border/60">
                     {oldestFirst ? null : thinkingRow}
                     {visible.map((entry, index) => (
                        <StepCard
                           key={entry.id}
                           step={entry}
                           highlight={query}
                           current={Boolean(query.trim()) && index === matchIndex}
                        />
                     ))}
                     {oldestFirst ? thinkingRow : null}
                  </ul>
               )}
            </div>
         </div>

         <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2.5 text-muted-foreground">
            {footerInfo}
            <span>
               {t('tokens')}{' '}
               <span className="tabular-nums text-foreground">{formatTokens(totalTokens)}</span>
            </span>
            <span>
               {t('cost')}{' '}
               <span className="tabular-nums text-foreground">
                  {/* No price is unknown, not free: tokens spent on a model with no
                         published price must not read as $0. */}
                  {cost === null && totalTokens > 0 ? t('unpriced') : formatCost(cost ?? 0)}
               </span>
            </span>
         </div>
      </div>
   );
}

export default RunTranscriptDialog;
