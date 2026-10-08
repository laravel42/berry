import { AfterToolCallEvent, TextBlock, ToolResultBlock, type LocalAgent, type Plugin } from '@strands-agents/sdk';

/**
 * A run going around in circles, told so while it still has steps.
 *
 * The step limit ends a loop, but only after it has spent the run. One agent
 * rewrote the same probe test thirteen times, each a guess at a bug whose
 * explanation was already in the output, until the limit cut it off. The same
 * command run again and again, or the same file written again and again, is
 * the shape of that: this notices it and asks the agent to stop and read what
 * it already has. It refuses nothing: a person may well run the tests five
 * times while fixing them.
 */

/** How many times the same command may run before the agent is told. */
export const REPEATED_COMMAND_AT = 4;
/** How many times the same file may be written before the agent is told. */
export const REPEATED_WRITE_AT = 5;

/** What one tool call does again, when it does the same thing as another: a command, or a file it writes. */
export function repetitionKey(name: string, input: unknown): { kind: 'command' | 'write'; key: string } | null {
   const fields = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
   if (name === 'write_file' && typeof fields.path === 'string') {
      return { kind: 'write', key: fields.path.replace(/^\.\//, '') };
   }
   if (name !== 'run_command' || typeof fields.command !== 'string') return null;
   const command = fields.command.trim();
   // A heredoc into a file is a write, whatever its body says this time.
   const heredoc = /(?:^|[;&|]\s*)cat\s*>\s*(['"]?)([^\s'"<>]+)\1\s*<</.exec(command);
   if (heredoc?.[2]) return { kind: 'write', key: heredoc[2].replace(/^\.\//, '') };
   return { kind: 'command', key: command.replace(/\s+/g, ' ') };
}

export class RepetitionPlugin implements Plugin {
   readonly name = 'berry:repetition';
   readonly #counts = new Map<string, number>();
   readonly #told = new Set<string>();

   initAgent(agent: LocalAgent): void {
      agent.addHook(AfterToolCallEvent, (event) => {
         const found = repetitionKey(event.toolUse.name, event.toolUse.input);
         if (!found) return;
         const id = `${found.kind}:${found.key}`;
         const count = (this.#counts.get(id) ?? 0) + 1;
         this.#counts.set(id, count);
         const limit = found.kind === 'write' ? REPEATED_WRITE_AT : REPEATED_COMMAND_AT;
         if (count < limit || this.#told.has(id)) return;
         this.#told.add(id);
         const what =
            found.kind === 'write'
               ? `You have written ${found.key} ${count} times.`
               : `You have run the same command ${count} times.`;
         const notice =
            `Berry: ${what} If each attempt is a guess, stop and read the output you already have: ` +
            'the first error, not only the last lines. Then change your approach, or summarize what is blocking you.';
         event.result = new ToolResultBlock({
            toolUseId: event.result.toolUseId,
            status: event.result.status,
            content: [...event.result.content, new TextBlock(notice)],
            ...(event.result.error ? { error: event.result.error } : {}),
         });
      });
   }
}
