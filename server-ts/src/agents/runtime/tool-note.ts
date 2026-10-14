/**
 * The same tool note on every runtime.
 *
 * A runtime's native tool names are served by Berry's MCP server as aliases
 * of the Berry tools this run admits. The task names sandbox programs when
 * there is a checkout; chat has no Commands section, so the note must not
 * send the model hunting one. `firstCall` stays so existing call sites
 * compile; AGENTS.md says not to call `list_run_tools` to learn the tools.
 */
export function runtimeToolNote(_firstCall: string): string {
   return (
      '\n\nHow to call tools on this runtime\n' +
      'Berry tools live on the berry MCP server. ' +
      'When the task names programs under Commands in the sandbox, run one with run_command. ' +
      'Do not call list_run_tools to learn those programs or the aliases; they are already on the server. ' +
      'If this turn has no Commands in the sandbox section, you are in a conversation: answer the person. Use tools only when the work needs them. ' +
      'Do not write that run_command or list_run_tools are missing.\n'
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
