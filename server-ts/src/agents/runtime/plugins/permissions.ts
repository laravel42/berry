import { BeforeToolCallEvent, type LocalAgent, type Plugin } from '@strands-agents/sdk';
import { PermissionDenied, type Permission, type PermissionSet } from '../../permissions.ts';

/**
 * The enforcement point.
 *
 * The check used to live inside `run_command` alone, and its permission set
 * was optional — a scope built without one got unrestricted commands, which
 * inverted `permissions.ts`'s own rule that absence is denial (F-09, F-10).
 * Here it is one hook in front of every tool, and it decides from a table:
 * which permission a tool needs, or that it needs none. A name not in the
 * table is refused, because a tool Berry cannot reason about is not one an
 * agent should reach.
 *
 * The refusal is delivered as the tool's result, in a sentence. The model
 * reads it and stops trying, instead of reading a thrown error as a transient
 * failure worth retrying.
 */

export const TOOL_PERMISSIONS: Readonly<Record<string, Permission | null>> = {
   run_command: 'run_commands',
   // Reading the checkout needs the same permission that got it unpacked.
   browse_repository: 'read_repository',
   read_repository_file: 'read_repository',
   // Artifact writes are deliberately ungated (decision D3, 2026-09-09):
   // adding a permission would need a migration in the shape of 034 to keep
   // existing agents' `write_file`, and an artifact is the run's own output,
   // not a change to anything outside it.
   write_file: null,
   // A file a command produced, saved the same way write_file saves text.
   collect_file: null,
   read_file: null,
   list_files: null,
   read_task: null,
   list_dependencies: null,
   // Rendered media is an artifact the agent saves, gated the same way.
   generate_speech: null,
   generate_video: null,
};

export class PermissionPlugin implements Plugin {
   readonly name = 'berry:permissions';
   readonly #permissions: PermissionSet;
   readonly #table: Readonly<Record<string, Permission | null>>;
   readonly #allowed: ReadonlySet<string> | null | undefined;
   readonly #exempt: ReadonlySet<string>;

   constructor(options: {
      permissions: PermissionSet;
      table?: Readonly<Record<string, Permission | null>>;
      /**
       * Berry organization enforcement (Task 5): the tools this agent's
       * contract allows, or null/undefined for an agent outside the
       * organization, which reaches every tool the table admits as before.
       */
      allowed?: ReadonlySet<string> | null;
      /**
       * Remote (Berry) and MCP tool names, exempt from `allowed`: the server's
       * scope filter and each MCP server's approved-tool list already govern
       * them, so the allowlist only ever refuses a local tool.
       */
      exempt?: ReadonlySet<string>;
   }) {
      this.#permissions = options.permissions;
      this.#table = options.table ?? TOOL_PERMISSIONS;
      this.#allowed = options.allowed;
      this.#exempt = options.exempt ?? new Set();
   }

   initAgent(agent: LocalAgent): void {
      agent.addHook(BeforeToolCallEvent, (event) => {
         const name = event.toolUse.name;
         if (this.#allowed && !this.#allowed.has(name) && !this.#exempt.has(name)) {
            event.cancel = `${name} is outside this agent's autonomy level`;
            return;
         }
         if (!Object.hasOwn(this.#table, name)) {
            event.cancel = `${name} is not a tool this run offers`;
            return;
         }
         const required = this.#table[name];
         if (required === null || required === undefined) return;
         try {
            this.#permissions.require(required);
         } catch (error) {
            if (error instanceof PermissionDenied) {
               event.cancel = error.message;
               return;
            }
            throw error;
         }
      });
   }
}
