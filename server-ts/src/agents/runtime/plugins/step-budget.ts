import { AfterModelCallEvent, AfterToolCallEvent, TextBlock, ToolResultBlock, type LocalAgent, type Plugin } from '@strands-agents/sdk';

/**
 * The step limit, told to the agent that has to live within it.
 *
 * A run ends when its model calls reach `maxTurns`, and until now the agent
 * learned that by being stopped. One that read eleven files with eleven
 * commands and saved twenty-five files one call at a time spent 80 steps on
 * work that fits in thirty, and was cut off mid-edit with nothing to say for
 * itself. The limit is a fact about the run, like the repository: the agent
 * is told it at the start, and told again when little of it is left, while it
 * can still leave the tree coherent and write its report.
 */

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
      `When about ${wrapUpAt(maxTurns)} steps are left you will be told; from then on finish what ` +
      'is open, check that it builds, and write your report. A run stopped at ' +
      'the limit delivers its files but no report.\n'
   );
}

export class StepBudgetPlugin implements Plugin {
   readonly name = 'berry:step-budget';
   readonly #maxTurns: number | undefined;
   #steps = 0;
   #toldToWrapUp = false;
   #toldLast = false;

   constructor(options: { maxTurns: number | undefined }) {
      this.#maxTurns = options.maxTurns;
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
            this.#toldLast = this.#toldToWrapUp = true;
            notice = 'Berry: your next reply is the last step of this run. Make it your report, with no tool calls.';
         } else if (left <= wrapUpAt(maxTurns) && !this.#toldToWrapUp) {
            this.#toldToWrapUp = true;
            notice =
               `Berry: ${left} steps are left in this run. Start nothing new: finish what is open, ` +
               'check that it builds, and keep your last step for your report.';
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
