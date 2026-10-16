/**
 * The same tool note on every runtime.
 *
 * A runtime's native tool names are served by Berry's MCP server as aliases
 * of the Berry tools this run admits, and a call to one runs that Berry tool.
 * `list_run_tools` is the one list of those aliases plus the sandbox commands.
 * `firstCall` stays so existing call sites compile; the note names
 * `list_run_tools` itself.
 */
export function runtimeToolNote(_firstCall: string): string {
   return (
      '\n\nHow to call tools on this runtime\n' +
      'The programs you may run are listed in the task under Commands in the sandbox, and they are the same on every runtime. ' +
      'Run one with run_command. ' +
      'Call list_run_tools to list every tool you may use. ' +
      'The reply contains the native tool names Berry serves on this runtime, each with the Berry tool it runs, plus the sandbox commands.\n'
   );
}

/**
 * Chat already carries an open-work snapshot. A first `list_run_tools` call
 * is a full CLI round before the model can answer.
 */
export function runtimeChatNote(): string {
   return (
      '\n\nHow this conversation works\n' +
      'Open work is already in this turn. Answer from that snapshot. ' +
      'Do not call list_run_tools or list the workspace first. ' +
      'Call a Berry tool only if you need more than the snapshot or to change something. ' +
      'To create a project, call create_project. Do not say you created one until that tool succeeds. ' +
      'Write markdown (headings, lists, tables). Do not emit HTML.\n'
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

/** Agent runs get the first-call note; chat answers from the snapshot; completions get the no-tools note. */
export function runtimeTurnNote(kind: string, firstCall: string, schema?: unknown, chat?: boolean): string {
   if (kind === 'completion') return runtimeCompletionNote(schema);
   if (chat) return runtimeChatNote();
   return runtimeToolNote(firstCall);
}

export function runtimeTurnNoteFor(
   envelope: { kind: string; task: { issue: unknown }; completion?: { jsonSchema?: unknown } | null },
   firstCall: string
): string {
   return runtimeTurnNote(envelope.kind, firstCall, envelope.completion?.jsonSchema, envelope.task.issue === null);
}

export function schemaHasRead(schema: unknown): boolean {
   if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return false;
   const properties = (schema as { properties?: unknown }).properties;
   if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return false;
   return 'read' in properties;
}
