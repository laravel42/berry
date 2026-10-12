import { AfterToolCallEvent, BeforeToolCallEvent, tool, type LocalAgent, type Plugin, type Tool } from '@strands-agents/sdk';
import { z } from 'zod';

/**
 * The berry MCP server's declaration of this run's tools.
 *
 * Subscription runtimes already speak to that server. `list_run_tools` is
 * what it answers with: the tools this run may call, and no others. Every
 * other call is refused until that reply has come back.
 */

/** The tool the agent calls on the berry MCP server before it works. */
export const LIST_RUN_TOOLS = 'list_run_tools';

/** What a tool call gets until `list_run_tools` has succeeded. */
export const LIST_RUN_TOOLS_REQUIRED =
   'Call list_run_tools on the berry MCP server before any other tool. Its reply is the only set of tools this run may use.';

export interface DeclaredTool {
   name: string;
   description: string;
}

/** The tools a run may use, without the declaration call itself. */
export function declaredTools(available: ReadonlyArray<{ name: string; description: string }>): DeclaredTool[] {
   return available
      .filter((entry) => entry.name !== LIST_RUN_TOOLS)
      .map((entry) => ({ name: entry.name, description: entry.description }));
}

/**
 * Refuses every tool except `list_run_tools` until that call has succeeded.
 *
 * Absent when this host was not given the declaration tool, so a server that
 * only exposes the run's own tools still answers them.
 */
export class RunToolDeclaration {
   readonly #required: boolean;
   #open = false;

   constructor(required: boolean) {
      this.#required = required;
   }

   admit(name: string): string | null {
      if (!this.#required || name === LIST_RUN_TOOLS || this.#open) return null;
      return LIST_RUN_TOOLS_REQUIRED;
   }

   note(name: string): void {
      if (name === LIST_RUN_TOOLS) this.#open = true;
   }
}

export function listRunToolsTool(available: ReadonlyArray<{ name: string; description: string }>): Tool {
   const tools = declaredTools(available);
   return tool({
      name: LIST_RUN_TOOLS,
      description:
         'Declare the tools this run may use. Call this on the berry MCP server before any other tool. The reply is the complete set for this run.',
      inputSchema: z.object({}),
      callback: () => ({ tools }),
   });
}

/** The Strands loop's copy of the same gate the berry MCP server enforces. */
export class RunToolsPlugin implements Plugin {
   readonly name = 'berry:run-tools';
   readonly #declaration = new RunToolDeclaration(true);

   initAgent(agent: LocalAgent): void {
      agent.addHook(BeforeToolCallEvent, (event) => {
         const refusal = this.#declaration.admit(event.toolUse.name);
         if (refusal) event.cancel = refusal;
      });
      agent.addHook(AfterToolCallEvent, (event) => {
         const thrown = event.error ?? event.result.error;
         if (thrown) return;
         this.#declaration.note(event.toolUse.name);
      });
   }
}
