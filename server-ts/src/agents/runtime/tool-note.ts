/**
 * The same tool note on every runtime.
 *
 * Supported native tools are the aliases in that runtime's dictionary whose
 * Berry tools this run admits. `list_run_tools` is the one list of those
 * aliases plus the sandbox commands. `firstCall` stays so existing call sites
 * compile; the note names `list_run_tools` itself.
 */
export function runtimeToolNote(_firstCall: string): string {
   return (
      '\n\nHow to call tools on this runtime\n' +
      'The programs you may run are listed in the task under Commands in the sandbox, and they are the same on every runtime. ' +
      'Run one with run_command. ' +
      'Call list_run_tools to list every tool you may use. ' +
      'The reply contains the native commands for this runtime plus the sandbox commands.\n'
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
      'This completion cannot call tools. ' +
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
