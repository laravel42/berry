import type { RunBundle, RunEvent } from './bundle.ts';

/**
 * A run's transcript, measured and condensed.
 *
 * The counts and the slow steps are computed here, not by the model: they are
 * facts the ledger already holds, and the model is given them so it explains
 * them rather than estimates them. The transcript it reads is the same events
 * rewritten one line per step, with the assistant's streamed deltas joined
 * and long text cut, because a run is thousands of one-word deltas.
 */

export interface DigestOptions {
   /** A tool call, a command, or the silence between two events longer than this is a slow step. */
   slowStepMs: number;
   /** The most transcript characters the model is shown. */
   maxChars: number;
}

export const DEFAULT_DIGEST: DigestOptions = { slowStepMs: 120_000, maxChars: 120_000 };

export interface ToolCall {
   sequence: number;
   name: string;
   status: string;
   durationMs: number | null;
}

export interface SlowStep {
   sequence: number;
   kind: 'tool' | 'command' | 'idle';
   label: string;
   durationMs: number;
}

export interface RunMetrics {
   durationMs: number | null;
   events: number;
   assistantTurns: number;
   toolCalls: number;
   failedToolCalls: number;
   failedToolsByName: Record<string, number>;
   commands: number;
   failedCommands: number;
   slowSteps: SlowStep[];
   /** Tools that failed three or more times in one run: the agent kept trying something that does not work. */
   repeatedFailures: Array<{ name: string; count: number }>;
}

export interface Digest {
   metrics: RunMetrics;
   transcript: string;
   truncated: boolean;
}

const TEXT_CUT = 1_500;
const OUTPUT_TAIL = 1_200;
const SLOW_LIST = 20;

function record(value: unknown): Record<string, unknown> {
   return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
   return typeof value === 'string' ? value : null;
}

function number(value: unknown): number | null {
   return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function cut(value: string, limit: number): string {
   const flat = value.trim();
   return flat.length <= limit ? flat : `${flat.slice(0, limit)} […${flat.length - limit} more characters]`;
}

function tail(value: string, limit: number): string {
   const flat = value.trimEnd();
   return flat.length <= limit ? flat : `[…${flat.length - limit} earlier characters] ${flat.slice(-limit)}`;
}

function seconds(ms: number): string {
   return ms >= 60_000 ? `${(ms / 60_000).toFixed(1)} min` : `${(ms / 1000).toFixed(1)} s`;
}

function clock(ms: number): string {
   const total = Math.max(0, Math.round(ms / 1000));
   const h = Math.floor(total / 3600);
   const m = Math.floor((total % 3600) / 60);
   const s = total % 60;
   return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function timeOf(event: RunEvent): number | null {
   const at = Date.parse(event.at);
   return Number.isNaN(at) ? null : at;
}

export function digestRun(bundle: RunBundle, options: DigestOptions = DEFAULT_DIGEST): Digest {
   const events = [...bundle.events].sort((a, b) => a.sequence - b.sequence);
   const firstAt = events[0] ? timeOf(events[0]) : null;
   const parsedStart = bundle.run.startedAt ? Date.parse(bundle.run.startedAt) : Number.NaN;
   const started = Number.isNaN(parsedStart) ? firstAt : parsedStart;
   const completed = Date.parse(bundle.run.completedAt);
   const origin = started ?? 0;

   const tools = new Map<string, { sequence: number; name: string }>();
   const commands = new Map<string, { sequence: number; command: string; output: string }>();
   const calls: ToolCall[] = [];
   const slow: SlowStep[] = [];
   const lines: string[] = [];
   let failedCommands = 0;
   let commandCount = 0;
   let assistantTurns = 0;
   let pending: { sequence: number; at: number | null; text: string } | null = null;
   let previousAt: number | null = null;
   let previousSequence = 0;

   const stamp = (sequence: number, at: number | null) => `#${sequence} +${at === null ? '??:??:??' : clock(at - origin)}`;
   const flush = () => {
      if (!pending) return;
      if (pending.text.trim() !== '') {
         assistantTurns += 1;
         lines.push(`${stamp(pending.sequence, pending.at)} assistant: ${cut(pending.text, TEXT_CUT)}`);
      }
      pending = null;
   };

   for (const event of events) {
      const at = timeOf(event);
      const payload = record(event.payload);
      if (at !== null && previousAt !== null && at - previousAt >= options.slowStepMs) {
         slow.push({ sequence: event.sequence, kind: 'idle', label: `no event between #${previousSequence} and #${event.sequence}`, durationMs: at - previousAt });
      }
      if (at !== null) previousAt = at;
      previousSequence = event.sequence;

      if (event.type === 'run.output.delta') {
         const delta = text(payload.text) ?? '';
         if (pending) pending.text += delta;
         else pending = { sequence: event.sequence, at, text: delta };
         continue;
      }
      flush();

      switch (event.type) {
         case 'run.tool.started': {
            const id = text(payload.toolCallId) ?? `seq-${event.sequence}`;
            const name = text(payload.name) ?? 'unknown tool';
            tools.set(id, { sequence: event.sequence, name });
            const input = text(payload.inputSummary);
            lines.push(`${stamp(event.sequence, at)} tool call ${name}${input ? ` ${cut(input, 300)}` : ''}`);
            break;
         }
         case 'run.tool.completed': {
            const id = text(payload.toolCallId) ?? '';
            const started = tools.get(id);
            const name = started?.name ?? 'unknown tool';
            const status = text(payload.status) ?? 'unknown';
            const durationMs = number(payload.durationMs);
            calls.push({ sequence: started?.sequence ?? event.sequence, name, status, durationMs });
            if (durationMs !== null && durationMs >= options.slowStepMs) {
               slow.push({ sequence: event.sequence, kind: 'tool', label: name, durationMs });
            }
            const output = text(payload.outputSummary);
            lines.push(
               `${stamp(event.sequence, at)} tool ${name} -> ${status}${durationMs === null ? '' : ` (${seconds(durationMs)})`}` +
                  (output ? `: ${cut(output, 600)}` : '')
            );
            break;
         }
         case 'run.command.started': {
            const id = text(payload.commandId) ?? `seq-${event.sequence}`;
            commands.set(id, { sequence: event.sequence, command: text(payload.command) ?? '', output: '' });
            break;
         }
         case 'run.command.output': {
            const id = text(payload.commandId);
            const entry = id ? commands.get(id) : undefined;
            if (entry) entry.output += text(payload.text) ?? '';
            break;
         }
         case 'run.command.completed': {
            commandCount += 1;
            const id = text(payload.commandId) ?? '';
            const entry = commands.get(id);
            const command = entry?.command ?? text(payload.command) ?? '';
            const exitCode = number(payload.exitCode);
            const durationMs = number(payload.durationMs);
            const failed = exitCode !== 0;
            if (failed) failedCommands += 1;
            if (durationMs !== null && durationMs >= options.slowStepMs) {
               slow.push({ sequence: event.sequence, kind: 'command', label: cut(command, 200), durationMs });
            }
            let line = `${stamp(event.sequence, at)} $ ${cut(command, 500)} -> exit ${exitCode ?? '?'}${durationMs === null ? '' : ` (${seconds(durationMs)})`}`;
            if (failed && entry?.output) line += `\n    output: ${tail(entry.output, OUTPUT_TAIL).replaceAll('\n', '\n    ')}`;
            lines.push(line);
            break;
         }
         case 'run.failed': {
            const failure = record(payload.failure);
            lines.push(`${stamp(event.sequence, at)} RUN FAILED ${text(failure.code) ?? ''}: ${text(failure.message) ?? ''}`);
            break;
         }
         case 'run.verified': {
            const results = Array.isArray(payload.results) ? payload.results.map(record) : [];
            const summary = results.map((result) => `${text(result.command) ?? '?'} -> exit ${number(result.exitCode) ?? '?'}`).join('; ');
            lines.push(`${stamp(event.sequence, at)} verification ${payload.passed === true ? 'passed' : 'FAILED'}: ${cut(summary, 800)}`);
            break;
         }
         case 'run.delivered': {
            const files = Array.isArray(payload.files) ? payload.files.length : 0;
            lines.push(`${stamp(event.sequence, at)} delivered ${files} files on ${text(payload.branch) ?? 'no branch'}`);
            break;
         }
         case 'run.usage.updated':
            break;
         default: {
            const brief = JSON.stringify(event.payload ?? {});
            lines.push(`${stamp(event.sequence, at)} ${event.type} ${cut(brief, 300)}`);
         }
      }
   }
   flush();

   const failedToolsByName: Record<string, number> = {};
   for (const call of calls) {
      if (call.status !== 'succeeded') failedToolsByName[call.name] = (failedToolsByName[call.name] ?? 0) + 1;
   }
   const repeatedFailures = Object.entries(failedToolsByName)
      .filter(([, count]) => count >= 3)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

   const metrics: RunMetrics = {
      durationMs: started !== null && !Number.isNaN(completed) ? completed - started : null,
      events: events.length,
      assistantTurns,
      toolCalls: calls.length,
      failedToolCalls: calls.filter((call) => call.status !== 'succeeded').length,
      failedToolsByName,
      commands: commandCount,
      failedCommands,
      slowSteps: slow.sort((a, b) => b.durationMs - a.durationMs).slice(0, SLOW_LIST),
      repeatedFailures,
   };

   const { transcript, truncated } = fit(lines, options.maxChars);
   return { metrics, transcript, truncated };
}

/** The opening and most of the ending: how a run started and how it ended are where its causes are. */
function fit(lines: string[], maxChars: number): { transcript: string; truncated: boolean } {
   const whole = lines.join('\n');
   if (whole.length <= maxChars) return { transcript: whole, truncated: false };
   const headBudget = Math.floor(maxChars * 0.3);
   const tailBudget = maxChars - headBudget;
   const head: string[] = [];
   let used = 0;
   let index = 0;
   for (; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      if (used + line.length + 1 > headBudget) break;
      head.push(line);
      used += line.length + 1;
   }
   const end: string[] = [];
   used = 0;
   let back = lines.length - 1;
   for (; back >= index; back -= 1) {
      const line = lines[back] ?? '';
      if (used + line.length + 1 > tailBudget) break;
      end.unshift(line);
      used += line.length + 1;
   }
   const omitted = back - index + 1;
   return { transcript: [...head, `[… ${omitted} steps omitted …]`, ...end].join('\n'), truncated: true };
}
