import { AfterModelCallEvent, AfterToolCallEvent, AfterToolsEvent, TextBlock, ToolResultBlock, tool, type LocalAgent, type Plugin, type Tool } from '@strands-agents/sdk';
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

/** Shared by the tool and the plugin: summarize counts only after the wrap-up notice. */
export interface Handoff {
   open: boolean;
   summary: string | null;
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

/** Appended to the task prompt. Empty when the run has no step limit. */
export function budgetContract(maxTurns: number | undefined): string {
   if (!maxTurns) return '';
   return (
      '\n\nYour step budget\n' +
      `This run ends after ${maxTurns} steps. A step is one reply from you, however ` +
      'many tools it calls, so calls that do not depend on each other belong in ' +
      'the same reply: save all the files you have ready at once, not one per ' +
      'reply. Read several files with one command (cat a b c, or grep) rather ' +
      'than one command each, and chain commands that belong together with &&. ' +
      `When about ${wrapUpAt(maxTurns)} steps are left you will be told to call summarize. ` +
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

   initAgent(agent: LocalAgent): void {
      const maxTurns = this.#maxTurns;
      if (!maxTurns) return;

      // A reply that arrived is a step; a call that failed and is retried is not.
      agent.addHook(AfterModelCallEvent, (event) => {
         if (!event.error) this.#steps += 1;
      });

      // On a tool result, because that is the next thing the model reads. Once
      // per notice, so a reply with sixteen tool calls is told once, not sixteen times.
      agent.addHook(AfterToolCallEvent, (event) => {
         const left = maxTurns - this.#steps;
         let notice: string | null = null;
         if (left <= 1 && !this.#toldLast) {
            this.#toldLast = this.#toldToWrapUp = this.#handoff.open = true;
            notice =
               'Berry: your next reply is the last step of this run. Call summarize with what is done and what is left, and make no other tool call.';
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

      // summarize was accepted: stop before another model call spends the rest of the budget.
      agent.addHook(AfterToolsEvent, (event) => {
         if (this.#handoff.summary) event.endTurn = true;
      });
   }
}
