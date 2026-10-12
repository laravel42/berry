/**
 * How a runtime's Berry tools are actually named.
 *
 * The task prompt says to call `list_run_tools`. Several CLIs already expose
 * that as a direct function and reject `tool_load` / `tool_call`. Without the
 * exact name, the model spends the turn on those wrappers and the CLI's own
 * shell before it finds the tool.
 */
export function runtimeToolNote(firstCall: string): string {
   return (
      '\n\nHow to call tools on this runtime\n' +
      `Call ${firstCall} first. It is already loaded. ` +
      'Its reply names every other tool this run may use; call those the same way. ' +
      'Do not call tool_load, tool_call, or a powers interface. ' +
      "This runtime's own shell and file tools are refused.\n"
   );
}

/**
 * A completion has no Berry tools and no checkout. The agent-run note above
 * would send it hunting `list_run_tools` and Read File in an empty workspace.
 */
export function runtimeCompletionNote(schema?: unknown): string {
   const inspect = schemaHasRead(schema)
      ? ' To inspect the repository, list paths in `read` in your JSON reply; those files are fetched and sent back. Give the verdict with `read` empty.'
      : '';
   return (
      '\n\nHow this completion works\n' +
      'This turn is a single answer. There is no Berry tool server and no checkout of the repository. ' +
      'Do not call list_run_tools, tool_load, tool_call, a powers interface, or this runtime\'s shell or file tools. ' +
      'They are not available and will fail.' +
      inspect +
      '\n'
   );
}

/** Agent runs get the first-call note; completions get the no-tools note. */
export function runtimeTurnNote(kind: string, firstCall: string, schema?: unknown): string {
   return kind === 'completion' ? runtimeCompletionNote(schema) : runtimeToolNote(firstCall);
}

export function schemaHasRead(schema: unknown): boolean {
   if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return false;
   const properties = (schema as { properties?: unknown }).properties;
   if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return false;
   return 'read' in properties;
}
