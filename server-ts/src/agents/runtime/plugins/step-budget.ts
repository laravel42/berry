import { AfterModelCallEvent, AfterToolCallEvent, AfterToolsEvent, BeforeToolCallEvent, TextBlock, ToolResultBlock, tool, type LocalAgent, type Plugin, type Tool } from '@strands-agents/sdk';
import { z } from 'zod';
import { truncateUtf8 } from '../utf8.ts';
import { MAX_SUMMARY_BYTES } from '../result-text.ts';

/**
 * The step limit, told to the agent that has to live within it.
 *
 * A run ends when its model calls reach `maxTurns`, and until now the agent
 * learned that by being stopped. One that read eleven files with eleven
 * commands and saved twenty-five files one call at a time spent 80 steps on
 * work that fits in thirty, and was cut off mid-edit with nothing to say for
 * itself. The limit is a fact about the run, like the repository: the agent
 * is told it at the start, and told again when little of it is left. That
 * notice is when it calls `summarize`. The run ends there, and the next one
 * starts from the summary with an empty conversation.
 */

/** Shared by the tools and the plugin: summarize counts only after the wrap-up notice. */
export interface Handoff {
   open: boolean;
   summary: string | null;
   /** Set when the agent stopped because a task this one depends on has not landed. */
   blocked?: Blocked | null;
}

export interface Blocked {
   /** The key of the task this one waits on, as the task named it. */
   task: string;
   missing: string;
}

export const REPORT_BLOCKED = 'report_blocked';

/**
 * Stopping for upstream work that is not in the checkout.
 *
 * Not summarize: that is the handover near the step limit and refuses every
 * call before it, so a run told to summarize when a task it depends on had
 * not landed was answered "not yet" and went on without its input. This ends
 * the run at any step, as blocked on that task. The task returns to To do, and
 * closing the task it waits on starts it again. Only a task this one depends
 * on can be named, because nothing else would start it again.
 */
export function reportBlockedTool(handoff: Handoff, dependsOn: ReadonlyArray<{ identifier: string }>): Tool {
   const known = new Map(dependsOn.map((dependency) => [dependency.identifier.trim().toUpperCase(), dependency.identifier]));
   const names = dependsOn.map((dependency) => dependency.identifier).join(', ');
   return tool({
      name: REPORT_BLOCKED,
      description:
         'End this run because the task cannot be done without work from a task it depends on that is not in your checkout. ' +
         `Name that task (${names}) and what this task needs from it. Berry starts this task again when that task is done.`,
      inputSchema: z.object({
         task: z.string().describe(`The key of the task this one waits on: one of ${names}.`),
         missing: z.string().describe('What this task needs from it, and where you looked for it.'),
      }),
      callback: ({ task, missing }) => {
         const identifier = known.get(task.trim().toUpperCase());
         if (!identifier) return `Refused: ${task} is not a task this one depends on. It depends on ${names}.`;
         const text = missing.trim();
         if (text === '') return `Say what this task needs from ${identifier}, and where you looked for it.`;
         handoff.blocked = { task: identifier, missing: truncateUtf8(text, MAX_SUMMARY_BYTES) };
         return `Recorded. This run ends now as blocked on ${identifier}. Berry starts this task again when ${identifier} is done.`;
      },
   });
}

/** What the run's failure says when it stopped as blocked. */
export function blockedMessage(blocked: Blocked): string {
   return `Blocked on ${blocked.task}: ${blocked.missing} This task starts again when ${blocked.task} is done.`;
}

export function summarizeTool(handoff: Handoff): Tool {
   return tool({
      name: 'summarize',
      description:
         'Hand this task to a fresh run. Call it only after Berry says the step budget is nearly gone. ' +
         'Say what is already done, what is still missing, and any decision the next run must keep. ' +
         'This run ends when the call is accepted.',
      inputSchema: z.object({
         summary: z.string().describe('What is done, what remains, and the decisions the next run must keep.'),
      }),
      callback: ({ summary }) => {
         const text = summary.trim();
         if (!handoff.open) return 'Not yet. Keep working. Berry will say when to summarize.';
         if (text === '') return 'The summary was empty. Say what is done and what is left.';
         handoff.summary = truncateUtf8(text, MAX_SUMMARY_BYTES);
         return 'Recorded. This run ends now. The next one starts from this summary, with none of this conversation.';
      },
   });
}

/** How many steps from the end the agent is told to wrap up. */
export function wrapUpAt(maxTurns: number): number {
   return Math.max(3, Math.min(10, Math.ceil(maxTurns * 0.15)));
}

/**
 * How many steps from the end only summarize is accepted.
 *
 * Two, so a reply whose other calls are refused still leaves one to summarize
 * in. Told once and left to the agent, six of eleven runs at the limit kept
 * working through the notice and ended with no handover.
 */
export const SUMMARIZE_ONLY_AT = 2;

/** What a refused tool call returns once only summarize is accepted. */
export const SUMMARIZE_ONLY =
   'Refused: this run is out of steps, and only summarize is accepted now. Call summarize with what is done and what is left.';

/** Appended to the task prompt. Empty when the run has no step limit. */
export function budgetContract(maxTurns: number | undefined): string {
   if (!maxTurns) return '';
   return (
      '\n\nYour step budget\n' +
      `This run ends after ${maxTurns} steps. A step is one reply from you. ` +
      'Run one command at a time and wait for its result before the next. ' +
      'Do not send several commands in one reply. ' +
      `When about ${wrapUpAt(maxTurns)} steps are left you will be told to call summarize. ` +
      `In the last ${SUMMARIZE_ONLY_AT} steps every other tool call is refused. ` +
      'That ends this run. The next one starts fresh from the summary, without this ' +
      'conversation, on the same branch. Until then, finish what is open so it can be saved.\n'
   );
}

export class StepBudgetPlugin implements Plugin {
   readonly name = 'berry:step-budget';
   readonly #maxTurns: number | undefined;
   readonly #handoff: Handoff;
   #steps = 0;
   #toldToWrapUp = false;
   #toldLast = false;

   constructor(options: { maxTurns: number | undefined; handoff?: Handoff }) {
      this.#maxTurns = options.maxTurns;
      this.#handoff = options.handoff ?? { open: false, summary: null };
   }

   /** The handover, once summarize was accepted. Null until then. */
   summary(): string | null {
      return this.#handoff.summary;
   }

   /** The task this run stopped for, once report_blocked was accepted. Null until then. */
   blocked(): Blocked | null {
      return this.#handoff.blocked ?? null;
   }

   initAgent(agent: LocalAgent): void {
      // summarize or report_blocked was accepted: stop before another model
      // call spends the rest of the budget. A run with no limit can be blocked too.
      agent.addHook(AfterToolsEvent, (event) => {
         if (this.#handoff.summary || this.#handoff.blocked) event.endTurn = true;
      });

      const maxTurns = this.#maxTurns;
      if (!maxTurns) return;

      // A reply that arrived is a step; a call that failed and is retried is not.
      agent.addHook(AfterModelCallEvent, (event) => {
         if (!event.error) this.#steps += 1;
      });

      // Near the end, only the handover runs: the replies left are for it.
      // Stopping as blocked is a handover too.
      agent.addHook(BeforeToolCallEvent, (event) => {
         const name = event.toolUse.name;
         if (this.#toldLast && name !== 'summarize' && name !== REPORT_BLOCKED) event.cancel = SUMMARIZE_ONLY;
      });

      // On a tool result, because that is the next thing the model reads. Once
      // per notice, so a reply with sixteen tool calls is told once, not sixteen times.
      agent.addHook(AfterToolCallEvent, (event) => {
         const left = maxTurns - this.#steps;
         let notice: string | null = null;
         if (left <= SUMMARIZE_ONLY_AT && !this.#toldLast) {
            this.#toldLast = this.#toldToWrapUp = this.#handoff.open = true;
            notice =
               `Berry: ${left} step${left === 1 ? ' is' : 's are'} left. Only summarize is accepted from now on; ` +
               'every other tool call is refused. Call summarize with what is done and what is left.';
         } else if (left <= wrapUpAt(maxTurns) && !this.#toldToWrapUp) {
            this.#toldToWrapUp = this.#handoff.open = true;
            notice =
               `Berry: ${left} steps are left in this run. Start nothing new. Call summarize with what is done, ` +
               'what is left, and the decisions the next run must keep. A fresh run starts from that summary.';
         }
         if (notice === null) return;
         event.result = new ToolResultBlock({
            toolUseId: event.result.toolUseId,
            status: event.result.status,
            content: [...event.result.content, new TextBlock(notice)],
            ...(event.result.error ? { error: event.result.error } : {}),
         });
      });
   }
}
