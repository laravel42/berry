import { AfterToolCallEvent, BeforeToolCallEvent, tool, type LocalAgent, type Plugin, type Tool } from '@strands-agents/sdk';
import { z } from 'zod';
import { nativeAliasInventory, type NativeAlias } from './native-aliases.ts';

/**
 * The berry MCP server's inventory of this run.
 *
 * The reply has the Berry tools this run was given, the native aliases whose
 * Berry tool is on the run, and the sandbox commands that are not those
 * aliases. The permission check, not this call, refuses a tool the role does
 * not have.
 */

/** Optional inventory of the Berry tools this run was given. */
export const LIST_RUN_TOOLS = 'list_run_tools';

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
 * Does not refuse other tools. The sandbox commands are in the task prompt,
 * and a tool outside the role is refused by the permission check.
 *
 * `required` remains so a host can still be constructed the old way. It no
 * longer gates calls.
 */
export class RunToolDeclaration {
   constructor(_required: boolean) {}

   admit(_name: string): string | null {
      return null;
   }

   note(_name: string): void {}
}

export interface RunToolInventory {
   tools: DeclaredTool[];
   aliases: NativeAlias[];
   commands: string[];
   /** Set when this runtime has no alias dictionary. */
   nativeAliases?: string;
}

/** Berry tools, native aliases for this runtime, and sandbox commands that are not those aliases. */
export function runToolInventory(
   available: ReadonlyArray<{ name: string; description: string }>,
   runtimeId?: string | null
): RunToolInventory {
   const tools = declaredTools(available);
   const admitted = new Set(tools.map((entry) => entry.name));
   return { tools, ...nativeAliasInventory(runtimeId, admitted) };
}

export function listRunToolsTool(
   available: ReadonlyArray<{ name: string; description: string }>,
   runtimeId?: string | null
): Tool {
   const inventory = runToolInventory(available, runtimeId);
   return tool({
      name: LIST_RUN_TOOLS,
      description:
         'List every tool this run may use. The reply contains the Berry tools, the native aliases for this runtime, and the sandbox commands that are not those aliases. It does not add a tool the role does not have.',
      inputSchema: z.object({}),
      callback: () => inventory,
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
